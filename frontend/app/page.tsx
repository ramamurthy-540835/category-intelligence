"use client";

import React from "react"; // Import React
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import AgentControlCenter from "@/components/chat/AgentControlCenter";
import AlertTicker from "@/components/AlertTicker";
import DemoFlowsSidebar from "@/components/DemoFlowsSidebar";
import LiveTicker from "@/components/LiveTicker";
import ChatPanel from "@/components/ChatPanel";
import FlyoutCard from "@/components/FlyoutCard";
import BQExplorer from "@/components/BQExplorer";
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
  warning?: string;
  error?: string; // To capture backend errors
  error_type?: string; // To capture specific error types like GCP_AUTH_MISSING
};

type AgentEvent = {
  run_id: string;
  timestamp: string;
  stage: string;
  status: string;
  message: string;
  requested_skus?: number;
  active_skus?: number;
  processed_rows?: number;
  written_rows?: number;
  snapshot_rows?: number;
  external_source_status?: string;
  error_type?: string;
  fix?: string;
};

type ActionRecord = {
  timestamp: string;
  action: string;
  sku_id: string;
  sku_name: string;
  status: string;
  message: string;
};

const GCP_AUTH_MISSING_ERROR_TYPE = "GCP_AUTH_MISSING";
const BIGQUERY_TABLE_MISSING_ERROR_TYPE = "BIGQUERY_TABLE_MISSING";
const SERPAPI_KEY_MISSING_ERROR_TYPE = "CONFIG_ERROR"; // Assuming SERPAPI_KEY missing falls under config error
const SERPAPI_CONNECTIVITY_ERROR_TYPE = "SERPAPI_CONNECTIVITY_ERROR";

