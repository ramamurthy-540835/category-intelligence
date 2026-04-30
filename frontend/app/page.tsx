"use client";

import { useEffect, useState } from "react";
import { ChatInterface } from "@/components/chat/ChatInterface";
import AgentControlCenter from "@/components/chat/AgentControlCenter";
import AlertTicker from "@/components/AlertTicker";

type Alert = { priority: "P1" | "P2"; sku: string; msg: string };
type OverviewPayload = {
  source?: string;
  timestamp?: string;
  alerts?: Alert[];
  rows?: Array<{
    sku_id: string;
    name: string;
    competitor_price: number;
    our_price: number;
    price_gap_pct: number;
    in_stock: boolean;
  }>;
};

export default function Home() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [source, setSource] = useState<string>("loading");
  const [timestamp, setTimestamp] = useState<string>("");
  const [rows, setRows] = useState<OverviewPayload["rows"]>([]);
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "in" | "out">("all");
  const [sortBy, setSortBy] = useState<"gap_desc" | "gap_asc" | "name">("gap_desc");

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/dashboard/overview", { cache: "no-store" });
        const data: OverviewPayload = await res.json();
        setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setSource(data.source || "unknown");
        setTimestamp(data.timestamp || "");
      } catch {
        setAlerts([]);
        setRows([]);
        setSource("error");
        setTimestamp("");
      }
    };

    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  const filteredRows = (rows || [])
    .filter((row) => row.name.toLowerCase().includes(query.toLowerCase()) || row.sku_id.toLowerCase().includes(query.toLowerCase()))
    .filter((row) => (stockFilter === "all" ? true : stockFilter === "in" ? row.in_stock : !row.in_stock))
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "gap_asc") return a.price_gap_pct - b.price_gap_pct;
      return Math.abs(b.price_gap_pct) - Math.abs(a.price_gap_pct);
    });

  const highRisk = filteredRows.filter((r) => Math.abs(r.price_gap_pct) >= 15).length;

  return (
    <main className="flex min-h-screen flex-col bg-gray-950">
      <header className="bg-blue-900 px-6 py-3 flex items-center gap-4">
        <span className="font-bold text-yellow-400 text-lg">BBY</span>
        <span className="font-semibold text-white">Category Intelligence</span>
        <span className="text-xs text-blue-300 ml-1">POWERED BY ADEPT AI</span>
      </header>
      <div className="bg-slate-900 border-b border-slate-700 px-6 py-1.5 text-[11px] text-slate-300 flex items-center justify-between">
        <span>
          Data Source:{" "}
          <span className={source === "live-serpapi" ? "text-emerald-300 font-semibold" : "text-amber-300 font-semibold"}>
            {source}
          </span>
        </span>
        <span>Last Refresh: {timestamp ? new Date(timestamp).toLocaleTimeString() : "--"}</span>
      </div>
      <AlertTicker alerts={alerts} />
      <div className="flex flex-1 p-4 gap-4">
        <div className="w-[32%] flex flex-col h-full overflow-y-auto">
          <AgentControlCenter alerts={alerts} />
        </div>
        <div className="w-[68%] flex flex-col gap-3 h-full overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-white">Live Pricing Intelligence</h3>
              <span className="text-[11px] text-slate-400">{filteredRows.length} SKUs</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search SKU..."
                className="md:col-span-2 bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700"
              />
              <select
                value={stockFilter}
                onChange={(e) => setStockFilter(e.target.value as "all" | "in" | "out")}
                className="bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700"
              >
                <option value="all">All Stock</option>
                <option value="in">In Stock</option>
                <option value="out">Out of Stock</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "gap_desc" | "gap_asc" | "name")}
                className="bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700"
              >
                <option value="gap_desc">Sort: Largest Gap</option>
                <option value="gap_asc">Sort: Smallest Gap</option>
                <option value="name">Sort: Name</option>
              </select>
            </div>
            <div className="mb-3 bg-slate-800/60 border border-slate-700 rounded p-2">
              <p className="text-[11px] text-slate-200">
                AI Insight: {highRisk} SKUs show high price risk (|gap| ≥ 15%). Prioritize repricing for positive gaps and margin checks for negative gaps.
              </p>
            </div>
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full text-[11px] text-left">
                <thead className="text-slate-400 border-b border-slate-700">
                  <tr>
                    <th className="py-1">SKU</th>
                    <th className="py-1">Our Price</th>
                    <th className="py-1">Market</th>
                    <th className="py-1">Gap %</th>
                    <th className="py-1">Stock</th>
                  </tr>
                </thead>
                <tbody className="text-slate-200">
                  {filteredRows.map((row) => (
                    <tr key={row.sku_id} className="border-b border-slate-800">
                      <td className="py-1">{row.name}</td>
                      <td className="py-1">${row.our_price.toFixed(2)}</td>
                      <td className="py-1">${row.competitor_price.toFixed(2)}</td>
                      <td className={`py-1 font-semibold ${row.price_gap_pct >= 0 ? "text-amber-300" : "text-emerald-300"}`}>
                        {row.price_gap_pct >= 0 ? "+" : ""}
                        {row.price_gap_pct.toFixed(1)}%
                      </td>
                      <td className="py-1">{row.in_stock ? "In Stock" : "Out"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex flex-1 h-full overflow-y-auto">
            <ChatInterface />
          </div>
        </div>
      </div>
    </main>
  );
}
