"use client";

import { useEffect, useMemo, useState } from "react";
import { ChatInterface } from "@/components/chat/ChatInterface";
import AgentControlCenter from "@/components/chat/AgentControlCenter";
import AlertTicker from "@/components/AlertTicker";

type Alert = { priority: "P1" | "P2"; sku: string; msg: string };
type Row = {
  sku_id: string;
  name?: string;
  sku_name?: string;
  competitor_price: number;
  our_price?: number;
  retailer_price?: number;
  price_gap_pct: number;
  in_stock: boolean;
  snapshot_time?: string;
};

type OverviewPayload = { source?: string; timestamp?: string; alerts?: Alert[]; rows?: Row[] };

type FeedStatus = {
  status: string;
  latest_run?: { run_id: string; timestamp: string; skus_fetched: number; rows_written: number; status: string };
};

type AgentEvent = { ts: string; phase: string; message: string };

export default function Home() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [source, setSource] = useState<string>("loading");
  const [timestamp, setTimestamp] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "in" | "out">("all");
  const [sortBy, setSortBy] = useState<"gap_desc" | "gap_asc" | "name">("gap_desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [fetchSize, setFetchSize] = useState(100);
  const [selected, setSelected] = useState<Row | null>(null);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [autoRefreshMins, setAutoRefreshMins] = useState(1);
  const [autoRefreshOn, setAutoRefreshOn] = useState(true);

  const logEvent = (phase: string, message: string) => {
    setEvents((prev) => [{ ts: new Date().toLocaleTimeString(), phase, message }, ...prev].slice(0, 20));
  };

  const loadOverview = async () => {
    const params = new URLSearchParams({ q: query, stock: stockFilter, limit: String(fetchSize), offset: "0" });
    const res = await fetch(`/api/dashboard/overview?${params.toString()}`, { cache: "no-store" });
    const data: OverviewPayload = await res.json();
    setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
    setRows(Array.isArray(data.rows) ? data.rows : []);
    setSource(data.source || "unknown");
    setTimestamp(data.timestamp || "");
  };

  const loadFeedStatus = async () => {
    const res = await fetch("/api/feeds/prices/status", { cache: "no-store" });
    const data: FeedStatus = await res.json();
    setFeedStatus(data);
  };

  useEffect(() => {
    const run = async () => {
      try {
        await Promise.all([loadOverview(), loadFeedStatus()]);
      } catch {
        setSource("error");
      }
    };
    run();
    const id = setInterval(run, autoRefreshOn ? autoRefreshMins * 60000 : 3600000);
    return () => clearInterval(id);
  }, [query, stockFilter, autoRefreshMins, autoRefreshOn, fetchSize]);

  const filteredRows = useMemo(
    () =>
      rows
        .filter((row) => (row.name || row.sku_name || row.sku_id).toLowerCase().includes(query.toLowerCase()) || row.sku_id.toLowerCase().includes(query.toLowerCase()))
        .filter((row) => (stockFilter === "all" ? true : stockFilter === "in" ? row.in_stock : !row.in_stock))
        .sort((a, b) => {
          if (sortBy === "name") return (a.name || a.sku_name || a.sku_id).localeCompare(b.name || b.sku_name || b.sku_id);
          if (sortBy === "gap_asc") return a.price_gap_pct - b.price_gap_pct;
          return Math.abs(b.price_gap_pct) - Math.abs(a.price_gap_pct);
        }),
    [rows, query, stockFilter, sortBy]
  );

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const triggerRefresh = async () => {
    setRefreshing(true);
    logEvent("sensing", `Triggered feed refresh limit=${fetchSize}`);
    const res = await fetch(`/api/feeds/prices?limit=${fetchSize}`, { method: "POST" });
    const data = await res.json();
    logEvent("integration", `Feed refresh done: ${JSON.stringify(data)}`);
    await Promise.all([loadOverview(), loadFeedStatus()]);
    setRefreshing(false);
  };

  const triggerAction = async (actionType: string, row: Row) => {
    logEvent("act", `${actionType} requested for ${row.sku_id}`);
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-role": "manager" },
      body: JSON.stringify({ action_type: actionType, payload: { sku_id: row.sku_id }, user_id: "ui-user", user_role: "manager" }),
    });
    const text = await res.text();
    setActionMsg(`${actionType}: ${text}`);
    logEvent("respond", `${actionType} response: ${text}`);
  };

  return (
    <main className="flex min-h-screen flex-col bg-gray-950">
      <header className="bg-blue-900 px-6 py-3 flex items-center gap-4">
        <span className="font-bold text-yellow-400 text-lg">BBY</span>
        <span className="font-semibold text-white">Category Intelligence</span>
        <span className="text-xs text-blue-300 ml-1">POWERED BY ADEPT AI</span>
      </header>
      <div className="bg-slate-900 border-b border-slate-700 px-6 py-1.5 text-[11px] text-slate-300 flex items-center justify-between">
        <span>Data Source: <span className={source.includes("live") ? "text-emerald-300 font-semibold" : "text-amber-300 font-semibold"}>{source}</span></span>
        <span className="flex items-center gap-3">
          <span>Last Refresh: {timestamp ? new Date(timestamp).toLocaleTimeString() : "--"}</span>
          <span className={`px-2 py-0.5 rounded ${feedStatus.latest_run?.status === "success" ? "bg-emerald-900 text-emerald-300" : "bg-amber-900 text-amber-300"}`}>
            {feedStatus.latest_run?.status || "unknown"}
          </span>
        </span>
      </div>
      <AlertTicker alerts={alerts} />
      <div className="flex flex-1 p-4 gap-4">
        <div className="w-[30%] flex flex-col gap-3 h-full overflow-y-auto">
          <AgentControlCenter alerts={alerts} />
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 text-[11px] text-slate-200">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold">Agent Timeline</h4>
              <button onClick={triggerRefresh} disabled={refreshing} className="px-2 py-1 rounded bg-blue-700 text-white disabled:opacity-50">{refreshing ? "Refreshing..." : "Refresh Now"}</button>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <label className="text-slate-300">Auto Refresh</label>
              <input type="checkbox" checked={autoRefreshOn} onChange={(e) => setAutoRefreshOn(e.target.checked)} />
              <select value={String(autoRefreshMins)} onChange={(e) => setAutoRefreshMins(Number(e.target.value))} className="bg-slate-800 border border-slate-700 rounded px-1 py-0.5">
                <option value="1">1m</option>
                <option value="5">5m</option>
                <option value="15">15m</option>
              </select>
            </div>
            <div className="mb-2 text-slate-300">Run: {feedStatus.latest_run?.run_id || "--"}</div>
            <div className="mb-2 text-slate-300">Rows: {feedStatus.latest_run?.rows_written ?? 0} / SKUs: {feedStatus.latest_run?.skus_fetched ?? 0}</div>
            <div className="max-h-52 overflow-y-auto space-y-1">
              {events.length === 0 ? <div className="text-slate-500">No agent events yet.</div> : events.map((e, i) => <div key={i} className="bg-slate-800 rounded p-1"><span className="text-emerald-300">{e.ts}</span> [{e.phase}] {e.message}</div>)}
            </div>
          </div>
        </div>
        <div className="w-[70%] flex flex-col gap-3 h-full overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-white">Live Pricing Intelligence</h3>
              <span className="text-[11px] text-slate-400">{filteredRows.length} SKUs</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-3">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search SKU..." className="md:col-span-2 bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700" />
              <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value as "all" | "in" | "out")} className="bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700"><option value="all">All Stock</option><option value="in">In Stock</option><option value="out">Out of Stock</option></select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "gap_desc" | "gap_asc" | "name")} className="bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700"><option value="gap_desc">Largest Gap</option><option value="gap_asc">Smallest Gap</option><option value="name">Name</option></select>
              <select value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700"><option value="10">10/page</option><option value="20">20/page</option><option value="50">50/page</option></select>
              <select value={String(fetchSize)} onChange={(e) => setFetchSize(Number(e.target.value))} className="bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700"><option value="10">Fetch 10</option><option value="100">Fetch 100</option><option value="500">Fetch 500</option><option value="1000">Fetch 1000</option></select>
            </div>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-[11px] text-left">
                <thead className="text-slate-400 border-b border-slate-700"><tr><th className="py-1">SKU</th><th className="py-1">Our</th><th className="py-1">Market</th><th className="py-1">Gap %</th><th className="py-1">Stock</th></tr></thead>
                <tbody className="text-slate-200">
                  {pagedRows.map((row) => {
                    const name = row.name || row.sku_name || row.sku_id;
                    const our = row.our_price ?? row.retailer_price ?? 0;
                    return (
                      <tr key={row.sku_id} className="border-b border-slate-800 cursor-pointer hover:bg-slate-800/60" onClick={() => setSelected(row)}>
                        <td className="py-1">{name}</td><td className="py-1">${our.toFixed(2)}</td><td className="py-1">${row.competitor_price.toFixed(2)}</td>
                        <td className={`py-1 font-semibold ${row.price_gap_pct >= 0 ? "text-amber-300" : "text-emerald-300"}`}>{row.price_gap_pct >= 0 ? "+" : ""}{row.price_gap_pct.toFixed(1)}%</td>
                        <td className="py-1">{row.in_stock ? "In" : "Out"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-300">
              <span>Page {safePage}/{totalPages} · {filteredRows.length} rows</span>
              <div className="flex gap-1"><button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1} className="px-2 py-1 rounded bg-slate-800 border border-slate-700 disabled:opacity-40">Prev</button><button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} className="px-2 py-1 rounded bg-slate-800 border border-slate-700 disabled:opacity-40">Next</button></div>
            </div>
          </div>
          {selected && (
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 text-[12px] text-slate-200">
              <div className="flex items-center justify-between mb-2"><h4 className="font-semibold">SKU Detail: {selected.name || selected.sku_name || selected.sku_id}</h4><button onClick={() => setSelected(null)} className="text-slate-400 hover:text-white">Close</button></div>
              <div className="grid grid-cols-2 gap-2 mb-3"><div>SKU: {selected.sku_id}</div><div>Stock: {selected.in_stock ? "In Stock" : "Out"}</div><div>Gap: {selected.price_gap_pct.toFixed(2)}%</div><div>Snapshot: {selected.snapshot_time || "--"}</div></div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => triggerAction("reprice", selected)} className="px-2 py-1 rounded bg-blue-700 text-white">Reprice</button>
                <button onClick={() => triggerAction("replenish", selected)} className="px-2 py-1 rounded bg-emerald-700 text-white">Replenish</button>
                <button onClick={() => triggerAction("draft_coop_email", selected)} className="px-2 py-1 rounded bg-amber-700 text-white">Draft Co-op</button>
                <button onClick={() => triggerAction("queue_campaign", selected)} className="px-2 py-1 rounded bg-purple-700 text-white">Queue Campaign</button>
              </div>
              {actionMsg && <div className="mt-2 text-[11px] text-slate-300 bg-slate-800 rounded p-2">{actionMsg}</div>}
            </div>
          )}
          <div className="flex flex-1 h-full overflow-y-auto"><ChatInterface /></div>
        </div>
      </div>
    </main>
  );
}