export default function Home() {
  const hasInitialized = useRef(false);
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
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionHistory, setActionHistory] = useState<ActionRecord[]>([]);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  // Auto-refresh re-reads the latest BigQuery snapshot only — it never
  // triggers a SerpAPI scan. Manual scans go through the "Run External
  // Scan" button, which still calls refreshData().
  const [autoRefreshMins, setAutoRefreshMins] = useState(5);
  const [autoRefreshOn, setAutoRefreshOn] = useState(false);

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
      case 'ENRICHING': return 'analyzing'; // Map Enriching to Analyze
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
    
    if (!res.ok) {
      // Handle non-OK responses more gracefully
      let errorData = { message: `HTTP error! status: ${res.status}`, error_type: "HTTP_ERROR" };
      try {
        const errorJson = await res.json();
        errorData = { ...errorData, ...errorJson };
      } catch (e) {
        // Ignore if response is not JSON
      }
      setSource("Error");
      setAlerts([{ priority: "P1", sku: "System", msg: `Error loading data: ${errorData.message}` }]);
      setRows([]);
      setTimestamp("");
      setFeedStatus({ status: "error", error: errorData.message, error_type: errorData.error_type });
      setCurrentRunId(null);
      return;
    }

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
      // Fallback: load latest snapshot rows directly when overview is empty.
      try {
        const latestRes = await fetch("/api/feeds/prices/latest", { cache: "no-store" });
        if (latestRes.ok) {
          const latestRows = await latestRes.json();
          if (Array.isArray(latestRows) && latestRows.length > 0) {
            setRows(latestRows);
            setSource("bigquery-snapshot");
            setTimestamp(latestRows[0]?.snapshot_time || data.timestamp || "");
            setAlerts([]);
            setCurrentRunId(data.run_id || null);
            return;
          }
        }
      } catch (_e) {
        // Keep normal empty-state behavior below if fallback fails.
      }

      setSource(data.source || "unknown");
      setTimestamp(data.timestamp || "");
      setAlerts([]);
      setRows([]);
      setCurrentRunId(data.run_id || null);
    }
  }, [query, stockFilter, fetchSize]);

  const loadFeedStatus = useCallback(async () => {
    const res = await fetch("/api/feeds/prices/status", { cache: "no-store" });
    
    if (!res.ok) {
      let errorData = { message: `HTTP error! status: ${res.status}`, error_type: "HTTP_ERROR" };
      try {
        const errorJson = await res.json();
        errorData = { ...errorData, ...errorJson };
      } catch (e) {
        // Ignore if response is not JSON
      }
      setFeedStatus({ status: "error", error: errorData.message, error_type: errorData.error_type });
      if (source !== "Error") {
        setSource("Error");
        setAlerts([{ priority: "P1", sku: "System", msg: `Error loading feed status: ${errorData.message}` }]);
      }
      return;
    }

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

    const normalizedStatus = data.status === "no_runs" ? "ok" : data.status;
    setFeedStatus({ ...data, status: normalizedStatus });
  }, [source]);

  const fetchAgentEvents = useCallback(async (_runId: string | null) => {
    try {
      if (_runId) {
        const eventsRes = await fetch(`/api/agent/events?run_id=${encodeURIComponent(_runId)}`, { cache: "no-store" });
        if (eventsRes.ok) {
          const eventsData = await eventsRes.json();
          if (Array.isArray(eventsData.events) && eventsData.events.length > 0) {
            setAgentEvents(eventsData.events);
            return;
          }
        }
      }

      const statusRes = await fetch(`/api/agent/status`, { cache: "no-store" });
      if (!statusRes.ok) throw new Error(`Failed to fetch events: ${statusRes.status}`);
      const statusData = await statusRes.json();
      if (Array.isArray(statusData.events)) {
        setAgentEvents(statusData.events);
        if (statusData.active_run?.run_id) setCurrentRunId(statusData.active_run.run_id);
      } else {
        setAgentEvents([]);
      }
    } catch (e) {
      console.error("Failed to fetch agent events:", e);
      // Keep existing events if fetch fails to avoid UI flicker to idle.
    }
  }, []);

  const refreshData = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    logEvent("sensing", `Triggered data refresh`);
    try {
      // Initiate the refresh and get the run_id
      const refreshRes = await fetch(`/api/feeds/prices?limit=${fetchSize}`, { method: "POST", cache: "no-store" });
      
      if (!refreshRes.ok) {
        let errorData = { message: `HTTP error! status: ${refreshRes.status}`, error_type: "HTTP_ERROR" };
        try {
          const errorJson = await refreshRes.json();
          errorData = { ...errorData, ...errorJson };
        } catch (e) {
          // Ignore if response is not JSON
        }
        throw new Error(errorData.message);
      }

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

  const triggerAction = useCallback(async (actionType: string, payload: any) => {
    setActionLoading(actionType);
    setActionMsg(`Running ${actionType}...`);
    try {
      const res = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action_type: actionType,
          payload,
          user_id: "ui-user",
          user_role: "admin",
        }),
      });
      const raw = await res.text();
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        const backendMsg = data?.message || data?.detail || data?.error || raw;
        throw new Error(backendMsg || `Action failed: ${res.status}`);
      }
      setActionMsg(data?.message || `${actionType} completed.`);
      if (data?.action_record) {
        setActionHistory((prev) => [data.action_record as ActionRecord, ...prev].slice(0, 10));
      }
    } catch (e: any) {
      setActionMsg(`Action error (${actionType}): ${e?.message || "unknown error"}`);
    } finally {
      setActionLoading(null);
    }
  }, []);

  useEffect(() => {
    // On page load: read the latest BigQuery snapshot — do NOT trigger a
    // SerpAPI scan. A scan costs ~100 SerpAPI calls per click and was
    // previously firing on every mount + every minute.
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      loadOverview();
      loadFeedStatus();
      fetchAgentEvents(null);
    }

    if (!autoRefreshOn) return;
    // Auto-refresh only re-reads BigQuery (cheap). SerpAPI scans stay manual.
    const id = setInterval(() => {
      loadOverview();
      loadFeedStatus();
    }, autoRefreshMins * 60000);
    return () => clearInterval(id);
  }, [autoRefreshMins, autoRefreshOn, loadOverview, loadFeedStatus, fetchAgentEvents]);

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
  const refreshButtonText = refreshing ? "Scanning..." : "Run External Scan";

  // Determine if there's a critical error preventing data display
  const isSystemError = feedStatus.error_type === GCP_AUTH_MISSING_ERROR_TYPE ||
                        feedStatus.error_type === BIGQUERY_TABLE_MISSING_ERROR_TYPE ||
                        feedStatus.error_type === SERPAPI_KEY_MISSING_ERROR_TYPE ||
                        feedStatus.error_type === SERPAPI_CONNECTIVITY_ERROR_TYPE ||
                        source === "❌ Auth Missing" || source === "Error";

  // Extract summary info from agent events
  const latestEvent = agentEvents.length > 0 ? agentEvents[0] : null;
  const currentStage = latestEvent ? latestEvent.stage : 'IDLE';
  const currentStatus = latestEvent ? latestEvent.status : 'IDLE';
  const currentMessage = latestEvent ? latestEvent.message : 'No events yet.';

  const progressSummary = {
    requested: feedStatus.latest_run?.skus_fetched ?? latestEvent?.requested_skus ?? fetchSize,
    active_skus: feedStatus.active_skus ?? latestEvent?.active_skus ?? '--',
    processed_rows: feedStatus.latest_run?.rows_written ?? latestEvent?.processed_rows ?? '--',
    written_rows: feedStatus.latest_run?.rows_written ?? latestEvent?.written_rows ?? '--',
    snapshot_rows: feedStatus.latest_snapshot_rows ?? latestEvent?.snapshot_rows ?? '--',
    current_stage: currentStage,
    current_status: currentStatus,
    current_message: currentMessage,
    run_id: currentRunId,
    error_type: feedStatus.error_type || latestEvent?.error_type || null,
    error_message: feedStatus.error || latestEvent?.message || null,
    fix: feedStatus.error_type === BIGQUERY_TABLE_MISSING_ERROR_TYPE ? `Table: ${feedStatus.error?.replace("BigQuery table not found: ", "")}` : latestEvent?.fix || null,
  };
  const requestedNum = Number(progressSummary.requested || 0);
  const activeNum = Number(progressSummary.active_skus || 0);
  const externalAdded = Math.max(0, requestedNum - activeNum);
  const enrichSuccessEvent = agentEvents.find((e) => e.stage === "ENRICHING" && e.status === "SUCCESS");
  const matchedCount = enrichSuccessEvent ? Number((enrichSuccessEvent.message.match(/(\d+)/)?.[1] || 0)) : 0;
  const latestErrorEvent = agentEvents.find((e) => e.status === "ERROR");
  const compactError = latestErrorEvent?.message?.includes("BigQuery insert errors:")
    ? `BigQuery schema mismatch during insert (${(latestErrorEvent.message.match(/'index':/g) || []).length} row errors).`
    : latestErrorEvent?.message || null;

  const feedErrorText = (feedStatus.error || "").toLowerCase();
  const isBigQueryDown = feedStatus.error_type === GCP_AUTH_MISSING_ERROR_TYPE ||
    (feedStatus.error_type === BIGQUERY_TABLE_MISSING_ERROR_TYPE && feedErrorText.includes("competitor_price_snapshots"));
  const isSkuMasterDown = feedStatus.error_type === BIGQUERY_TABLE_MISSING_ERROR_TYPE &&
    feedErrorText.includes("sku_master");
  const isSerpApiDown = feedStatus.error_type === SERPAPI_CONNECTIVITY_ERROR_TYPE ||
    (feedStatus.error_type === SERPAPI_KEY_MISSING_ERROR_TYPE && feedErrorText.includes("serpapi"));

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


  // Demo KPI tiles — values mirror the Azure reference build until backend KPI
  // endpoints exist. Tile set swaps as the user picks a different demo flow
  // from the sidebar. activeFlowId is updated below via the `cat-flow-event`
  // window event that DemoFlowsSidebar dispatches.
  type KpiTile = { label: string; value: string; delta: string; color: "green" | "red" };
  const FLOW_KPIS: Record<string, KpiTile[]> = {
    "category-overview": [
      { label: "CATEGORY REV", value: "$33.1M", delta: "▲▲ +6.2% vs plan / +14.8% YOY", color: "green" },
      { label: "AVG MARGIN %", value: "22.3%",  delta: "▲▲ +1.8pts vs Q4 plan",          color: "green" },
      { label: "INV. HEALTH",  value: "74/100", delta: "▲▲ Avg 22d DoS — healthy range", color: "green" },
      { label: "FCST ACCY",    value: "78%",    delta: "▼▼ -7pts vs 85% target",         color: "red"   },
    ],
    "health-check": [
      { label: "BELOW FCST",    value: "18",    delta: "▼▼ 38% of 47 active SKUs",          color: "red" },
      { label: "OVERSTK COST",  value: "$2.1M", delta: "▲ +$340K vs 90 days ago",            color: "red" },
      { label: "PROMO ROAS",    value: "2.1×",  delta: "▼▼ vs 4.2× target",                   color: "red" },
      { label: "STOCKOUT RISK", value: "5",     delta: "▼▼ Within next 14 days",              color: "red" },
    ],
    "diagnose-lg-c3": [
      { label: "C3 VS FCST",    value: "-31%",  delta: "▼▼ Worst performer in category",      color: "red"   },
      { label: "DAYS SUPPLY",   value: "41d",   delta: "▼▼ 2× category avg of 20 days",       color: "red"   },
      { label: "PROMO LIFT",    value: "8%",    delta: "▼▼ vs 22% planned — 64% miss",        color: "red"   },
      { label: "PROJ RECOVERY", value: "420u",  delta: "▲ via vendor co-op (6 wks)",          color: "green" },
    ],
    "simulate-samsung": [
      { label: "BEST UNITS",    value: "2,710", delta: "▲▲ +47% vs baseline (+870 units)",    color: "green" },
      { label: "BEST REVENUE",  value: "$4.3M", delta: "▲▲ +$1.1M vs baseline",                color: "green" },
      { label: "BEST MARGIN",   value: "$796K", delta: "▲▲ +$82K vs baseline (+11.5%)",        color: "green" },
      { label: "STOCKOUT RISK", value: "3 Stores", delta: "▼▼ Houston, Schaumburg, Tysons",   color: "red"   },
    ],
    "price-vs-amazon": [
      { label: "ABOVE AMAZON",   value: "8 SKUs",  delta: "▼▼ Top 10 hero TVs",             color: "red" },
      { label: "MARGIN AT RISK", value: "$430K",   delta: "▼▼ If no reprice action",         color: "red" },
      { label: "AVG PRICE GAP",  value: "-7.7%",   delta: "▼▼ vs Amazon baseline",            color: "red" },
      { label: "URGENT REPRICE", value: "3 SKUs",  delta: "▼▼ Gap > 10%",                     color: "red" },
    ],
    "ad-plan-optimizer": [
      { label: "CO-OP AVAILABLE",  value: "$143K", delta: "▲ Across 4 vendors",       color: "green" },
      { label: "EXPIRING SOON",    value: "$43K",  delta: "▼▼ Hisense — Dec 31",      color: "red"   },
      { label: "BEST ROAS",        value: "4.1×",  delta: "▲▲ SMS channel",            color: "green" },
      { label: "CAMPAIGNS READY",  value: "6",     delta: "▲ Awaiting approval",        color: "green" },
    ],
  };

  const [activeFlowId, setActiveFlowId] = useState<string>("category-overview");
  useEffect(() => {
    const onFlow = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === "object" && (detail as any).flowId) {
        setActiveFlowId((detail as any).flowId);
      }
    };
    window.addEventListener("cat-flow-event", onFlow);
    return () => window.removeEventListener("cat-flow-event", onFlow);
  }, []);

  const kpiTiles = FLOW_KPIS[activeFlowId] ?? FLOW_KPIS["category-overview"];

  // Quick Actions and demo flows now live in <DemoFlowsSidebar />, so the
  // inline panel that used to sit above AgentControlCenter has been removed.

  const [bqOpen, setBqOpen] = useState(false);
  useEffect(() => {
    if (!bqOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setBqOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bqOpen]);

  const topTabs = [
    { id: "category",   icon: "📊", label: "Category",   active: true  },
    { id: "promotions", icon: "📈", label: "Promotions", active: false },
    { id: "loyalty",    icon: "👑", label: "Loyalty",    active: false },
    { id: "returns",    icon: "🔄", label: "Returns",    active: false },
  ];

  return (
    <div className="flex h-screen bg-gray-950">
      <DemoFlowsSidebar activeFlowId={activeFlowId} onFlowSelect={(_, id) => setActiveFlowId(id)} />
      <main className="flex-1 flex flex-col overflow-auto">
      <LiveTicker alerts={alerts} />
      {/* Brand bar — Best Buy royal blue (#003087) with yellow logo block and Adept attribution */}
      <header className="px-4 h-14 flex items-center justify-between bg-bby-blue">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-sm bg-bby-yellow text-bby-blue font-extrabold text-[10px] leading-tight text-center">BEST<br/>BUY</span>
          <span className="text-white font-semibold text-base">Category Intelligence</span>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider text-bby-yellow border border-bby-yellow/30">POWERED BY ADEPT AI</span>
          <span className="hidden md:inline text-[12px] text-white/70 ml-3">Home Theater <span className="text-white/40">›</span> Q4 2024 Review</span>
        </div>
        <div className="flex items-center gap-2 text-[12px]">
          <button
            type="button"
            onClick={() => setBqOpen(true)}
            className="px-3 py-1.5 rounded border border-white/30 text-white hover:bg-white/10 flex items-center gap-1"
            title="Open BigQuery Explorer"
          >
            🗄️ Data
          </button>
          <button className="px-3 py-1.5 rounded border border-white/30 text-white hover:bg-white/10" type="button">Export PDF</button>
          <button className="px-3 py-1.5 rounded bg-bby-yellow text-bby-blue font-semibold hover:bg-yellow-300" type="button">Export PPT</button>
          <span className="ml-2 inline-flex items-center justify-center w-8 h-8 rounded-full bg-bby-accent text-white text-xs font-semibold">AC</span>
        </div>
      </header>

      {/* Top navigation tabs — Category / Promotions / Loyalty / Returns */}
      <nav className="px-6 flex items-center gap-1 text-sm bg-bby-dark border-b border-[var(--bby-border-subtle)]">
        {topTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={
              "px-4 py-2 -mb-px border-b-2 transition-colors " +
              (t.active
                ? "border-bby-accent text-white font-semibold"
                : "border-transparent text-slate-400 hover:text-slate-200")
            }
            disabled={!t.active}
            title={t.active ? undefined : "Coming soon"}
          >
            <span className="mr-1.5">{t.icon}</span>{t.label}
          </button>
        ))}
      </nav>

      {/* Status / data-source strip */}
      <div className="bg-bby-surface border-b border-[var(--bby-border-subtle)] px-6 py-1.5 text-[11px] text-slate-300 flex items-center justify-between">
        <span>Data Source: <span className={source.includes("live") ? "text-emerald-300 font-semibold" : source.includes("Auth Missing") ? "text-red-400 font-semibold" : source.includes("Error") ? "text-red-400 font-semibold" : "text-amber-300 font-semibold"}>{source}</span></span>
        <span className="flex items-center gap-3">
          <span>Last Refresh: {timestamp ? new Date(timestamp).toLocaleTimeString() : "--"}</span>
          <span className={`px-2 py-0.5 rounded ${feedStatus.status === "ok" ? "bg-emerald-900 text-emerald-300" : feedStatus.status === "stale" ? "bg-amber-900 text-amber-300" : feedStatus.status === "loading" ? "bg-gray-700 text-gray-300" : "bg-red-900 text-red-300"}`}>
            {feedStatus.status === "loading" ? "Loading..." : feedStatus.status === "ok" ? "Connected" : feedStatus.status === "stale" ? "No New Data" : "Error"}
          </span>
        </span>
      </div>

      {/* KPI scorecard row — 4 tiles mirroring Azure reference */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 py-2 bg-bby-dark border-b border-[var(--bby-border-subtle)]">
        {kpiTiles.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-md px-3 py-2"
            style={{ background: "var(--bby-kpi-bg)", border: "1px solid var(--bby-kpi-border)" }}
          >
            <div className="text-[9px] tracking-widest uppercase font-semibold" style={{ color: "var(--bby-kpi-label)" }}>{kpi.label}</div>
            <div className="text-[20px] font-bold leading-none mt-0.5 text-white">{kpi.value}</div>
            <div className={"text-[10px] mt-0.5 " + (kpi.color === "green" ? "text-emerald-400" : "text-red-400")}>{kpi.delta}</div>
          </div>
        ))}
      </div>

      <AlertTicker alerts={alerts} />
      <div className="flex flex-1 p-4 gap-4 min-h-0">
        <div className="w-[26%] flex flex-col gap-3 h-full overflow-y-auto">
          <FlyoutCard
            title="Agents in Action"
            subtitle="Live execution monitor"
            icon="🔄"
            badge={
              <span
                className={
                  "text-[11px] " +
                  (progressSummary.current_status === "ERROR" ? "text-red-400"
                    : progressSummary.current_status === "RUNNING" ? "text-amber-300"
                    : progressSummary.current_status === "SUCCESS" ? "text-emerald-300"
                    : "text-slate-400")
                }
              >
                {progressSummary.current_stage || "IDLE"}
              </span>
            }
            preview={
              <div className="text-[10px] leading-relaxed text-[#64748b] w-full">
                <div className="flex justify-between mb-0.5">
                  <span>Stage</span>
                  <span className="text-slate-200">
                    {(() => {
                      const stage = progressSummary.current_stage || 'IDLE';
                      const status = progressSummary.current_status || '';
                      // Hide "IDLE IDLE" / dupe collapses to just the stage name.
                      if (!status || status === stage) return stage;
                      return `${stage} ${status}`;
                    })()}
                  </span>
                </div>
                <div className="flex justify-between mb-0.5">
                  <span>Target</span>
                  <span className="text-slate-200">{fetchSize} SKUs</span>
                </div>
                <div className="flex justify-between">
                  <span>Errors</span>
                  <span className={agentEvents.filter(e => e.status === 'ERROR').length > 0 ? "text-red-400 font-semibold" : "text-emerald-400 font-semibold"}>
                    {agentEvents.filter(e => e.status === 'ERROR').length}
                  </span>
                </div>
              </div>
            }
            defaultWidth="w-full"
          >
          <div className="bg-slate-900 border-t border-slate-800 p-3 text-[11px] text-slate-200">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-semibold">Pipeline Stages</h4>
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-slate-400">Target</label>
                <input
                  type="number"
                  min={10}
                  max={1000}
                  step={10}
                  value={fetchSize}
                  onChange={(e) => setFetchSize(Math.max(10, Math.min(1000, Number(e.target.value) || 10)))}
                  disabled={refreshing || isSystemError}
                  className="w-20 bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700"
                  title="External scan target"
                />
                <button onClick={refreshData} disabled={refreshing || isSystemError} className="px-2 py-1 rounded bg-blue-700 text-white disabled:opacity-50">{refreshButtonText}</button>
              </div>
            </div>
            {/* Pipeline Stages Grid (3 rows for better readability) */}
            <div className="grid grid-cols-3 gap-2 mb-3 text-xs font-medium">
              {['SENSING', 'FETCHING', 'ENRICHING', 'PROCESSING', 'ANALYZING', 'UPDATING', 'RESPONDING'].map((stage) => {
                const stageEvent = agentEvents.find(e => e.stage === stage);
                const stageStatus = stageEvent?.status || 'pending';
                const isCurrent = latestEvent?.stage === stage;
                const isCompleted = stageStatus === 'SUCCESS';
                const isError = stageStatus === 'ERROR' || stageStatus === 'FAILED';

                let bgColor = 'bg-gray-700'; // Pending
                if (isError) bgColor = 'bg-red-600';
                else if (isCurrent && !isError) bgColor = 'bg-blue-500 animate-pulse';
                else if (isCompleted) bgColor = 'bg-green-500';

                return (
                  <div key={stage} className={`px-2 py-1 rounded-md ${bgColor} text-white text-center`}>
                    <div className="text-[10px] opacity-90 flex items-center justify-center gap-1">
                      <span>{isError ? "✕" : isCompleted ? "✓" : isCurrent ? "●" : "○"}</span>
                      <span>{stage.substring(0, 3)}</span>
                    </div>
                    <div className="text-[9px] text-slate-100/90">{String(stageStatus).toLowerCase()}</div>
                  </div>
                );
              })}
            </div>

            {/* Metrics Cards */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-slate-800 p-1.5 rounded">
                <div className="text-slate-400 text-[10px]">Requested</div>
                <div className="font-semibold text-white">{progressSummary.requested}</div>
              </div>
              <div className="bg-slate-800 p-1.5 rounded">
                <div className="text-slate-400 text-[10px]">Active SKUs</div>
                <div className="font-semibold text-white">{progressSummary.active_skus}</div>
              </div>
              <div className="bg-slate-800 p-1.5 rounded">
                <div className="text-slate-400 text-[10px]">Processed</div>
                <div className="font-semibold text-white">{progressSummary.processed_rows}</div>
              </div>
              <div className="bg-slate-800 p-1.5 rounded">
                <div className="text-slate-400 text-[10px]">Written</div>
                <div className="font-semibold text-white">{progressSummary.written_rows}</div>
              </div>
              <div className="bg-slate-800 p-1.5 rounded">
                <div className="text-slate-400 text-[10px]">Snapshot Rows</div>
                <div className="font-semibold text-white">{progressSummary.snapshot_rows}</div>
              </div>
              <div className="bg-slate-800 p-1.5 rounded">
                <div className="text-slate-400 text-[10px]">Errors</div>
                <div className="font-semibold text-white">{agentEvents.filter(e => e.status === 'ERROR').length}</div>
              </div>
            </div>
            <div className="mb-3 bg-slate-800 rounded p-2 text-[10px] text-slate-300">
              <div className="font-semibold text-slate-200 mb-1">Run Summary</div>
              <div>Requested: <span className="text-slate-100">{requestedNum}</span> | Base Active: <span className="text-slate-100">{activeNum}</span> | External Added: <span className="text-slate-100">{externalAdded}</span></div>
              <div>SerpAPI Matched: <span className="text-slate-100">{matchedCount}</span> | Written to BigQuery: <span className="text-slate-100">{progressSummary.written_rows}</span></div>
              {compactError && <div className="text-red-300 mt-1">Latest Error: {compactError}</div>}
            </div>

            {/* External Connections */}
            <div className="mb-3">
              <h5 className="font-semibold text-slate-300 mb-1">External Connections</h5>
              <div className="grid grid-cols-1 gap-1 text-[10px]">
                <div className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${isSerpApiDown ? 'bg-red-500' : 'bg-green-500'}`}></span>SERPAPI External Scan</div>
              </div>
            </div>

            {/* Current Stage */}
            <div className="mb-2">
              <h5 className="font-semibold text-slate-300 mb-1">Current Stage</h5>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${progressSummary.current_status === 'SUCCESS' ? 'bg-green-600' : progressSummary.current_status === 'ERROR' ? 'bg-red-600' : progressSummary.current_status === 'RUNNING' ? 'bg-blue-600 animate-pulse' : 'bg-gray-700'}`}>
                  {progressSummary.current_stage} [{progressSummary.current_status}]
                </span>
                <span className="text-slate-400 flex-1 truncate">{progressSummary.current_message}</span>
              </div>
            </div>

            {/* Backend Detail */}
            <div className="mb-2">
              <h5 className="font-semibold text-slate-300 mb-1">Backend Detail</h5>
              <div className="bg-slate-800 rounded p-2 text-[10px] text-slate-300">
                <div>Run ID: <span className="text-slate-100">{progressSummary.run_id || "--"}</span></div>
                <div>Status: <span className="text-slate-100">{progressSummary.current_status || "--"}</span></div>
                <div>Message: <span className="text-slate-100">{progressSummary.current_message || "--"}</span></div>
                {progressSummary.error_type && <div>Error: <span className="text-red-300">{progressSummary.error_type}</span></div>}
                {compactError && <div>Latest Error Detail: <span className="text-red-300">{compactError}</span></div>}
              </div>
            </div>

            {/* Live Event Log */}
            <div className="max-h-56 overflow-y-auto space-y-1 pr-1 rounded border border-slate-800 p-1">
              {agentEvents.length === 0 ? <div className="text-slate-500">No agent events yet.</div> : agentEvents.map((e, i) => (
                <div key={i} className="bg-slate-800 rounded p-1">
                  <span className="text-emerald-300">{new Date(e.timestamp).toLocaleTimeString()}</span> [{e.stage}] [{e.status}] {e.message}
                  {e.error_type && <span className="text-red-400 ml-2">({e.error_type})</span>}
                  {e.fix && <div className="text-red-400 text-xs ml-2">Fix: {e.fix}</div>}
                </div>
              ))}
            </div>
          </div>
          </FlyoutCard>
        </div>
        <div className="flex-1 min-w-0 h-full flex flex-col">
          {/* ChatPanel renders directly (not inside FlyoutCard) so it's
              always mounted. That's required for the sidebar's
              cat-flow-prompt dispatch to reach it and for ChatPanel to
              broadcast cat-chat-status events the Strategy Loop listens to. */}
          <ChatPanel />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-3 h-full overflow-y-auto">
          <FlyoutCard
            title="Live Pricing Intelligence"
            subtitle={isSystemError ? "System Error" : "bigquery-live"}
            icon="💹"
            badge={
              <span className={`text-[11px] ${isSystemError ? 'text-red-400' : 'text-[#94a3b8]'}`}>
                {isSystemError ? "System Error" : `${filteredRows.length} SKUs`}
              </span>
            }
            preview={
              filteredRows.length > 0 ? (
                <div className="text-[10px] leading-relaxed w-full">
                  {filteredRows.slice(0, 3).map((row, i) => {
                    const name = row.name || row.sku_name || row.sku_id;
                    const gap = Number(row.price_gap_pct ?? 0) || 0;
                    return (
                      <div key={i} className="flex justify-between mb-0.5 gap-2">
                        <span className="text-slate-200 truncate" style={{ maxWidth: '60%' }}>{name}</span>
                        <span className={"font-semibold flex-shrink-0 " + (gap < 0 ? "text-emerald-400" : "text-red-400")}>
                          {gap > 0 ? '+' : ''}{gap.toFixed(1)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : isSystemError ? (
                <span className="text-[10px] text-red-400 italic">Backend unavailable</span>
              ) : rows.length === 0 ? (
                <span className="text-[10px] text-[#475569] italic">Loading pricing data…</span>
              ) : (
                <span className="text-[10px] text-[#475569] italic">No SKUs match filter</span>
              )
            }
            defaultWidth="w-full"
          >
          <div className="bg-slate-900 border-t border-slate-800 p-3">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-3">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search SKU..." disabled={isSystemError} className="md:col-span-2 bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700" />
              <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value as "all" | "in" | "out")} disabled={isSystemError} className="bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700"><option value="all">All Stock</option><option value="in">In Stock</option><option value="out">Out of Stock</option></select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "gap_desc" | "gap_asc" | "name")} disabled={isSystemError} className="bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700"><option value="gap_desc">Largest Gap</option><option value="gap_asc">Smallest Gap</option><option value="name">Name</option></select>
              <select value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} disabled={isSystemError} className="bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-1 border border-slate-700"><option value="10">10/page</option><option value="20">20/page</option><option value="50">50/page</option></select>
            </div>
            {isSystemError ? (
              <div className="text-red-400 text-center py-4">
                <p className="font-semibold">System Error: {progressSummary.error_type || "Unknown Error"}</p>
                <p className="text-sm">{progressSummary.error_message || "Please check system configuration."}</p>
                {progressSummary.fix && <p className="text-xs mt-1">{progressSummary.fix}</p>}
                {progressSummary.error_type === GCP_AUTH_MISSING_ERROR_TYPE && <p className="text-xs mt-1">Run: <code>gcloud auth application-default login</code></p>}
              </div>
            ) : (
              <>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-[11px] text-left">
                    <thead className="text-slate-400 border-b border-slate-700"><tr><th className="py-1">SKU</th><th className="py-1">Our</th><th className="py-1">Market</th><th className="py-1">Gap %</th><th className="py-1">Stock</th></tr></thead>
                    <tbody className="text-slate-200">
                      {pagedRows.map((row) => {
                        const name = row.name || row.sku_name || row.sku_id;
                        const our = Number(row.our_price ?? row.retailer_price ?? 0) || 0;
                        const market = Number(row.competitor_price ?? 0) || 0;
                        const gapPct = Number(row.price_gap_pct ?? 0) || 0;
                        return (
                          <tr key={row.sku_id} className="border-b border-slate-800 cursor-pointer hover:bg-slate-800/60" onClick={() => setSelected(row)}>
                            <td className="py-1">{name}</td><td className="py-1">${our.toFixed(2)}</td><td className="py-1">${market.toFixed(2)}</td>
                            <td className={`py-1 font-semibold ${gapPct >= 0 ? "text-amber-300" : "text-emerald-300"}`}>{gapPct >= 0 ? "+" : ""}{gapPct.toFixed(1)}%</td>
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
          </FlyoutCard>
          {selected && !isSystemError && (
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 text-[12px] text-slate-200">
              <div className="flex items-center justify-between mb-2"><h4 className="font-semibold">SKU Detail: {selected.name || selected.sku_name || selected.sku_id}</h4><button onClick={() => setSelected(null)} className="text-slate-400 hover:text-white">Close</button></div>
              <div className="grid grid-cols-2 gap-2 mb-3"><div>SKU: {selected.sku_id}</div><div>Stock: {selected.in_stock ? "In Stock" : "Out"}</div><div>Gap: {(Number(selected.price_gap_pct ?? 0) || 0).toFixed(2)}%</div><div>Snapshot: {selected.snapshot_time || "--"}</div></div>
              <div className="flex gap-2 flex-wrap">
                <button disabled={!!actionLoading} onClick={() => triggerAction("reprice", selected)} className="px-2 py-1 rounded bg-blue-700 text-white disabled:opacity-50">{actionLoading === "reprice" ? "Running..." : "Reprice"}</button>
                <button disabled={!!actionLoading} onClick={() => triggerAction("replenish", selected)} className="px-2 py-1 rounded bg-emerald-700 text-white disabled:opacity-50">{actionLoading === "replenish" ? "Running..." : "Replenish"}</button>
                <button disabled={!!actionLoading} onClick={() => triggerAction("draft_coop_email", selected)} className="px-2 py-1 rounded bg-amber-700 text-white disabled:opacity-50">{actionLoading === "draft_coop_email" ? "Running..." : "Draft Co-op"}</button>
                <button disabled={!!actionLoading} onClick={() => triggerAction("queue_campaign", selected)} className="px-2 py-1 rounded bg-purple-700 text-white disabled:opacity-50">{actionLoading === "queue_campaign" ? "Running..." : "Queue Campaign"}</button>
              </div>
              {actionMsg && <div className="mt-2 text-[11px] text-slate-300 bg-slate-800 rounded p-2">{actionMsg}</div>}
              <div className="mt-2 bg-slate-800 rounded p-2">
                <div className="text-[11px] font-semibold text-slate-200 mb-1">Recent Actions</div>
                {actionHistory.length === 0 ? (
                  <div className="text-[11px] text-slate-400">No actions yet.</div>
                ) : (
                  <div className="space-y-1">
                    {actionHistory.map((a, i) => (
                      <div key={`${a.timestamp}-${i}`} className="text-[11px] text-slate-300">
                        {new Date(a.timestamp).toLocaleTimeString()} · {a.action} · {a.sku_name} ({a.sku_id}) · {a.status}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      </main>
      {/* BigQuery Explorer modal — full-screen overlay; Esc / click-outside / X to close */}
      {bqOpen && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setBqOpen(false); }}
        >
          <div
            className="m-6 w-full max-w-6xl max-h-[92vh] flex flex-col rounded-lg border border-[#2d3748] overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 min-h-0 flex flex-col bg-[#0d1117]">
              <BQExplorer />
            </div>
            <div className="px-4 py-2 border-t border-[#1e2532] bg-[#0d1117] flex items-center justify-between flex-shrink-0">
              <span className="text-[11px] text-[#475569]">
                Press <kbd className="bg-[#1e2532] text-[#94a3b8] px-1 py-0.5 rounded text-[10px] font-mono">Esc</kbd> or click outside to close
              </span>
              <button
                type="button"
                onClick={() => setBqOpen(false)}
                className="text-[11px] text-[#94a3b8] hover:text-white px-2 py-1 rounded border border-[#2d3748]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      <AgentControlCenter
        status={isSystemError ? 'error' : agentStatus}
        steps={isSystemError ? [{ step: 'error', content: 'System authentication error. Agent cannot run.' }] : agentSteps}
        error={isSystemError ? "GCP Authentication Missing or Configuration Error. Agent functionality is blocked." : agentError}
        alerts={alerts}
        agentEvents={agentEvents}
      />
    </div>
  );
}
