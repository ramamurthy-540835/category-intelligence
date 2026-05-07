"use client";

import { useEffect } from "react";
import type { SellThroughRow } from "@/components/SellThroughChart";

// ──────────────────────────────────────────────────────────────────────────────
// WeekDetailPanel — fixed-position slide-in over the right edge of the page,
// shown when the user clicks a point on the 13-week trend chart. Dark overlay
// behind. Closes on Esc, outside click, or X. "Ask agent" button fires a
// pre-built chat prompt via the `cat-flow-prompt` window event.
// ──────────────────────────────────────────────────────────────────────────────

interface Props {
  row: SellThroughRow | null;
  onClose: () => void;
}

const ROW_COLORS: Record<string, string> = {
  Samsung: "#3b82f6",
  Sony:    "#f59e0b",
  LG:      "#ef4444",
};

export default function WeekDetailPanel({ row, onClose }: Props) {
  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [row, onClose]);

  if (!row) return null;

  const askAgent = () => {
    const prompt = `Walk me through the ${row.week} sell-through performance vs forecast. ` +
      `Samsung ${row.Samsung}u, Sony ${row.Sony}u, LG ${row.LG}u — forecast ${row.Forecast}u. ` +
      `What changed and what should we do?`;
    window.dispatchEvent(new CustomEvent("cat-flow-prompt", { detail: prompt }));
    onClose();
  };

  const brands: Array<keyof typeof ROW_COLORS> = ["Samsung", "Sony", "LG"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <aside
        className="relative flex flex-col h-full bg-[#0d1117] border-l border-[#2d3748] shadow-2xl"
        style={{
          width: "300px",
          maxWidth: "100vw",
          animation: "week-slide-in 200ms cubic-bezier(0.16,1,0.3,1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ background: "#003087" }}
        >
          <div>
            <p className="text-white text-[13px] font-semibold leading-tight">{row.week} — Sell-Through Detail</p>
            <p className="text-[10px] mt-0.5" style={{ color: "#bfdbfe" }}>
              Units by brand vs forecast
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/70 hover:text-white p-1 rounded transition-colors"
            aria-label="Close"
            title="Close (Esc)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Brand rows */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {brands.map((b) => {
            const units = row[b] as number;
            const delta = units - row.Forecast;
            const deltaPct = (delta / row.Forecast) * 100;
            const positive = delta >= 0;
            return (
              <div
                key={b}
                className="rounded-md px-3 py-2.5"
                style={{ background: "#161b22", border: "1px solid #2d3748" }}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[12px] text-white font-medium">
                    <span style={{ color: ROW_COLORS[b] }}>●</span> {b}
                  </span>
                  <span className="text-[16px] font-bold tabular-nums text-white">
                    {units.toLocaleString()} <span className="text-[10px] font-normal text-slate-400">units</span>
                  </span>
                </div>
                <div className={"text-[10px] mt-1 " + (positive ? "text-emerald-400" : "text-red-400")}>
                  {positive ? "▲" : "▼"} {positive ? "+" : ""}{delta} ({positive ? "+" : ""}{deltaPct.toFixed(1)}%) vs forecast
                </div>
              </div>
            );
          })}

          <div
            className="rounded-md px-3 py-2.5"
            style={{ background: "#0f1923", border: "1px dashed #475569" }}
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[12px] text-slate-400 font-medium">
                <span>· · ·</span> Forecast
              </span>
              <span className="text-[16px] font-bold tabular-nums text-slate-200">
                {row.Forecast.toLocaleString()} <span className="text-[10px] font-normal text-slate-500">target</span>
              </span>
            </div>
            <div className="text-[10px] mt-1 text-slate-500">
              Plan baseline · 13-week rolling
            </div>
          </div>
        </div>

        {/* Bottom action */}
        <div className="px-4 py-3 border-t border-[#1e2532] flex-shrink-0">
          <button
            type="button"
            onClick={askAgent}
            className="w-full bg-[#003087] hover:bg-[#0046BE] text-white text-[12px] font-semibold py-2.5 rounded transition-colors flex items-center justify-center gap-1.5"
          >
            Ask agent about {row.week} <span>→</span>
          </button>
          <p className="text-[10px] mt-2 text-center" style={{ color: "#475569" }}>
            Press <kbd className="bg-[#1e2532] text-[#94a3b8] px-1 py-0.5 rounded text-[9px] font-mono">Esc</kbd> or click outside to close
          </p>
        </div>
      </aside>

      <style>{`
        @keyframes week-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}

