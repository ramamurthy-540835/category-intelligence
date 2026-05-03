"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { ChatInterface } from "@/components/chat/ChatInterface";
import AgentControlCenter from "@/components/chat/AgentControlCenter";
import AlertTicker from "@/components/AlertTicker";
import { AgentStep, Status } from "@/lib/sse/useSSE"; // Assuming Status and AgentStep are exported

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

type OverviewPayload = {
  source?: string;
  timestamp?: string;
  alerts?: Alert[];
  rows?: Row[];
  error?: string; // To capture backend errors
  error_type?: string; // To capture specific error types like GCP_AUTH_MISSING
  run_id?: string; // To capture the run ID for event fetching
};

type FeedStatus = {
  status: string;
  active_skus?: number;
  latest_snapshot_rows?: number;
  latest_run?: { run_id: string; timestamp: string; skus_fetched: number; rows_written: number; status: string };
  error?: string; // To capture backend errors
  error_type?: string; // To capture specific error types like GCP_AUTH_MISSING
};

type AgentEvent = {
  run_id: string;
  timestamp: string;
  stage: string;
  status: string;
  message: string;
  requested_limit?: number;
  processed_rows?: number;
  total_skus?: number;
  error_type?: string;
};

const GCP_AUTH_MISSING_ERROR_TYPE = "GCP_AUTH_MISSING";
const BIGQUERY_TABLE_MISSING_ERROR_TYPE = "BIGQUERY_TABLE_MISSING";
const SERPAPI_KEY_MISSING_ERROR_TYPE = "CONFIG_ERROR"; // Assuming SERPAPI_KEY missing falls under config error

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
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [autoRefreshMins, setAutoRefreshMins] = useState(1);
  const [autoRefreshOn, setAutoRefreshOn] = useState(true);

  // Agent state for AgentControlCenter
  const [agentStatus, setAgentStatus] = useState<Status>('idle');
  const [agentSteps, setAgentSteps] = useState<{step: AgentStep, content: string}[]>([]);
  const [agentError, setAgentError] = useState<string | null>(null);

  const logEvent = (phase: string, message: string) => {
    // This is for frontend-side logging, not backend events
    setAgentEvents((prev) => [{ timestamp: new Date().toISOString(), stage: phase, status: 'INFO', message: message }, ...prev].slice(0, 20));
  };

  const mapBackendStageToAgentStep = (stage: string): AgentStep => {
    switch (stage) {
      case 'SENSING': return 'thinking';
      case 'FETCHING': return 'thinking';
      case 'PROCESSING': return 'analyzing';
      case 'ANALYZING': return 'analyzing';
      case 'UPDATING': return 'acting';
      case 'RESPONDING': return 'responding';
      case 'COMPLETE': return 'done';
      case 'ERROR': return 'error';
      default: return 'idle';
    }
  };

  const loadOverview = useCallback(async () => {
    const params = new URLSearchParams({ q: query, stock: stockFilter, limit: String(fetchSize), offset: "0" });
    const res = await fetch(`/api/dashboard/overview?${params.toString()}`, { cache: "no-store" });
    const data: OverviewPayload = await res.json();

    if (data.error_type === GCP_AUTH_MISSING_ERROR_TYPE) {
      setSource("❌ Auth Missing");
      setAlerts([{ priority: "P1", sku: "System", msg: "GCP Authentication Missing. Please log in." }]);
      setRows([]);
      setTimestamp("");
      setFeedStatus({ status: "error", error: data.message, error_type: data.error_type });
      setCurrentRunId(null); // Clear run ID on auth error
      return;
    }

    if (data.error) {
      setSource("Error");
      setAlerts([{ priority: "P1", sku: "System", msg: `Error loading data: ${data.error}` }]);
      setRows([]);
      setTimestamp("");
      setFeedStatus({ status: "error", error: data.error, error_type: data.error_type });
      setCurrentRunId(null); // Clear run ID on data error
      return;
    }

    if (Array.isArray(data.rows) && data.rows.length > 0) {
      setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
      setRows(data.rows);
      setSource(data.source || "unknown");
      setTimestamp(data.timestamp || "");
      setFeedStatus(prev => ({ ...prev, error: undefined, error_type: undefined })); // Clear previous errors
      setCurrentRunId(data.run_id || null); // Store the run ID if available
    } else {
      // Handle cases where data.rows might be empty but no explicit error
      setSource(data.source || "unknown");
      setTimestamp(data.timestamp || "");
      setAlerts([]);
      setRows([]);
      setCurrentRunId(data.run_id || null); // Store the run ID if available
    }
  }, [query, stockFilter, fetchSize]);

  const loadFeedStatus = useCallback(async () => {
    const res = await fetch("/api/feeds/prices/status", { cache: "no-store" });
    const data: FeedStatus = await res.json();

    if (data.error_type === GCP_AUTH_MISSING_ERROR_TYPE) {
      setFeedStatus({ status: "error", error: data.message, error_type: data.error_type });
      if (source !== "❌ Auth Missing") {
        setSource("❌ Auth Missing");
        setAlerts([{ priority: "P1", sku: "System", msg: "GCP Authentication Missing. Please log in." }]);
      }
      return;
    }

    if (data.status === "error") {
      setFeedStatus({ status: "error", error: data.error, error_type: data.error_type });
      if (source !== "Error") {
        setSource("Error");
        setAlerts([{ priority: "P1", sku: "System", msg: `Error loading feed status: ${data.error}` }]);
      }
      return;
    }

    setFeedStatus(data);
  }, [source]);

  const fetchAgentEvents = useCallback(async (runId: string | null) => {
    if (!runId) {
      setAgentEvents([]); // Clear events if no run ID
      return;
    }
    try {
      const res = await fetch(`/api/agent/events?run_id=${runId}`, { cache: "no-store" });
      const data = await res.json();
      if (data.events) {
        setAgentEvents(data.events);
      } else {
        setAgentEvents([]);
      }
    } catch (e) {
      console.error("Failed to fetch agent events:", e);
      setAgentEvents([]); // Clear events on error
    }
  }, []);

  const refreshData = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    logEvent("sensing", `Triggered data refresh`);
    try {
      // Initiate the refresh and get the run_id
      const refreshRes = await fetch(`/api/feeds/prices?limit=${fetchSize}`, { method: "POST", cache: "no-store" });
      const refreshData = await refreshRes.json();

      if (refreshData.status === "error") {
        logEvent("error", `Feed refresh failed: ${refreshData.message}`);
        setActionMsg(`Error: ${refreshData.message}`);
        setSource("Error");
        setAlerts([{ priority: "P1", sku: "System", msg: `Refresh failed: ${refreshData.message}` }]);
        setFeedStatus({ status: "error", error: refreshData.message, error_type: refreshData.error_type });
        setCurrentRunId(refreshData.run_id || null); // Capture run_id even on error
        await fetchAgentEvents(refreshData.run_id || null); // Fetch events for the failed run
      } else {
        setActionMsg(`Feed refresh initiated. Run ID: ${refreshData.run_id}. Check status.`);
        setCurrentRunId(refreshData.run_id || null); // Store the new run ID
        await fetchAgentEvents(refreshData.run_id || null); // Fetch initial events for the new run
        await loadOverview(); // Load overview to get latest snapshot data
        await loadFeedStatus(); // Load feed status
      }
    } catch (e: any) {
      logEvent("error", `Data refresh API call failed: ${e.message}`);
      setActionMsg(`Error initiating refresh: ${e.message}`);
      setSource("Error");
      setAlerts([{ priority: "P1", sku: "System", msg: "Failed to initiate data refresh." }]);
      setFeedStatus({ status: "error", error: e.message });
    } finally {
      setRefreshing(false);
    }
  }, [loadOverview, loadFeedStatus, fetchAgentEvents, refreshing, fetchSize]);

  useEffect(() => {
    // Initial load
    refreshData();

    // Auto-refresh interval
    const id = setInterval(refreshData, autoRefreshOn ? autoRefreshMins * 60000 : 3600000);
    return () => clearInterval(id);
  }, [autoRefreshMins, autoRefreshOn, refreshData]);

  // Fetch events periodically if a run is active
  useEffect(() => {
    if (currentRunId) {
      const eventInterval = setInterval(() => {
        fetchAgentEvents(currentRunId);
      }, 5000); // Fetch events every 5 seconds
      return () => clearInterval(eventInterval);
    }
  }, [currentRunId, fetchAgentEvents]);

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

  // Button text for refresh
  const refreshButtonText = refreshing ? "Fetching..." : "Refresh Now";

  // Determine if there's a critical error preventing data display
  const isSystemError = feedStatus.error_type === GCP_AUTH_MISSING_ERROR_TYPE ||
                        feedStatus.error_type === BIGQUERY_TABLE_MISSING_ERROR_TYPE ||
                        feedStatus.error_type === SERPAPI_KEY_MISSING_ERROR_TYPE ||
                        source === "❌ Auth Missing" || source === "Error";

  // Extract summary info from agent events
  const latestEvent = agentEvents.length > 0 ? agentEvents[0] : null;
  const currentStage = latestEvent ? latestEvent.stage : 'IDLE';
  const currentStatus = latestEvent ? latestEvent.status : 'IDLE';
  const currentMessage = latestEvent ? latestEvent.message : 'No events yet.';

  const progressSummary = {
    requested: feedStatus.latest_run?.skus_fetched ?? latestEvent?.requested_limit ?? fetchSize,
    active_skus: feedStatus.active_skus ?? latestEvent?.total_skus ?? '--',
    processed_rows: feedStatus.latest_run?.rows_written ?? latestEvent?.processed_rows ?? '--',
    latest_snapshot_rows: feedStatus.latest_snapshot_rows ?? '--',
    current_stage: currentStage,
    current_status: currentStatus,
    current_message: currentMessage,
    run_id: currentRunId,
    error_type: feedStatus.error_type || latestEvent?.error_type || null,
    error_message: feedStatus.error || latestEvent?.message || null,
  };

  // Update agent status and steps based on backend events
  useEffect(() => {
    if (isSystemError) {
      setAgentStatus('error');
      setAgentSteps([{step: 'error', content: 'System authentication error. Agent cannot run.'}]);
      setAgentError("GCP Authentication Missing or Configuration Error. Agent functionality is blocked.");
    } else if (latestEvent) {
      setAgentStatus(mapBackendStageToAgentStep(latestEvent.stage) as Status);
      setAgentSteps(prev => {
        // Add new event if it's different from the last one
        if (prev.length === 0 || prev[0].content !== latestEvent.message) {
          return [{step: mapBackendStageToAgentStep(latestEvent.stage), content: latestEvent.message}, ...prev].slice(0, 10); // Keep last 10 steps
        }
        return prev;
      });
      if (latestEvent.status === 'ERROR') {
        setAgentError(latestEvent.message);
      } else {
        setAgentError(null); // Clear error if not in error state
      }
    } else {
      setAgentStatus('idle');
      setAgentSteps([]);
      setAgentError(null);
    }
  }, [latestEvent, isSystemError]);


  return (
    <main className="flex min-h-screen flex-col bg-gray-950">
      <header className="bg-blue-900 px-6 py-3 flex items-center gap-4">
        <span className="font-bold text-yellow-400 text-lg">BBY</span>
        <span className="font-semibold text-white">Category Intelligence</span>
        <span className="text-xs text-blue-300 ml-1">POWERED BY ADEPT AI</span>
      </header>
      <div className="bg-slate-900 border-b border-slate-700 px-6 py-1.5 text-[11px] text-slate-300 flex items-center justify-between">
        <span>Data Source: <span className={source.includes("live") ? "text-emerald-300 font-semibold" : source.includes("Auth Missing") ? "text-red-400 font-semibold" : source.includes("Error") ? "text-red-400 font-semibold" : "text-amber-300 font-semibold"}>{source}</span></span>
        <span className="flex items-center gap-3">
          <span>Last Refresh: {timestamp ? new Date(timestamp).toLocaleTimeString() : "--"}</span>
          <span className={`px-2 py-0.5 rounded ${feedStatus.status === "ok" ? "bg-emerald-900 text-emerald-300" : feedStatus.status === "loading" ? "bg-gray-700 text-gray-300" : "bg-red-900 text-red-300"}`}>
            {feedStatus.status === "loading" ? "Loading..." : feedStatus.status === "ok" ? "Connected" : "Error"}
          </span>
        </span>
      </div>
      <AlertTicker alerts={alerts} />
      <div className="flex flex-1 p-4 gap-4">
        <div className="w-[30%] flex flex-col gap-3 h-full overflow-y-auto">
          <AgentControlCenter
            status={isSystemError ? 'error' : agentStatus}
            steps={isSystemError ? [{step: 'error', content: 'System authentication error. Agent cannot run.'}] : agentSteps}
            error={isSystemError ? "GCP Authentication Missing or Configuration Error. Agent functionality is blocked." : agentError}
            alerts={alerts}
          />
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 text-[11px] text-slate-200">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold">Agent Timeline</h4>
              <button onClick={refreshData} disabled={refreshing || isSystemError} className="px-2 py-1 rounded bg-blue-700 text-white disabled:opacity-50">{refreshing ? "Fetching..." : "Refresh Now"}</button>
            </div>
            <div className="mb-2 flex items-center gap-2">
              <label className="text-slate-300">Fetch Limit</label>
              <input
                type="number"
                min={1}
                max={5000}
                value={fetchSize}
                onChange={(e) => setFetchSize(Math.max(1, Number(e.target.value) || 1))}
                disabled={isSystemError || refreshing}
                className="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200"
              />
            </div>
            <div className="mb-2 flex items-center gap-2">
              <label className="text-slate-300">Auto Refresh</label>
              <input type="checkbox" checked={autoRefreshOn} onChange={(e) => setAutoRefreshOn(e.target.checked)} disabled={isSystemError} />
              <select value={String(autoRefreshMins)} onChange={(e) => setAutoRefreshMins(Number(e.target.value))} disabled={isSystemError} className="bg-slate-800 border border-slate-700 rounded px-1 py-0.5">
                <option value="1">1m</option>
                <option value="5">5m</option>
                <option value="15">15m</option>
              </select>
            </div>
            <div className="mb-2 text-slate-300">Run ID: {progressSummary.run_id || "--"}</div>
            <div className="mb-2 text-slate-300">Requested: {progressSummary.requested} · Active SKUs: {progressSummary.active_skus}</div>
            <div className="mb-2 text-slate-300">Rows Written: {progressSummary.processed_rows} · Snapshot Rows: {progressSummary.latest_snapshot_rows}</div>
            <div className="max-h-52 overflow-y-auto space-y-1">
              {agentEvents.length === 0 ? <div className="text-slate-500">No agent events yet.</div> : agentEvents.map((e, i) => (
                <div key={i} className="bg-slate-800 rounded p-1">
                  <span className="text-emerald-300">{new Date(e.timestamp).toLocaleTimeString()}</span> [{e.stage}] [{e.status}] {e.message}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="w-[70%] flex flex-col gap-3 h-full overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-white">Live Pricing Intelligence</h3>
              <span className={`text-[11px] ${isSystemError ? 'text-red-400' : 'text-slate-400'}`}>
                {isSystemError ? "System Error" : `${filteredRows.length} SKUs`}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-3">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search SKU..." disabled={isSystemError} className="md:col-span-2 bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700" />
              <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value as "all" | "in" | "out")} disabled={isSystemError} className="bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700"><option value="all">All Stock</option><option value="in">In Stock</option><option value="out">Out of Stock</option></select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "gap_desc" | "gap_asc" | "name")} disabled={isSystemError} className="bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700"><option value="gap_desc">Largest Gap</option><option value="gap_asc">Smallest Gap</option><option value="name">Name</option></select>
              <select value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} disabled={isSystemError} className="bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700"><option value="10">10/page</option><option value="20">20/page</option><option value="50">50/page</option></select>
            </div>
            {isSystemError ? (
              <div className="text-red-400 text-center py-4">
                <p className="font-semibold">System Error: {feedStatus.error_type || "Unknown Error"}</p>
                <p className="text-sm">{feedStatus.error || "Please check system configuration."}</p>
                {feedStatus.error_type === GCP_AUTH_MISSING_ERROR_TYPE && <p className="text-xs mt-1">Run: <code>gcloud auth application-default login</code></p>}
                {feedStatus.error_type === BIGQUERY_TABLE_MISSING_ERROR_TYPE && <p className="text-xs mt-1">Table: {feedStatus.error?.replace("BigQuery table not found: ", "")}</p>}
                {feedStatus.error_type === SERPAPI_KEY_MISSING_ERROR_TYPE && <p className="text-xs mt-1">Ensure SERPAPI_KEY is set in your .env.local</p>}
              </div>
            ) : (
              <>
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
                  <div className="flex gap-1"><button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1 || isSystemError} className="px-2 py-1 rounded bg-slate-800 border border-slate-700 disabled:opacity-40">Prev</button><button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages || isSystemError} className="px-2 py-1 rounded bg-slate-800 border border-slate-700 disabled:opacity-40">Next</button></div>
                </div>
              </>
            )}
          </div>
          {selected && !isSystemError && (
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
