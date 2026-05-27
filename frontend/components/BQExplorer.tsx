"use client";

import { useEffect, useState } from "react";

// ──────────────────────────────────────────────────────────────────────────────
// BQExplorer — live BigQuery viewer / editor for the Category Intelligence
// dashboard. Talks to backend /bq/query (read) and /bq/update (allowlisted
// UPDATE on sku_master.our_price | sku_name).
// ──────────────────────────────────────────────────────────────────────────────

interface BQRow {
  [key: string]: string | number | boolean | null;
}

interface BQResult {
  columns: string[];
  rows: BQRow[];
  total_rows: number;
  bytes_processed?: number | null;
}

const PRESET_QUERIES: { label: string; sql: string }[] = [
  {
    label: "Price gaps (filtered)",
    sql: `SELECT m.sku_id, m.sku_name, m.our_price,
       s.competitor_price,
       ROUND((m.our_price - s.competitor_price) / m.our_price * 100, 1) AS gap_pct
FROM \`ctoteam.category_intelligence.competitor_price_snapshots\` s
INNER JOIN \`ctoteam.category_intelligence.sku_master\` m ON s.sku_id = m.sku_id
WHERE s.snapshot_time = (
  SELECT MAX(snapshot_time)
  FROM \`ctoteam.category_intelligence.competitor_price_snapshots\`
)
  AND s.competitor_price >= m.our_price * 0.5
  AND s.competitor_price <= m.our_price * 1.5
ORDER BY ABS((m.our_price - s.competitor_price) / m.our_price) DESC
LIMIT 20`,
  },
  {
    label: "All active SKUs",
    sql: `SELECT sku_id, sku_name, our_price, active_flag
FROM \`ctoteam.category_intelligence.sku_master\`
WHERE active_flag = TRUE
ORDER BY our_price DESC
LIMIT 100`,
  },
  {
    label: "Latest snapshot run",
    sql: `SELECT sku_id, sku_name, retailer_price, competitor_price,
       price_gap_pct, snapshot_time
FROM \`ctoteam.category_intelligence.competitor_price_snapshots\`
WHERE snapshot_time = (
  SELECT MAX(snapshot_time)
  FROM \`ctoteam.category_intelligence.competitor_price_snapshots\`
)
ORDER BY ABS(price_gap_pct) DESC
LIMIT 50`,
  },
  {
    label: "SKUs with no competitor data",
    sql: `SELECT m.sku_id, m.sku_name, m.our_price
FROM \`ctoteam.category_intelligence.sku_master\` m
LEFT JOIN \`ctoteam.category_intelligence.competitor_price_snapshots\` s
  ON m.sku_id = s.sku_id
WHERE s.sku_id IS NULL AND m.active_flag = TRUE
ORDER BY m.our_price DESC`,
  },
  {
    label: "Agent action log",
    sql: `SELECT timestamp, user_id, action, tool, outcome, session_id
FROM \`ctoteam.category_intelligence.agent_action_log\`
ORDER BY timestamp DESC
LIMIT 50`,
  },
  {
    label: "Pipeline run history",
    sql: `SELECT run_id, timestamp, status, skus_fetched, rows_written
FROM \`ctoteam.category_intelligence.competitor_price_feed_runs\`
ORDER BY timestamp DESC
LIMIT 20`,
  },
];

