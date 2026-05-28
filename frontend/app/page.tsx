"use client";

import React from "react"; // Import React
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import AgentControlCenter from "@/components/chat/AgentControlCenter";
import DemoFlowsSidebar from "@/components/DemoFlowsSidebar";
import LiveTicker from "@/components/LiveTicker";
import ChatPanel from "@/components/ChatPanel";
import FlyoutCard from "@/components/FlyoutCard";
import BQExplorer from "@/components/BQExplorer";
import SellThroughChart, { SELL_THROUGH_DATA } from "@/components/SellThroughChart";
import WeekDetailPanel from "@/components/WeekDetailPanel";
import { AgentStep, Status } from "@/lib/sse/useSSE"; // Assuming Status and AgentStep are exported
import { BUSINESS_GLOSSARY } from "@/lib/metrics/glossary";
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart,
  Line,
  BarChart,
  Bar,
  ComposedChart,
  ScatterChart,
  Scatter,
  ZAxis,
} from "recharts";

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
  message?: string;
  error?: string; // To capture backend errors
  error_type?: string; // To capture specific error types like GCP_AUTH_MISSING
  run_id?: string; // To capture the run ID for event fetching
};

type FeedStatus = {
  status: string;
  message?: string;
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

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-700/80 bg-gradient-to-b from-slate-900 to-slate-950 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
      <div className="mb-3">
        <div className="text-[12px] text-slate-100 font-semibold">{title}</div>
        {subtitle ? <div className="text-[10px] text-slate-400 mt-0.5">{subtitle}</div> : null}
      </div>
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function Home() {
  const HelpIcon = ({ text }: { text: string }) => (
    <span className="relative inline-flex items-center group ml-1">
      <span className="w-4 h-4 rounded-full border border-slate-500 text-slate-300 text-[10px] inline-flex items-center justify-center cursor-help">?</span>
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block whitespace-nowrap bg-slate-900 text-slate-200 text-[10px] px-2 py-1 rounded border border-slate-700 z-20">
        {text}
      </span>
    </span>
  );
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
  const [fetchSize, setFetchSize] = useState(20);
  const [selected, setSelected] = useState<Row | null>(null);
  const [selectedSku, setSelectedSku] = useState<Row | null>(null);
  const [skuDetails, setSkuDetails] = useState<any[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionHistory, setActionHistory] = useState<ActionRecord[]>([]);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [agentApiUnavailable, setAgentApiUnavailable] = useState(false);
  // Auto-refresh re-reads the latest BigQuery snapshot only — it never
  // triggers a SerpAPI scan. Manual scans go through the "Run External
  // Scan" button, which still calls refreshData().
  const [autoRefreshMins, setAutoRefreshMins] = useState(10);
  const [autoRefreshOn, setAutoRefreshOn] = useState(false);
  const [agentPollFailures, setAgentPollFailures] = useState(0);

  // Agent state for AgentControlCenter
  const [agentStatus, setAgentStatus] = useState<Status>('idle');
  const [agentSteps, setAgentSteps] = useState<{step: AgentStep, content: string}[]>([]);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<"Home Theater" | "Home Appliance" | "Mobile Accessories">("Home Theater");
  const [activeTab, setActiveTab] = useState<"category" | "promotions" | "loyalty" | "returns">("category");
  const [isTabLoading, setIsTabLoading] = useState(false);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("cat-category-change", { detail: { category: activeCategory } }));
  }, [activeCategory]);

  const logEvent = (phase: string, message: string) => {
    // This is for frontend-side logging, not backend events
    setAgentEvents((prev) => [{ run_id: currentRunId || "ui-local", timestamp: new Date().toISOString(), stage: phase.toUpperCase(), status: 'INFO', message: message }, ...prev].slice(0, 20));
  };

  const mapBackendStageToAgentStep = (stage: string): AgentStep => {
    switch (stage) {
      case 'SENSING': return 'think';
      case 'FETCHING': return 'think';
      case 'ENRICHING': return 'analyze';
      case 'PROCESSING': return 'analyze';
      case 'ANALYZING': return 'analyze';
      case 'UPDATING': return 'act';
      case 'RESPONDING': return 'respond';
      case 'COMPLETE': return 'done';
      case 'ERROR': return 'error';
      default: return 'think';
    }
  };

  const loadOverview = useCallback(async () => {
    try {
    const params = new URLSearchParams({
      q: query,
      stock: stockFilter,
      limit: String(fetchSize),
      offset: "0",
      start_date: "2024-10-01",
      end_date: "2026-05-27",
      categories: "TV,Soundbar,Receiver,Streaming,Projector,Headphones",
      category: activeCategory,
    });
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

    // Only return early on critical errors; allow degraded status to use fallback
    if (data.error && data.error_type && !data.error_type.includes("degraded")) {
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
      // Handle both wrapped object and flat array responses
      const rowsData = Array.isArray(data) ? data : (data.rows || []);
      setRows(rowsData);
      setSource(data.source || "bigquery-live");
      setTimestamp(data.timestamp || (Array.isArray(data) && data[0]?.snapshot_time) || "");
      setFeedStatus(prev => ({ ...prev, error: undefined, error_type: undefined })); // Clear previous errors
      setCurrentRunId(data.run_id || null); // Store the run ID if available
    } else {
      // Fallback: load latest snapshot rows directly when overview is empty.
      try {
        const latestRes = await fetch(`/api/feeds/prices/latest?${new URLSearchParams({ category: activeCategory }).toString()}`, { cache: "no-store" });
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
    } catch (e: any) {
      setSource("Cached Analytics");
      setFeedStatus({ status: "stale", warning: e?.message || "Overview request failed" });
      setAlerts([{ priority: "P2", sku: "System", msg: "Temporary degraded sync" }]);
      setRows([]);
      setTimestamp("");
      setCurrentRunId(null);
    }
  }, [query, stockFilter, fetchSize, activeCategory]);

  const getFallbackDataForTab = useCallback((tab: "category" | "promotions" | "loyalty" | "returns", category: string) => {
    const byTab = {
      category: [
        { priority: "P2" as const, sku: category, msg: "Active data cache" },
      ],
      promotions: [
        { priority: "P2" as const, sku: "Promo Engine", msg: "Fallback promotions dataset active." },
      ],
      loyalty: [
        { priority: "P2" as const, sku: "Loyalty Engine", msg: "Fallback loyalty dataset active." },
      ],
      returns: [
        { priority: "P2" as const, sku: "Returns Engine", msg: "Fallback returns dataset active." },
      ],
    };
    return byTab[tab];
  }, []);

  const loadTabData = useCallback(async (tab: "category" | "promotions" | "loyalty" | "returns", category: string) => {
    setIsTabLoading(true);
    try {
      const params = new URLSearchParams({
        q: query,
        stock: stockFilter,
        limit: String(fetchSize),
        offset: "0",
        start_date: "2024-10-01",
        end_date: "2026-05-27",
        categories: "TV,Soundbar,Receiver,Streaming,Projector,Headphones",
        category,
      });
      const endpointTab = tab === "category" ? "overview" : tab;
      const res = await fetch(`/api/dashboard/${endpointTab}?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        setSource("Cached Analytics");
        setAlerts(getFallbackDataForTab(tab, category));
        setRows([]);
        return;
      }
      const data = await res.json();
      const emptyRows = !Array.isArray(data?.rows) || data.rows.length === 0;
      if (data?.error || emptyRows) {
        setSource("Cached Analytics");
        setAlerts(getFallbackDataForTab(tab, category));
        setRows([]);
        return;
      }
      setSource(data.source || "bigquery-live");
      setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
      setRows(data.rows);
      setTimestamp(data.timestamp || "");
    } catch (_e) {
      setSource("Cached Analytics");
      setAlerts(getFallbackDataForTab(tab, category));
      setRows([]);
    } finally {
      setIsTabLoading(false);
    }
  }, [fetchSize, getFallbackDataForTab, query, stockFilter]);

  const loadFeedStatus = useCallback(async () => {
    try {
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
    } catch (e: any) {
      setFeedStatus({ status: "stale", warning: e?.message || "Feed status request failed" });
      if (source === "loading") setSource("Cached Analytics");
    }
  }, [source]);

  const fetchAgentEvents = useCallback(async (_runId: string | null) => {
    if (agentApiUnavailable || agentPollFailures >= 3) return;
    try {
      if (_runId) {
        const eventsRes = await fetch(`/api/agent/events?run_id=${encodeURIComponent(_runId)}`, { cache: "no-store" });
        if (eventsRes.status === 404) {
          setAgentApiUnavailable(true);
          return;
        }
        if (eventsRes.ok) {
          const eventsData = await eventsRes.json();
          if (Array.isArray(eventsData.events) && eventsData.events.length > 0) {
            setAgentEvents(eventsData.events);
            return;
          }
        }
      }

      const statusRes = await fetch(`/api/agent/status`, { cache: "no-store" });
      if (statusRes.status === 404) {
        setAgentApiUnavailable(true);
        return;
      }
      if (!statusRes.ok) throw new Error(`Failed to fetch events: ${statusRes.status}`);
      const statusData = await statusRes.json();
      if (Array.isArray(statusData.events)) {
        setAgentPollFailures(0);
        setAgentEvents(statusData.events);
        if (statusData.active_run?.run_id) setCurrentRunId(statusData.active_run.run_id);
      } else {
        setAgentEvents([]);
      }
    } catch (e) {
      console.error("Failed to fetch agent events:", e);
      setAgentPollFailures((n) => n + 1);
      if (agentPollFailures + 1 >= 3) {
        setAgentApiUnavailable(true);
        setActionMsg("Sync paused");
      }
    }
  }, [agentApiUnavailable, agentPollFailures]);

  const refreshData = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    logEvent("sensing", `Triggered data refresh`);
    try {
      // Initiate the refresh and get the run_id
      const manualLimit = Math.min(Math.max(fetchSize, 1), 20);
      const refreshRes = await fetch(`/api/feeds/prices?limit=${manualLimit}&category=${encodeURIComponent(activeCategory)}`, { method: "POST", cache: "no-store" });
      
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
  }, [loadOverview, loadFeedStatus, fetchAgentEvents, refreshing, fetchSize, activeCategory]);

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

  const handleSkuClick = useCallback(async (sku: Row) => {
    setSelectedSku(sku);
    setSelected(sku);
    setLoadingDetails(true);
    setDetailsError(null);
    try {
      const params = new URLSearchParams();
      if (sku.sku_id) params.set("sku_id", sku.sku_id);
      if (!sku.sku_id && (sku.name || sku.sku_name)) params.set("sku_name", String(sku.name || sku.sku_name));
      const res = await fetch(`/pricing/sku-details?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
      setSkuDetails(Array.isArray(data?.rows) ? data.rows : []);
    } catch (e: any) {
      setSkuDetails([]);
      setDetailsError(e?.message || "Failed to load SKU details");
    } finally {
      setLoadingDetails(false);
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
    if (currentRunId && !agentApiUnavailable && agentPollFailures < 3) {
      const eventInterval = setInterval(() => {
        fetchAgentEvents(currentRunId);
      }, 5000); // Fetch events every 5 seconds
      return () => clearInterval(eventInterval);
    }
  }, [currentRunId, fetchAgentEvents, agentApiUnavailable, agentPollFailures]);

  useEffect(() => {
    loadTabData(activeTab, activeCategory);
  }, [activeTab, activeCategory, loadTabData]);

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
                        source === "❌ Auth Missing";

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
  const noRunYet = !progressSummary.run_id && agentEvents.length === 0;
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
  const systemErrorMessage = isSystemError
    ? [
        "Agent functionality is blocked.",
        feedStatus.error_type ? `Type: ${feedStatus.error_type}` : null,
        feedStatus.error ? `Detail: ${feedStatus.error}` : null,
      ].filter(Boolean).join(" ")
    : null;

  // Update agent status and steps based on backend events
  useEffect(() => {
    if (isSystemError) {
      setAgentStatus('error');
      setAgentSteps([{step: 'error', content: systemErrorMessage || 'System error. Agent cannot run.'}]);
      setAgentError(systemErrorMessage || "System error. Agent functionality is blocked.");
    } else if (latestEvent) {
      const step = mapBackendStageToAgentStep(latestEvent.stage);
      const mappedStatus: Status = step === 'think' ? 'thinking' : step === 'act' ? 'acting' : step === 'analyze' ? 'analyzing' : step === 'respond' ? 'responding' : step === 'done' ? 'done' : 'error';
      setAgentStatus(mappedStatus);
      setAgentSteps(prev => {
        // Add new event if it's different from the last one
        if (prev.length === 0 || prev[0].content !== latestEvent.message) {
          return [{step, content: latestEvent.message}, ...prev].slice(0, 10);
        }
        return prev;
      });
      if (latestEvent.status === 'ERROR') {
        setAgentError(latestEvent.message);
      } else {
        setAgentError(null); // Clear error if not in error state
      }
    } else {
      setAgentStatus('done');
      setAgentSteps([
        { step: 'think', content: 'Demo mode connected.' },
        { step: 'act', content: 'Flow context loaded.' },
        { step: 'analyze', content: 'KPI/chart binding active.' },
        { step: 'respond', content: 'Ready for operator actions.' },
      ]);
      setAgentError(null);
    }
  }, [latestEvent, isSystemError, systemErrorMessage]);


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
  const FLOW_ALERTS: Record<string, Alert[]> = {
    "category-overview": [
      { priority: "P1", sku: "LG C3 OLED 55", msg: "31% below forecast with elevated on-hand units." },
      { priority: "P1", sku: "Samsung QN85C 65", msg: "Price 7.7% above Amazon benchmark." },
    ],
    "health-check": [
      { priority: "P1", sku: "Sony X90L 75", msg: "Stockout risk in 9 days at tier-A stores." },
      { priority: "P2", sku: "Hisense U8K", msg: "Co-op budget expiry risk with low utilization." },
    ],
    "diagnose-lg-c3": [
      { priority: "P1", sku: "LG C3 OLED 55", msg: "Down 31% vs forecast with weak promo lift." },
    ],
    "simulate-samsung": [
      { priority: "P2", sku: "Samsung QN90D", msg: "Best-unit scenario increases stockout risk in 3 stores." },
    ],
    "price-vs-amazon": [
      { priority: "P1", sku: "Samsung QN85C 65", msg: "Price gap remains above 7% vs Amazon." },
      { priority: "P1", sku: "Sony X90L 75", msg: "Margin at risk if repricing is delayed this cycle." },
    ],
    "ad-plan-optimizer": [
      { priority: "P2", sku: "Hisense U8K", msg: "$43K co-op expires soon without campaign allocation." },
    ],
  };

  const [activeFlowId, setActiveFlowId] = useState<string>("category-overview");
  useEffect(() => {
    if (activeFlowId === "diagnose-lg-c3") setActiveTab("category");
  }, [activeFlowId]);
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
  const flowAlerts = useMemo(
    () => Array.from(new Map((FLOW_ALERTS[activeFlowId] ?? alerts).map((a) => [`${a.priority}|${a.sku}|${a.msg}`, a])).values()),
    [activeFlowId, alerts]
  );
  const KPI_HELP: Record<string, string> = {
    "CATEGORY REV": "Total category revenue for the selected scope and time window.",
    "AVG MARGIN %": "Average gross margin percent across included SKUs.",
    "INV. HEALTH": "Inventory health score based on days-of-supply and stock balance.",
    "FCST ACCY": "Forecast Accuracy: how close forecasted units were to actual sales. Higher is better.",
    "BELOW FCST": "Count of SKUs performing below forecast in the selected period.",
    "OVERSTK COST": "Estimated cost impact from excess inventory above healthy levels.",
    "PROMO ROAS": "Return on ad spend for promotions (revenue generated per $1 spent).",
    "STOCKOUT RISK": "SKUs at risk of stockout within the near-term horizon.",
    "C3 VS FCST": "LG C3 sell-through variance versus forecast.",
    "DAYS SUPPLY": "Estimated days inventory will last at current sell-through rate.",
    "PROMO LIFT": "Incremental sales uplift driven by promotions.",
    "PROJ RECOVERY": "Projected recoverable unit sales from suggested actions.",
  };
  const abbrevHint = (label: string) => {
    if (label.includes("FCST")) return BUSINESS_GLOSSARY.FCST_ACCY.business_meaning;
    if (label.includes("ROAS")) return BUSINESS_GLOSSARY.ROAS.business_meaning;
    if (label.includes("CO-OP")) return BUSINESS_GLOSSARY.CO_OP.business_meaning;
    if (label.includes("INV.")) return BUSINESS_GLOSSARY.INV_HEALTH.business_meaning;
    if (label.includes("DoS")) return BUSINESS_GLOSSARY.DOS.business_meaning;
    return null;
  };
  const KPI_DETAIL: Record<string, { desc: string; drivers: string; action: string }> = {
    "CO-OP AVAILABLE": {
      desc: "Remaining vendor co-op funds available in current cycle across active partners.",
      drivers: "Unspent allocations from Samsung, LG, Sony, and Bose.",
      action: "Prioritize high-ROAS campaigns before expiry windows close.",
    },
    "EXPIRING SOON": {
      desc: "Co-op dollars nearing expiration and at risk of loss.",
      drivers: "Largest near-term risk is Hisense budget with low utilization.",
      action: "Launch fast-turn digital placements tied to eligible SKUs this week.",
    },
    "BEST ROAS": {
      desc: "Top performing channel return on ad spend among active campaign types.",
      drivers: "SMS shows strongest conversion efficiency in current cohort.",
      action: "Scale SMS on SKUs with low inventory risk and positive margin.",
    },
    "CAMPAIGNS READY": {
      desc: "Campaign drafts prepared and waiting for approval or scheduling.",
      drivers: "Audience/creative complete; pending business approval gates.",
      action: "Approve highest-impact campaigns first and stagger launch by inventory coverage.",
    },
  };
  const [selectedKpiLabel, setSelectedKpiLabel] = useState<string | null>(null);
  const selectedKpiDetail = selectedKpiLabel ? KPI_DETAIL[selectedKpiLabel] : null;
  const renderWorkspace = (flowId: string) => {
    switch (flowId) {
      case "category-overview":
        return (
          <ChartCard title="Category Overview - Weekly Segment Performance">
            <BarChart data={[
              { week: "W18", TV: 74, Soundbar: 46, MobileAccessories: 52, Appliance: 40 },
              { week: "W19", TV: 79, Soundbar: 49, MobileAccessories: 57, Appliance: 44 },
              { week: "W20", TV: 83, Soundbar: 53, MobileAccessories: 59, Appliance: 47 },
              { week: "W21", TV: 86, Soundbar: 51, MobileAccessories: 61, Appliance: 49 },
              { week: "W22", TV: 88, Soundbar: 56, MobileAccessories: 65, Appliance: 52 },
            ]}>
              <CartesianGrid stroke="#1e2532" strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="TV" fill="#38bdf8" />
              <Bar dataKey="Soundbar" fill="#22d3ee" />
              <Bar dataKey="MobileAccessories" fill="#34d399" />
              <Bar dataKey="Appliance" fill="#f59e0b" />
            </BarChart>
          </ChartCard>
        );
      case "health-check":
        return (
          <ChartCard title="Health / Risk Trend">
            <LineChart data={[
              { week: "W18", risk: 66, stockout: 39, margin: 58 },
              { week: "W19", risk: 68, stockout: 41, margin: 59 },
              { week: "W20", risk: 70, stockout: 43, margin: 60 },
              { week: "W21", risk: 71, stockout: 46, margin: 61 },
              { week: "W22", risk: 72, stockout: 49, margin: 61 },
            ]}>
              <CartesianGrid stroke="#1e2532" strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line dataKey="risk" stroke="#f59e0b" strokeWidth={2} dot />
              <Line dataKey="stockout" stroke="#ef4444" strokeWidth={2} dot />
              <Line dataKey="margin" stroke="#34d399" strokeWidth={2} dot />
            </LineChart>
          </ChartCard>
        );
      case "diagnose-lg-c3":
        return (
          <ChartCard title="LG Diagnostic: Forecast vs Actual">
            <BarChart data={[
              { metric: "Forecast Units", value: 100 },
              { metric: "Actual Units", value: 69 },
              { metric: "Promo Lift %", value: 8 },
              { metric: "Display Compliance", value: 57 },
            ]}>
              <CartesianGrid stroke="#1e2532" strokeDasharray="3 3" />
              <XAxis dataKey="metric" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="value" fill="#fb7185" />
            </BarChart>
          </ChartCard>
        );
      case "simulate-samsung":
        return (
          <ChartCard title="Simulation Comparison: Baseline vs Scenario">
            <ComposedChart data={[
              { step: "W1", baseline: 1800, simulated: 2050, risk: 11 },
              { step: "W2", baseline: 1820, simulated: 2240, risk: 13 },
              { step: "W3", baseline: 1840, simulated: 2510, risk: 16 },
              { step: "W4", baseline: 1865, simulated: 2710, risk: 19 },
            ]}>
              <CartesianGrid stroke="#1e2532" strokeDasharray="3 3" />
              <XAxis dataKey="step" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" dataKey="baseline" stroke="#4ade80" strokeWidth={2} dot />
              <Line yAxisId="left" dataKey="simulated" stroke="#22c55e" strokeWidth={2} dot />
              <Bar yAxisId="right" dataKey="risk" fill="#f59e0b" />
            </ComposedChart>
          </ChartCard>
        );
      case "spring-assortment":
        return (
          <ChartCard title="Spring Assortment Coverage">
            <BarChart layout="vertical" data={[
              { sku: "LG C3 OLED 55", dos: 41, forecastAcc: 68, demand: 57 },
              { sku: "Samsung QN85C", dos: 29, forecastAcc: 74, demand: 63 },
              { sku: "Sony X90L", dos: 22, forecastAcc: 79, demand: 72 },
              { sku: "Hisense U8K", dos: 34, forecastAcc: 65, demand: 58 },
            ]}>
              <CartesianGrid stroke="#1e2532" strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis type="category" dataKey="sku" tick={{ fill: "#94a3b8", fontSize: 11 }} width={100} />
              <Tooltip />
              <Legend />
              <Bar dataKey="dos" fill="#a78bfa" />
              <Bar dataKey="forecastAcc" fill="#60a5fa" />
              <Bar dataKey="demand" fill="#34d399" />
            </BarChart>
          </ChartCard>
        );
      case "exec-review":
        return (
          <ChartCard title="Executive Summary Index">
            <LineChart data={[
              { q: "Q4'24", revenue: 98, margin: 96, fcst: 72 },
              { q: "Q1'25", revenue: 101, margin: 99, fcst: 75 },
              { q: "Q2'25", revenue: 104, margin: 101, fcst: 77 },
              { q: "Q3'25", revenue: 106, margin: 103, fcst: 78 },
            ]}>
              <CartesianGrid stroke="#1e2532" strokeDasharray="3 3" />
              <XAxis dataKey="q" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line dataKey="revenue" stroke="#2dd4bf" strokeWidth={2} dot />
              <Line dataKey="margin" stroke="#14b8a6" strokeWidth={2} dot />
              <Line dataKey="fcst" stroke="#f59e0b" strokeWidth={2} dot />
            </LineChart>
          </ChartCard>
        );
      case "ad-plan-optimizer":
        return (
          <ChartCard title="Ad Plan Optimizer: Co-op and ROAS">
            <ComposedChart data={[
              { vendor: "Samsung", coop: 68, roas: 4.1 },
              { vendor: "LG", coop: 42, roas: 3.6 },
              { vendor: "Sony", coop: 55, roas: 3.9 },
              { vendor: "Bose", coop: 18, roas: 2.8 },
            ]}>
              <CartesianGrid stroke="#1e2532" strokeDasharray="3 3" />
              <XAxis dataKey="vendor" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="coop" fill="#34d399" />
              <Line yAxisId="right" dataKey="roas" stroke="#60a5fa" strokeWidth={2} dot />
            </ComposedChart>
          </ChartCard>
        );
      case "price-vs-amazon":
        return (
          <ChartCard title="Price vs Amazon: Margin vs Gap">
            <ScatterChart data={[
              { sku: "Samsung QN85C", margin: 17.4, gap: 7.7, bbPrice: 1299, amzPrice: 1206, size: 140 },
              { sku: "Sony X90L", margin: 15.1, gap: 5.3, bbPrice: 1499, amzPrice: 1424, size: 120 },
              { sku: "LG C3 OLED 55", margin: 13.9, gap: 4.1, bbPrice: 1399, amzPrice: 1344, size: 110 },
              { sku: "Hisense U8K", margin: 11.8, gap: 2.8, bbPrice: 899, amzPrice: 874, size: 90 },
            ]}>
              <CartesianGrid stroke="#1e2532" strokeDasharray="3 3" />
              <XAxis type="number" dataKey="margin" name="Margin %" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis type="number" dataKey="gap" name="Gap %" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <ZAxis dataKey="size" range={[60, 220]} />
              <Tooltip formatter={(v: any, n: any, p: any) => {
                if (n === "gap") return [`${v}%`, "Gap %"];
                if (n === "margin") return [`${v}%`, "Margin %"];
                return [v, n];
              }} labelFormatter={(_, payload: any[]) => {
                const d = payload?.[0]?.payload;
                return d ? `${d.sku} | BB $${d.bbPrice} | Amazon $${d.amzPrice}` : "";
              }} />
              <Legend />
              <Scatter name="SKUs" dataKey="gap" fill="#f87171" />
            </ScatterChart>
          </ChartCard>
        );
      default:
        return <SellThroughChart flowKey={flowId} onWeekClick={setSelectedWeek} weekWindow={weekWindow} onWeekWindowChange={setWeekWindow} onDataChange={setChartRows} />;
    }
  };

  const renderTabWorkspace = () => {
    if (activeTab === "category") return renderWorkspace(activeFlowId);
    if (activeTab === "promotions") {
      return (
        <ChartCard title="Promotions - Units vs ROAS">
          <ComposedChart data={[{ w: "W18", units: 620, roas: 2.7 }, { w: "W19", units: 680, roas: 2.9 }, { w: "W20", units: 740, roas: 3.1 }, { w: "W21", units: 790, roas: 3.3 }]}>
            <CartesianGrid stroke="#1e2532" strokeDasharray="3 3" />
            <XAxis dataKey="w" tick={{ fill: "#94a3b8", fontSize: 11 }} />
            <YAxis yAxisId="left" tick={{ fill: "#94a3b8", fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: "#94a3b8", fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar yAxisId="left" dataKey="units" fill="#22c55e" />
            <Line yAxisId="right" dataKey="roas" stroke="#60a5fa" strokeWidth={2} dot />
          </ComposedChart>
        </ChartCard>
      );
    }
    if (activeTab === "loyalty") {
      return (
        <ChartCard title="Loyalty - Repeat Shopper Trend">
          <LineChart data={[{ w: "W18", repeat: 31, members: 120 }, { w: "W19", repeat: 33, members: 132 }, { w: "W20", repeat: 35, members: 140 }, { w: "W21", repeat: 37, members: 151 }]}>
            <CartesianGrid stroke="#1e2532" strokeDasharray="3 3" />
            <XAxis dataKey="w" tick={{ fill: "#94a3b8", fontSize: 11 }} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Line dataKey="repeat" stroke="#a78bfa" strokeWidth={2} dot />
            <Line dataKey="members" stroke="#34d399" strokeWidth={2} dot />
          </LineChart>
        </ChartCard>
      );
    }
    const returnsData = [
      { reason: "Damaged", count: 41, rate: "2.4%", loss: "$12.8K", status: "High" },
      { reason: "Wrong Item", count: 22, rate: "1.3%", loss: "$6.1K", status: "Medium" },
      { reason: "Late Delivery", count: 31, rate: "1.8%", loss: "$8.7K", status: "Medium" },
      { reason: "No Longer Needed", count: 27, rate: "1.6%", loss: "$5.9K", status: "Low" },
    ];
    return (
      <ChartCard title="Returns Intelligence" subtitle="Reason mix, return rate, and margin risk">
        <BarChart data={returnsData} margin={{ top: 20, right: 20, left: 10, bottom: 10 }}>
          <CartesianGrid stroke="#1e2532" strokeDasharray="3 3" />
          <XAxis dataKey="reason" tick={{ fill: "#94a3b8", fontSize: 11 }} />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
          <Tooltip
            formatter={(v: any, n: any, p: any) => {
              if (n === "count") return [`${v}`, "Return Count"];
              return [v, n];
            }}
            labelFormatter={(_, payload: any[]) => {
              const d = payload?.[0]?.payload;
              if (!d) return "";
              return `${d.reason} • Rate ${d.rate} • Margin Loss ${d.loss} • ${d.status}`;
            }}
          />
          <Legend />
          <Bar dataKey="count" name="Return Count" fill="#f59e0b" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ChartCard>
    );
  };

  // Quick Actions and demo flows now live in <DemoFlowsSidebar />, so the
  // inline panel that used to sit above AgentControlCenter has been removed.

  const [bqOpen, setBqOpen] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [weekWindow, setWeekWindow] = useState<number>(13);
  const [selectedPipelineStage, setSelectedPipelineStage] = useState<string | null>(null);
  const [chartRows, setChartRows] = useState<Array<{ week: string; Samsung: number; Sony: number; LG: number; Forecast: number }>>([]);
  const selectedStageEvent = selectedPipelineStage
    ? agentEvents.find((e) => e.stage === selectedPipelineStage) || null
    : null;
  const selectedWeekRow = selectedWeek
    ? chartRows.find((r) => r.week === selectedWeek) ?? SELL_THROUGH_DATA.find((r) => r.week === selectedWeek) ?? null
    : null;
  useEffect(() => {
    if (!bqOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setBqOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bqOpen]);

  const topTabs = [
    { id: "category",   icon: "📊", label: "Category" },
    { id: "promotions", icon: "📈", label: "Promotions" },
    { id: "loyalty",    icon: "👑", label: "Loyalty" },
    { id: "returns",    icon: "🔄", label: "Returns" },
  ] as const;

  return (
    <div className="w-screen h-screen max-h-screen overflow-hidden flex flex-col bg-slate-950">
      <div className="flex flex-row flex-1 overflow-hidden w-full min-h-0">
      <DemoFlowsSidebar activeFlowId={activeFlowId} onFlowSelect={(_, id) => setActiveFlowId(id)} />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div className="flex-shrink-0"><LiveTicker alerts={flowAlerts} /></div>
      <div className="flex-1 min-h-0 overflow-hidden">
      {/* Brand bar — Best Buy royal blue (#003087) with yellow logo block and Adept attribution */}
      <header className="px-4 min-h-14 py-2 flex-shrink-0 flex flex-wrap items-center justify-between gap-2 bg-bby-blue">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-sm bg-bby-yellow text-bby-blue font-extrabold text-[10px] leading-tight text-center">BEST<br/>BUY</span>
          <span className="text-white font-semibold text-[13px]">Category Intelligence</span>
          <span className="px-2 py-0.5 rounded text-[9px] font-bold tracking-wider text-bby-yellow border border-bby-yellow/30">POWERED BY ADEPT AI</span>
          <span className="hidden md:inline text-[11px] text-white/70 ml-3">Home Appliance + Mobile + Accessories <span className="text-white/40">›</span> Q4 2024 to Q1 2026</span>
        </div>
        <div className="flex items-center gap-2 text-[12px] flex-wrap">
          <button
            type="button"
            onClick={() => setBqOpen(true)}
            className="px-2.5 py-1 rounded border border-white/30 text-white hover:bg-white/10 flex items-center gap-1 text-[11px]"
            title="Open BigQuery Explorer"
          >
            🗄️ Data
          </button>
          <button className="px-2.5 py-1 rounded border border-white/30 text-white hover:bg-white/10 text-[11px]" type="button">Export PDF</button>
          <button className="px-2.5 py-1 rounded bg-bby-yellow text-bby-blue font-semibold hover:bg-yellow-300 text-[11px]" type="button">Export PPT</button>
          <span className="ml-2 inline-flex items-center justify-center w-8 h-8 rounded-full bg-bby-accent text-white text-xs font-semibold">AC</span>
        </div>
      </header>

      {/* Top navigation tabs — Category / Promotions / Loyalty / Returns */}
      <nav className="px-6 flex-shrink-0 flex items-center gap-1 text-[12px] bg-bby-dark border-b border-[var(--bby-border-subtle)] overflow-x-auto">
        {topTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={
              "px-3 py-1.5 -mb-px border-b-2 transition-colors text-[12px] " +
              (activeTab === t.id
                ? "border-bby-accent text-white font-semibold"
                : "border-transparent text-slate-400 hover:text-slate-200")
            }
            onClick={() => setActiveTab(t.id)}
          >
            <span className="mr-1.5">{t.icon}</span>{t.label}
          </button>
        ))}
      </nav>

      {/* Status / data-source strip */}
      <div className="flex-shrink-0 bg-bby-surface border-b border-[var(--bby-border-subtle)] px-6 py-1.5 text-[11px] text-slate-300 flex items-center justify-between">
        <span>Data Source: <span className={source.includes("live") || source.includes("bigquery") ? "text-emerald-300 font-semibold" : source.includes("Auth Missing") ? "text-red-400 font-semibold" : source.includes("Error") ? "text-red-400 font-semibold" : "text-amber-300 font-semibold"}>{isTabLoading ? "loading" : (source.includes("bigquery") || source.includes("live")) ? "🟢 Live Data Lake" : source}</span></span>
        <span className="flex items-center gap-3">
          <select
            value={activeCategory}
            onChange={(e) => setActiveCategory(e.target.value as "Home Theater" | "Home Appliance" | "Mobile Accessories")}
            className="bg-slate-800 text-slate-200 text-[11px] rounded px-2 py-0.5 border border-slate-700"
            title="Category filter"
          >
            <option value="Home Theater">Home Theater</option>
            <option value="Home Appliance">Home Appliance</option>
            <option value="Mobile Accessories">Mobile Accessories</option>
          </select>
          <span>Last Refresh: {timestamp ? new Date(timestamp).toLocaleTimeString() : "--"}</span>
          <span className={`px-2 py-0.5 rounded ${feedStatus.status === "ok" ? "bg-emerald-900 text-emerald-300" : feedStatus.status === "stale" ? "bg-amber-900 text-amber-300" : feedStatus.status === "loading" ? "bg-gray-700 text-gray-300" : "bg-red-900 text-red-300"}`}>
            {feedStatus.status === "loading" ? "Loading..." : feedStatus.status === "ok" ? "Connected" : feedStatus.status === "stale" ? "No New Data" : "Error"}
          </span>
        </span>
      </div>

      <div className="flex-1 h-full min-h-0 overflow-y-auto scrollbar-thin overflow-x-hidden pb-8">
      {/* KPI scorecard row — 4 tiles mirroring Azure reference */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 py-2 bg-bby-dark border-b border-[var(--bby-border-subtle)]">
        {kpiTiles.map((kpi) => (
          <button
            key={kpi.label}
            type="button"
            onClick={() => setSelectedKpiLabel((prev) => (prev === kpi.label ? null : kpi.label))}
            className="rounded-md px-3 py-2"
            style={{
              background: "var(--bby-kpi-bg)",
              border: `1px solid ${selectedKpiLabel === kpi.label ? "#60a5fa" : "var(--bby-kpi-border)"}`,
              textAlign: "left",
            }}
          >
            <div className="text-[9px] tracking-widest uppercase font-semibold" style={{ color: "var(--bby-kpi-label)" }}>{kpi.label}</div>
            <div className="mt-0.5">
              <HelpIcon text={[KPI_HELP[kpi.label], abbrevHint(kpi.label)].filter(Boolean).join(" ")} />
            </div>
            <div className="text-[20px] font-bold leading-none mt-0.5 text-white">{kpi.value}</div>
            <div className={"text-[10px] mt-0.5 " + (kpi.color === "green" ? "text-emerald-400" : "text-red-400")}>{kpi.delta}</div>
          </button>
        ))}
      </div>
      {selectedKpiDetail && (
        <div className="mx-4 mb-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] text-slate-200">
          <div className="font-semibold text-white mb-1">{selectedKpiLabel}</div>
          <div><span className="text-slate-400">Description:</span> {selectedKpiDetail.desc}</div>
          <div><span className="text-slate-400">Key Drivers:</span> {selectedKpiDetail.drivers}</div>
          <div><span className="text-slate-400">Recommended Action:</span> {selectedKpiDetail.action}</div>
        </div>
      )}

      {/* Flow-specific workspace visualization */}
      <div className="px-4 pt-2 pb-3 bg-bby-dark border-b border-[var(--bby-border-subtle)]">
        {renderTabWorkspace()}
      </div>

      {/* keep only top live ticker to avoid duplicated alert banners */}
      {/* 3-column row of operational panels — equal-width grid on desktop,
          stacked single column on mobile so each card is full-width and
          comfortably tappable. Outer <main> is the only scroll container. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-4 pb-4 sm:min-h-[480px] overflow-hidden">
          <FlyoutCard
            title="Agents in Action"
            subtitle="Live execution monitor"
            icon="🔄"
            badge={<><HelpIcon text="Live agent stage, throughput, and error counters." /><span
                className={
                  "text-[11px] ml-2 " +
                  (progressSummary.current_status === "ERROR" ? "text-red-400"
                    : progressSummary.current_status === "RUNNING" ? "text-amber-300"
                    : progressSummary.current_status === "SUCCESS" ? "text-emerald-300"
                    : "text-slate-400")
                }
              >
                {progressSummary.current_stage || "IDLE"}
              </span></>}
            preview={
              <div className="text-[10px] leading-relaxed text-[#64748b] w-full">
                <div className="flex justify-between mb-0.5">
                  <span>Stage</span>
                  <span className="text-slate-200">
                    {(() => {
                      const stage = progressSummary.current_stage || 'IDLE';
                      const status = progressSummary.current_status || '';
                      if ((stage === "IDLE" && status === "IDLE") || !status || status === stage) return stage;
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

                const isSelected = selectedPipelineStage === stage;
                return (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => setSelectedPipelineStage(stage)}
                    className={`px-2 py-1 rounded-md ${bgColor} text-white text-center border ${isSelected ? 'border-white' : 'border-transparent'} hover:border-slate-200`}
                    title={`Click to inspect ${stage}`}
                  >
                    <div className="text-[10px] opacity-90 flex items-center justify-center gap-1">
                      <span>{isError ? "✕" : isCompleted ? "✓" : isCurrent ? "●" : "○"}</span>
                      <span>{stage.substring(0, 3)}</span>
                    </div>
                    <div className="text-[9px] text-slate-100/90">{String(stageStatus).toLowerCase()}</div>
                  </button>
                );
              })}
            </div>
            {selectedPipelineStage && (
              <div className="mb-3 bg-slate-800 rounded p-2 text-[10px] text-slate-300">
                <div className="font-semibold text-slate-200 mb-1">Stage Detail: {selectedPipelineStage}</div>
                <div>Status: <span className="text-slate-100">{selectedStageEvent?.status || "pending"}</span></div>
                <div>Message: <span className="text-slate-100">{selectedStageEvent?.message || "No events for this stage yet."}</span></div>
                {selectedStageEvent?.error_type && <div>Error Type: <span className="text-red-300">{selectedStageEvent.error_type}</span></div>}
                {selectedStageEvent?.fix && <div>Fix: <span className="text-amber-300">{selectedStageEvent.fix}</span></div>}
                <div className="mt-1 text-slate-400">Business Terms: <span className="text-slate-200">{BUSINESS_GLOSSARY.FCST_ACCY.label}</span> = {BUSINESS_GLOSSARY.FCST_ACCY.business_meaning}</div>
              </div>
            )}

            {/* Metrics Cards */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-slate-800 p-1.5 rounded">
                <div className="text-slate-400 text-[10px]">Requested</div>
                <div className="font-semibold text-white">{noRunYet ? "--" : progressSummary.requested}</div>
              </div>
              <div className="bg-slate-800 p-1.5 rounded">
                <div className="text-slate-400 text-[10px]">Active SKUs</div>
                <div className="font-semibold text-white">{noRunYet ? "--" : progressSummary.active_skus}</div>
              </div>
              <div className="bg-slate-800 p-1.5 rounded">
                <div className="text-slate-400 text-[10px]">Processed</div>
                <div className="font-semibold text-white">{noRunYet ? "--" : progressSummary.processed_rows}</div>
              </div>
              <div className="bg-slate-800 p-1.5 rounded">
                <div className="text-slate-400 text-[10px]">Written</div>
                <div className="font-semibold text-white">{noRunYet ? "--" : progressSummary.written_rows}</div>
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
              {noRunYet ? (
                <div>No run started yet. Click <span className="text-slate-100">Run External Scan</span> to populate metrics.</div>
              ) : (
                <>
                  <div>Requested: <span className="text-slate-100">{requestedNum}</span> | Base Active: <span className="text-slate-100">{activeNum}</span> | External Added: <span className="text-slate-100">{externalAdded}</span></div>
                  <div>SerpAPI Matched: <span className="text-slate-100">{matchedCount}</span> | Written to BigQuery: <span className="text-slate-100">{progressSummary.written_rows}</span></div>
                </>
              )}
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
                  {progressSummary.current_stage}
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
          {/* ChatPanel renders directly (not inside FlyoutCard) so it's
              always mounted. That's required for the sidebar's
              cat-flow-prompt dispatch to reach it and for ChatPanel to
              broadcast cat-chat-status events the Strategy Loop listens to. */}
          <div className="min-h-0 min-w-0 overflow-hidden">
            <ChatPanel />
          </div>
          <FlyoutCard
            title="Live Pricing Intelligence"
            subtitle={isSystemError ? "System Error" : "bigquery-live"}
            icon="💹"
            badge={<><HelpIcon text={`SKU price gaps, stock state, and recommended pricing actions. ${BUSINESS_GLOSSARY.DOS.label}: ${BUSINESS_GLOSSARY.DOS.business_meaning}`} />
              <span className={`text-[11px] ${isSystemError ? 'text-red-400' : 'text-[#94a3b8]'}`}>
                {isSystemError ? "System Error" : `${filteredRows.length} SKUs`}
              </span>
            </>}
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
                <span className="text-[10px] text-[#94a3b8] italic">Pricing intelligence is syncing from BigQuery cache.</span>
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
                {filteredRows.length === 0 ? (
                  <div className="rounded-md border border-slate-700 bg-slate-800/40 px-3 py-8 text-center">
                    <div className="text-slate-200 text-[12px] font-semibold">Pricing intelligence is syncing from BigQuery cache.</div>
                    <div className="text-slate-400 text-[10px] mt-1">Rows will appear automatically when cache hydration completes.</div>
                  </div>
                ) : (
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-[11px] text-left">
                    <thead className="text-slate-400 border-b border-slate-700"><tr><th className="py-1">SKU</th><th className="py-1">Our</th><th className="py-1">Market</th><th className="py-1">Gap %</th><th className="py-1">Stock</th><th className="py-1">Flag</th></tr></thead>
                    <tbody className="text-slate-200">
                      {pagedRows.map((row) => {
                        const name = row.name || row.sku_name || row.sku_id;
                        const our = Number(row.our_price ?? row.retailer_price ?? 0) || 0;
                        const market = Number(row.competitor_price ?? 0) || 0;
                        const gapPct = Number(row.price_gap_pct ?? 0) || 0;

                        // Derived agent flag — fixed templates per spec.
                        // Without DoS / forecast data we approximate from
                        // gap_pct + stock; the displayed tooltip text matches
                        // the Azure reference verbatim.
                        const flag = !row.in_stock
                          ? { name: "Expedite Order", tip: "9 days supply — order now to avoid stockout",        color: "bg-red-900/60 text-red-200 border border-red-800" }
                          : gapPct > 7
                          ? { name: "Price Review",   tip: "Priced above Amazon — consider $100 reduction",     color: "bg-amber-900/40 text-amber-200 border border-amber-700/50" }
                          : gapPct > 0
                          ? { name: "Monitor",        tip: "On track — no action needed",                       color: "bg-slate-800 text-slate-300 border border-slate-700" }
                          : gapPct > -10
                          ? { name: "Ad Spend Needed", tip: "31% below forecast — increase search spend",        color: "bg-purple-900/40 text-purple-200 border border-purple-800" }
                          : { name: "Clearance Rec",  tip: "Below forecast — consider clearance pricing",       color: "bg-orange-900/40 text-orange-200 border border-orange-800" };

                        return (
                          <tr
                            key={row.sku_id}
                            title={`${flag.name}: ${flag.tip}`}
                            className={`border-b border-slate-800 cursor-pointer hover:bg-[#1e3a5f] transition-colors ${(selectedSku?.sku_id === row.sku_id || selected?.sku_id === row.sku_id) ? "bg-[#1e3a5f]" : ""}`}
                            onClick={() => handleSkuClick(row)}
                          >
                            <td className="py-1">{name}</td>
                            <td className="py-1">${our.toFixed(2)}</td>
                            <td className="py-1">${market.toFixed(2)}</td>
                            <td className={`py-1 font-semibold ${gapPct >= 0 ? "text-amber-300" : "text-emerald-300"}`}>{gapPct >= 0 ? "+" : ""}{gapPct.toFixed(1)}%</td>
                            <td className="py-1">{row.in_stock ? "In" : "Out"}</td>
                            <td className="py-1">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${flag.color}`}>{flag.name}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                )}
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-300">
                  <span>Page {safePage}/{totalPages} · {filteredRows.length} rows</span>
                  <div className="flex gap-1"><button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1 || isSystemError} className="px-2 py-1 rounded bg-slate-800 border border-slate-700 disabled:opacity-40">Prev</button><button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages || isSystemError} className="px-2 py-1 rounded bg-slate-800 border border-slate-700 disabled:opacity-40">Next</button></div>
                </div>
              </>
            )}
          </div>
          </FlyoutCard>
      </div>
      {/* SKU detail drawer — sits below the 3-column grid, full-width row. */}
      {selected && !isSystemError && (
        <div className="mx-4 mb-4 bg-slate-900 border border-slate-700 rounded-xl p-3 text-[12px] text-slate-200">
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
          <div className="mt-3 bg-slate-800 rounded p-2">
            <div className="text-[11px] font-semibold text-slate-200 mb-2">Competitor Details</div>
            {loadingDetails ? (
              <div className="text-[11px] text-slate-400">Loading competitor details...</div>
            ) : detailsError ? (
              <div className="text-[11px] text-red-300">{detailsError}</div>
            ) : skuDetails.length === 0 ? (
              <div className="text-[11px] text-slate-400">No competitor listings found for this SKU.</div>
            ) : (
              <div className="space-y-2">
                {skuDetails.map((d, i) => (
                  <div key={`${d.sku_id || selected.sku_id}-${i}`} className="rounded border border-slate-700 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-slate-100 font-medium">{d.sku_name || selected.name || selected.sku_name || selected.sku_id}</div>
                        <div className="text-[11px] text-slate-400">Competitor: {d.competitor_name || "Unknown"}</div>
                        <div className="text-[11px] text-slate-300">Our Retail: ${Number(d.retailer_price ?? selected.our_price ?? selected.retailer_price ?? 0).toFixed(2)}</div>
                        <div className="text-[11px] text-slate-300">Competitor: ${Number(d.competitor_price ?? 0).toFixed(2)}</div>
                        <div className="text-[11px] text-slate-300">Gap: {Number(d.price_gap_pct ?? selected.price_gap_pct ?? 0).toFixed(2)}%</div>
                        <div className="text-[11px] text-slate-300">Stock: {d.in_stock ? "In Stock" : "Out"}</div>
                        {d.product_url ? (
                          <a href={d.product_url} target="_blank" rel="noreferrer" className="text-[11px] text-blue-300 hover:underline">View Listing</a>
                        ) : null}
                      </div>
                      {d.product_image ? (
                        <img src={d.product_image} alt={d.sku_name || "product"} className="w-12 h-12 object-cover rounded border border-slate-700" />
                      ) : null}
                    </div>
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
      {/* Week detail slide-in panel — fires when user clicks a chart week. */}
      <WeekDetailPanel row={selectedWeekRow} onClose={() => setSelectedWeek(null)} />
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
      <div className="w-80 h-full flex-shrink-0 overflow-y-auto scrollbar-thin">
      <AgentControlCenter
        status={isSystemError ? 'error' : agentStatus}
        steps={isSystemError ? [{ step: 'error', content: systemErrorMessage || 'System error. Agent cannot run.' }] : agentSteps}
        error={isSystemError ? (systemErrorMessage || "System error. Agent functionality is blocked.") : agentError}
        alerts={flowAlerts}
        agentEvents={agentEvents}
      />
      </div>
      </div>
    </div>
  );
}