const fmt = (col: string, val: BQRow[string]): string => {
  if (val === null || val === undefined) return "—";
  if (col === "our_price" || col === "competitor_price" || col === "retailer_price") {
    const n = typeof val === "number" ? val : parseFloat(String(val));
    return isFinite(n) ? `$${n.toFixed(2)}` : String(val);
  }
  if (col === "gap_pct" || col === "price_gap_pct") {
    const n = typeof val === "number" ? val : parseFloat(String(val));
    if (!isFinite(n)) return String(val);
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toFixed(1)}%`;
  }
  return String(val);
};

export default function BQExplorer() {
  const [activeCategory, setActiveCategory] = useState<string>("Home Appliance");
  const [sql, setSql] = useState<string>(PRESET_QUERIES[0].sql);
  const [result, setResult] = useState<BQResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [elapsed, setElapsed] = useState<number | null>(null);

  const runQuery = async () => {
    setLoading(true);
    setError(null);
    const t0 = performance.now();
    try {
      const res = await fetch(`/api/bq/query?category=${encodeURIComponent(activeCategory)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, max_rows: 200 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
      setResult(data);
      setElapsed(performance.now() - t0);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const onCategory = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.category === "string") setActiveCategory(detail.category);
    };
    window.addEventListener("cat-category-change", onCategory);
    return () => window.removeEventListener("cat-category-change", onCategory);
  }, []);

  const isEditableCol = (col: string) =>
    editMode && (col === "our_price" || col === "sku_name");

  const saveCell = async (rowIdx: number, col: string, value: string) => {
    if (!result) return;
    const row = result.rows[rowIdx];
    const skuId = row["sku_id"];
    if (typeof skuId !== "string" || !skuId) {
      setError("Row has no sku_id — can't update.");
      setEditingCell(null);
      return;
    }
    if (!["our_price", "sku_name"].includes(col)) return;

    try {
      const res = await fetch("/api/bq/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: "sku_master", sku_id: skuId, field: col, value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
      // Reflect locally — coerce to number for our_price.
      const newRows = [...result.rows];
      newRows[rowIdx] = {
        ...newRows[rowIdx],
        [col]: col === "our_price" ? parseFloat(value) : value,
      };
      setResult({ ...result, rows: newRows });
      setError(null);
    } catch (e: any) {
      setError(e.message || "Update failed");
    } finally {
      setEditingCell(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-[#e2e8f0]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-[#003087] flex-shrink-0">
        <span>🗄️</span>
        <span className="text-white text-[12px] font-bold tracking-wider">BigQuery Explorer</span>
        <span className="text-blue-300 text-[10px] ml-1">ctoteam.category_intelligence</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className={
              "text-[10px] px-2 py-1 rounded border font-medium " +
              (editMode
                ? "border-[#22c55e] text-[#22c55e] bg-[#166534]/40"
                : "border-[#2d3748] text-[#94a3b8] hover:text-white")
            }
            title={editMode ? "Edit mode ON — our_price and sku_name editable" : "Read-only"}
          >
            {editMode ? "🔓 Edit ON" : "🔒 Read Only"}
          </button>
        </div>
      </div>

      {/* Preset selector + Run */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1e2532] flex-shrink-0">
        <select
          className="bg-[#1c2230] border border-[#2d3748] text-[#e2e8f0] text-[11px] rounded px-2 py-1 flex-1"
          onChange={(e) => {
            const q = PRESET_QUERIES.find((p) => p.label === e.target.value);
            if (q) setSql(q.sql);
          }}
          defaultValue={PRESET_QUERIES[0].label}
        >
          {PRESET_QUERIES.map((q) => (
            <option key={q.label} value={q.label}>{q.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={runQuery}
          disabled={loading}
          className="bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-50 text-white text-[11px] font-bold px-3 py-1 rounded flex items-center gap-1"
        >
          {loading ? "⏳" : "▶"} Run
        </button>
        <button
          type="button"
          onClick={() => setSql(PRESET_QUERIES[0].sql)}
          className="text-[10px] text-[#64748b] hover:text-white px-2 py-1 rounded border border-[#2d3748]"
          title="Reset to first preset"
        >
          Reset
        </button>
      </div>

      {/* SQL Editor */}
      <div className="px-3 py-2 border-b border-[#1e2532] flex-shrink-0">
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          className="w-full bg-[#0d1117] border border-[#2d3748] text-[#22c55e] text-[10px] font-mono rounded p-2 resize-none h-28 focus:outline-none focus:border-[#3b82f6]"
          spellCheck={false}
        />
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto px-3 py-2 min-h-0">
        {error && (
          <div className="bg-[#7f1d1d] border border-[#dc2626] rounded p-2 text-[#fca5a5] text-[11px] mb-2">
            {error}
          </div>
        )}
        {result && (
          <>
            <div className="text-[10px] text-[#64748b] mb-2">
              {result.total_rows} row{result.total_rows === 1 ? "" : "s"}
              {elapsed !== null && <> · {(elapsed / 1000).toFixed(2)}s</>}
              {result.bytes_processed != null && (
                <> · {(result.bytes_processed / 1024 / 1024).toFixed(2)} MB scanned</>
              )}
              <span className="ml-2 text-[#3b82f6]">bigquery-live</span>
              {editMode && (
                <span className="ml-2 text-[#22c55e]">· Click our_price or sku_name to edit</span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr className="border-b border-[#2d3748] sticky top-0 bg-[#0d1117]">
                    {result.columns.map((col) => (
                      <th
                        key={col}
                        className="text-left py-1.5 px-2 text-[#64748b] font-semibold uppercase tracking-wider truncate"
                        style={{ minWidth: col === "sku_name" ? 180 : 100 }}
                      >
                        {col}
                        {isEditableCol(col) && <span className="ml-1 text-[#22c55e]">✎</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, ri) => (
                    <tr key={ri} className="border-b border-[#1e2532] hover:bg-[#161b22]">
                      {result.columns.map((col) => {
                        const editable = isEditableCol(col);
                        const isEditing = editingCell?.row === ri && editingCell?.col === col;
                        const display = fmt(col, row[col]);
                        const gapColor =
                          col === "gap_pct" || col === "price_gap_pct"
                            ? (() => {
                                const n = parseFloat(String(row[col] ?? 0));
                                return n < 0 ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold";
                              })()
                            : "";
                        return (
                          <td key={col} className="py-1.5 px-2 truncate">
                            {isEditing ? (
                              <input
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => saveCell(ri, col, editValue)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveCell(ri, col, editValue);
                                  if (e.key === "Escape") setEditingCell(null);
                                }}
                                className="bg-[#1e3a5f] border border-[#3b82f6] text-white text-[10px] rounded px-1 py-0.5 w-full focus:outline-none"
                              />
                            ) : (
                              <span
                                onClick={() => {
                                  if (!editable) return;
                                  setEditingCell({ row: ri, col });
                                  // For our_price strip $ from the display so the input shows just the number.
                                  setEditValue(
                                    col === "our_price"
                                      ? String(row[col] ?? "")
                                      : String(row[col] ?? ""),
                                  );
                                }}
                                className={
                                  (editable ? "cursor-pointer hover:text-[#60a5fa] hover:underline " : "text-[#e2e8f0] ") +
                                  gapColor
                                }
                              >
                                {display}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {!result && !loading && !error && (
          <div className="text-[#475569] text-[11px] text-center mt-8">
            Pick a preset or write a SELECT and click Run ▶
          </div>
        )}
        {loading && (
          <div className="text-[#3b82f6] text-[11px] text-center mt-8 animate-pulse">
            ⏳ Querying BigQuery…
          </div>
        )}
      </div>
    </div>
  );
}
