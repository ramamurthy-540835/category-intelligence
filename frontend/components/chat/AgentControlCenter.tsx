"use client";
import React, { useEffect, useState } from "react";
import { Status, AgentStep } from "../../lib/sse/useSSE";

// ──────────────────────────────────────────────────────────────────────────────
// Agent Control Center — 320 px right rail (Part 2 spec).
//
// Sections:
//   1. Brand header (BBY blue) + status indicator
//   2. Activity / Alerts tabs (with red badge count)
//   3. Active Flow card
//   4. Agent Strategy Loop  (Think / Act / Analyze / Respond)
//   5. Multi-Agent Network  (Sensing / Nerve / Intelligence / Integration)
//   6. Live Alerts          (4 hardcoded demo items)
//   7. Vendor Co-op Budget  (Samsung / LG / Sony=92%RED / Bose)
//   8. Agent Memory         (FLOW vs MESSAGE entries)
// ──────────────────────────────────────────────────────────────────────────────

interface Alert { priority: "P1" | "P2"; sku: string; msg: string; }
interface AgentEvent { stage?: string; status?: string; message?: string; timestamp?: string; }

interface Props {
  status?: Status;
  steps?: { step: AgentStep; content: string }[];
  error?: string | null;
  alerts?: Alert[];
  agentEvents?: AgentEvent[];
}

// ── Strategy loop step config ────────────────────────────────────────────────
type StepKey = "think" | "act" | "analyze" | "respond";
const STRATEGY_STEPS: { key: StepKey; label: string; activeText: string; doneText: string }[] = [
  { key: "think",   label: "Think",   activeText: "Reasoning",      doneText: "Reasoned"     },
  { key: "act",     label: "Act",     activeText: "Calling tools",  doneText: "Tools called" },
  { key: "analyze", label: "Analyze", activeText: "Synthesizing",   doneText: "Analyzed"     },
  { key: "respond", label: "Respond", activeText: "Generating",     doneText: "Done"         },
];

const STEP_ORDER: StepKey[] = ["think", "act", "analyze", "respond"];

function classifyStepState(
  stepKey: StepKey,
  status: Status | undefined,
  steps: Props["steps"] = [],
): "done" | "active" | "waiting" {
  const idx = STEP_ORDER.indexOf(stepKey);
  const latest = [...steps].reverse().find((s) => STEP_ORDER.includes(s.step as StepKey));
  const latestKey = latest?.step as StepKey | undefined;
  const latestIdx = latestKey ? STEP_ORDER.indexOf(latestKey) : -1;

  if (status === "done" || (status as string) === "completed") {
    return "done";
  }
  if (status === "idle") return "waiting";
  if (idx < latestIdx) return "done";
  if (idx === latestIdx) return "active";
  return "waiting";
}

// ── Multi-agent network — derive from current strategy step ──────────────────
type AgentName = "Sensing Agent" | "Nerve Agent" | "Intelligence Agent" | "Integration Agent";
type AgentRunState = "idle" | "running" | "done" | "error";

function networkState(
  agent: AgentName,
  status: Status | undefined,
  steps: Props["steps"] = [],
): AgentRunState {
  if (status === "error") return "error";
  if (status === "done" || (status as string) === "completed") return "done";
  if (status === "idle" || !steps.length) return "idle";

  const latest = [...steps].reverse().find((s) => STEP_ORDER.includes(s.step as StepKey));
  const k = latest?.step as StepKey | undefined;
  const idx = k ? STEP_ORDER.indexOf(k) : -1;

  // think → Sensing running
  // act   → Nerve + Intelligence running
  // analyze → Intelligence running
  // respond → Integration running
  switch (agent) {
    case "Sensing Agent":
      if (k === "think") return "running";
      return idx > 0 ? "done" : "idle";
    case "Nerve Agent":
      if (k === "act") return "running";
      return idx > 1 ? "done" : "idle";
    case "Intelligence Agent":
      if (k === "act" || k === "analyze") return "running";
      return idx > 2 ? "done" : "idle";
    case "Integration Agent":
      if (k === "respond") return "running";
      return status === "done" ? "done" : "idle";
  }
}

// ── Hardcoded demo data per spec ─────────────────────────────────────────────
const HARDCODED_ALERTS: Array<{ priority: "P1" | "P2"; sku: string; body: string; age: string }> = [
  { priority: "P1", sku: 'Sony X90L 75"',     body: "Stockout in 9 days · Tier A",                                age: "2 min ago"  },
  { priority: "P1", sku: 'Samsung QN85C 65"', body: "Price 7.7% above Amazon",                                    age: "6 min ago"  },
  { priority: "P1", sku: 'LG C3 OLED 55"',    body: "31% below forecast · 580 units overstock",                    age: "12 min ago" },
  { priority: "P2", sku: "Hisense U8K",       body: "$43K co-op expiring Dec 31 · Only 43% consumed",             age: "24 min ago" },
];

const COOP_BUDGETS = [
  { vendor: "Samsung", spent: 68, budget: 120 },
  { vendor: "LG",      spent: 42, budget: 95  },
  { vendor: "Sony",    spent: 55, budget: 60  },  // 92% — RED bar
  { vendor: "Bose",    spent: 18, budget: 30  },
];

// Per-flow descriptive metadata for the Active Flow card
const FLOW_META: Record<string, { desc: string; stats: string }> = {
  "category-overview":  { desc: "Q4 performance snapshot",   stats: "47 SKUs · 50 stores · 4 competitors · real-time" },
  "health-check":       { desc: "90-day anomaly detection",  stats: "z-score · 47 SKUs · 13-week window" },
  "diagnose-lg-c3":     { desc: "Root-cause SKU drill-down", stats: "1 SKU · 4 channels · variance vs forecast" },
  "simulate-samsung":   { desc: "Demand simulation",         stats: "4 scenarios · price + co-op levers" },
  "spring-assortment":  { desc: "Seasonal assortment plan",  stats: "Add / drop / expand · sell-through" },
  "exec-review":        { desc: "Executive review",          stats: "Competitive scorecard · 30/60-day plan" },
  "ad-plan-optimizer":  { desc: "Ad / co-op optimization",   stats: "Channel ROAS · expiry risks" },
  "price-vs-amazon":    { desc: "Competitive price audit",   stats: "All HT SKUs · gap + margin impact" },
};

// ── Tiny presentational helpers ──────────────────────────────────────────────
function StepCircle({ state, ordinal }: { state: "done" | "active" | "waiting"; ordinal: number }) {
  const common = "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0";
  if (state === "done") {
    return <span className={common} style={{ background: "#166534", color: "#22c55e" }}>✓</span>;
  }
  if (state === "active") {
    return (
      <span className={common + " animate-pulse_dot"} style={{ background: "#1e3a5f" }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#3b82f6" }} />
      </span>
    );
  }
  return <span className={common} style={{ background: "#1e2532", color: "#475569" }}>{ordinal}</span>;
}

function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between mb-2 mt-3 px-4">
      <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: "var(--bby-sidebar-label)" }}>{children}</span>
      {right}
    </div>
  );
}

const nowTimeStr = () =>
  new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// ── Component ────────────────────────────────────────────────────────────────
export default function AgentControlCenter({
  status: propStatus = "idle",
  steps: propSteps = [],
  error,
}: Props) {
  const [tab, setTab] = useState<"activity" | "alerts">("activity");
  const [activeFlow, setActiveFlow] = useState<{ flowId: string; label: string; icon: string } | null>(null);
  const [memory, setMemory] = useState<Array<{ type: "flow" | "message"; text: string; ts: string }>>([]);

  // Strategy Loop and Multi-Agent Network mirror the *chat* agent, not the
  // dashboard pipeline. Subscribe to ChatPanel's `cat-chat-status` events.
  // Falls back to props if ChatPanel hasn't fired yet (idle state).
  const [chatStatus, setChatStatus] = useState<Status>(propStatus);
  const [chatSteps, setChatSteps] = useState<Props["steps"]>(propSteps);
  const [processingStartedAt, setProcessingStartedAt] = useState<number | null>(null);
  useEffect(() => {
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === "object") {
        if (detail.status !== undefined) setChatStatus(detail.status);
        if (Array.isArray(detail.steps)) setChatSteps(detail.steps);
      }
    };
    window.addEventListener("cat-chat-status", onStatus);
    return () => window.removeEventListener("cat-chat-status", onStatus);
  }, []);
  // Local aliases used below for the loop / network rendering.
  const status = chatStatus;
  const steps = chatSteps;
  useEffect(() => {
    if (status !== "idle" && status !== "done" && status !== "error") {
      setProcessingStartedAt((prev) => prev ?? Date.now());
      return;
    }
    setProcessingStartedAt(null);
  }, [status]);
  const isLongRunning = processingStartedAt !== null && Date.now() - processingStartedAt > 10000;

  // Listen for sidebar flow events + chat-input events for memory
  useEffect(() => {
    const onFlow = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === "object" && (detail as any).flowId) {
        const { flowId, label, icon } = detail as { flowId: string; label: string; icon: string };
        setActiveFlow({ flowId, label, icon });
        setMemory((prev) => [
          { type: "flow", text: `Flow completed: ${label}`, ts: nowTimeStr() },
          ...prev,
        ].slice(0, 8));
      }
    };
    const onUserInput = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "string" && detail.trim()) {
        const trimmed = detail.length > 80 ? detail.slice(0, 80) + "…" : detail;
        setMemory((prev) => [
          { type: "message", text: trimmed, ts: nowTimeStr() },
          ...prev,
        ].slice(0, 8));
      }
    };
    window.addEventListener("cat-flow-event", onFlow);
    window.addEventListener("cat-flow-prompt-from-input", onUserInput);
    return () => {
      window.removeEventListener("cat-flow-event", onFlow);
      window.removeEventListener("cat-flow-prompt-from-input", onUserInput);
    };
  }, []);

  // Status indicator
  const isError = status === "error";
  const isDone = status === "done" || (status as string) === "completed";
  const isRunning = !isError && !isDone && status !== "idle";

  const headerStatus = isError
    ? { dot: "#ef4444", text: "Error",   color: "#ef4444", pulse: false }
    : isDone
    ? { dot: "#22c55e", text: "Done",    color: "#22c55e", pulse: false }
    : isLongRunning
    ? { dot: "#f59e0b", text: "Degraded Sync", color: "#f59e0b", pulse: true }
    : isRunning
    ? { dot: "#f59e0b", text: "Running", color: "#f59e0b", pulse: true }
    : { dot: "#0ea5e9", text: "Syncing", color: "#7dd3fc", pulse: true };

  const alertCount = HARDCODED_ALERTS.length;
  const flowMeta = activeFlow ? FLOW_META[activeFlow.flowId] : null;

  return (
    <aside
      className="w-80 h-full flex-shrink-0 flex flex-col"
      style={{ background: "var(--bby-acc-bg)", borderLeft: "1px solid var(--bby-acc-border)" }}
    >
      {/* 1. Header */}
      <div className="h-12 flex items-center px-3 gap-2 flex-shrink-0" style={{ background: "var(--bby-acc-header-bg)" }}>
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-sm bg-bby-yellow text-bby-blue font-extrabold text-[8px] leading-tight text-center">BEST<br/>BUY</span>
        <span className="text-white text-[11px] font-bold tracking-widest flex-1">AGENT CONTROL CENTER</span>
        <span className={"w-2 h-2 rounded-full " + (headerStatus.pulse ? "animate-pulse_dot" : "")} style={{ background: headerStatus.dot }} />
        <span className="text-[11px] font-medium" style={{ color: headerStatus.color }}>{headerStatus.text}</span>
      </div>

      {/* 2. Tabs */}
      <div className="flex items-center px-3 border-b" style={{ borderColor: "var(--bby-acc-border)", background: "#0f1923" }}>
        {(["activity", "alerts"] as const).map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "px-3 py-2 text-[12px] -mb-px border-b-2 transition-colors flex items-center gap-1.5 " +
                (active
                  ? "border-bby-accent text-white font-semibold"
                  : "border-transparent text-slate-400 hover:text-slate-200")
              }
            >
              <span className="capitalize">{t}</span>
              {t === "alerts" && alertCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[9px] font-bold">{alertCount}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex-1 pb-4 text-[12px] text-slate-200">
        {tab === "activity" ? (
          <>
            {/* 3. Active Flow */}
            <SectionLabel>Active Flow</SectionLabel>
            <div className="px-4">
              {activeFlow ? (
                <div className="flex items-start gap-3">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full text-base flex-shrink-0"
                    style={{ background: "#1e3a5f", color: "#60a5fa" }}>
                    {activeFlow.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs md:text-sm font-medium text-slate-200 leading-normal max-w-full text-center p-2 block break-words">{activeFlow.label}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: "#64748b" }}>{flowMeta?.desc || "Flow context"}</div>
                    <div className="text-[10px] mt-1.5" style={{ color: "#475569" }}>Monitoring</div>
                    <div className="text-[10px]" style={{ color: "#64748b" }}>{flowMeta?.stats || "—"}</div>
                  </div>
                </div>
              ) : (
                <div className="text-[11px]" style={{ color: "#64748b" }}>No flow selected. Pick one from the sidebar.</div>
              )}
            </div>

            {error && (
              <details className="mx-4 mt-3 mb-1 rounded-md border border-red-900/60 bg-red-950/30 text-[11px] text-red-100">
                <summary className="cursor-pointer list-none px-2 py-1.5 flex items-center justify-between">
                  <span className="truncate">Sync temporarily degraded</span>
                  <span className="text-red-300 text-[10px]">Details</span>
                </summary>
                <div className="px-2 pb-2 text-red-200 break-words">
                  {String(error).slice(0, 500)}
                </div>
              </details>
            )}

            {/* 4. Agent Strategy Loop */}
            <SectionLabel>↻ Agent Loop</SectionLabel>
            <div className="px-4 space-y-1.5">
              {STRATEGY_STEPS.map((s, i) => {
                const state = classifyStepState(s.key, status, steps);
                const sub =
                  state === "active"  ? `${s.activeText}…` :
                  state === "done"    ? s.doneText :
                                        "Waiting…";
                const subColor = state === "active" ? "#f59e0b" : state === "done" ? "#64748b" : "#475569";
                const labelClass =
                  state === "active"  ? "text-[#60a5fa] font-medium" :
                  state === "done"    ? "text-white font-medium" :
                                        "text-[#475569]";
                return (
                  <div key={s.key} className="flex items-center gap-2.5 h-8">
                    <StepCircle state={state} ordinal={i + 1} />
                    <span className={"text-sm flex-1 " + labelClass}>{s.label}</span>
                    <span className="text-xs" style={{ color: subColor }}>{sub}</span>
                  </div>
                );
              })}
            </div>

            {/* 5. Multi-Agent Network */}
            <SectionLabel>Multi-Agent Network</SectionLabel>
            <div className="px-4 space-y-1">
              {(["Sensing Agent", "Nerve Agent", "Intelligence Agent", "Integration Agent"] as AgentName[]).map((agent) => {
                const s = networkState(agent, status, steps);
                const dot = s === "running" ? "#3b82f6" : s === "done" ? "#22c55e" : s === "error" ? "#ef4444" : "#1e2532";
                const text = s === "running" ? "running…" : s === "done" ? "done ✓" : s === "error" ? "error" : "waiting";
                const textColor = s === "running" ? "#3b82f6" : s === "done" ? "#22c55e" : s === "error" ? "#ef4444" : "#475569";
                return (
                  <div key={agent} className="flex items-center justify-between h-7">
                    <div className="flex items-center gap-2">
                      <span className={"w-2 h-2 rounded-full " + (s === "running" ? "animate-pulse_dot" : "")} style={{ background: dot }} />
                      <span className="text-xs" style={{ color: "#94a3b8" }}>{agent}</span>
                    </div>
                    <span className="text-xs" style={{ color: textColor }}>{text}</span>
                  </div>
                );
              })}
            </div>

            {/* 6. Live Alerts */}
            <SectionLabel
              right={
                <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[9px] font-bold">
                  {alertCount}
                </span>
              }
            >
              Live Alerts
            </SectionLabel>
            <div className="px-2 space-y-1.5">
              {HARDCODED_ALERTS.map((a, i) => {
                const isP1 = a.priority === "P1";
                return (
                  <div
                    key={i}
                    className="rounded-md px-3 py-2"
                    style={{
                      background: isP1 ? "rgba(220,38,38,0.10)" : "rgba(245,158,11,0.10)",
                      borderLeft: `2px solid ${isP1 ? "#dc2626" : "#f59e0b"}`,
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-white text-xs font-medium truncate">{a.sku}</span>
                      <span className="text-[10px]" style={{ color: "#475569" }}>{a.age}</span>
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: "#94a3b8" }}>{a.body}</div>
                  </div>
                );
              })}
            </div>

            {/* 7. Vendor Co-op Budget */}
            <SectionLabel>Vendor Co-op Budget</SectionLabel>
            <div className="px-4 space-y-2.5">
              {COOP_BUDGETS.map((c) => {
                const pct = Math.round((c.spent / c.budget) * 100);
                const danger = pct >= 85;
                return (
                  <div key={c.vendor}>
                    <div className="flex items-center justify-between text-xs">
                      <span style={{ color: "#94a3b8" }}>{c.vendor}</span>
                      <span className="text-white">${c.spent}K <span className="text-slate-500">/ ${c.budget}K</span></span>
                    </div>
                    <div className="h-1 rounded-full mt-1 overflow-hidden" style={{ background: "#1e2532" }}>
                      <div className="h-full rounded-full"
                        style={{ width: `${Math.min(100, pct)}%`, background: danger ? "#ef4444" : "#3b82f6" }} />
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: "#475569" }}>{pct}% consumed · Q4</div>
                  </div>
                );
              })}
            </div>

            {/* 8. Agent Memory */}
            <SectionLabel
              right={
                <span className="text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded"
                  style={{ background: "#1e3a5f", color: "#60a5fa" }}>
                  CONTEXT RETAINED ({memory.length})
                </span>
              }
            >
              <span className="mr-1">🧠</span>Agent Memory
            </SectionLabel>
            {memory.length === 0 ? (
              <div className="px-4 text-[11px]" style={{ color: "#64748b" }}>No flows triggered yet.</div>
            ) : (
              <div>
                {memory.map((m, i) => (
                  <div key={i} className="px-4 py-2" style={{ borderBottom: "1px solid #1e2532" }}>
                    <div className="flex items-baseline gap-1.5">
                      {m.type === "flow" && (
                        <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded"
                          style={{ background: "#1e3a5f", color: "#60a5fa" }}>FLOW</span>
                      )}
                      <span className="text-white text-xs flex-1 truncate">{m.text}</span>
                      <span className="text-[10px] flex-shrink-0" style={{ color: "#475569" }}>{m.ts}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          // ── Alerts tab ──
          <div className="px-2 pt-3 space-y-1.5">
            {HARDCODED_ALERTS.map((a, i) => {
              const isP1 = a.priority === "P1";
              return (
                <div
                  key={i}
                  className="rounded-md px-3 py-2"
                  style={{
                    background: isP1 ? "rgba(220,38,38,0.10)" : "rgba(245,158,11,0.10)",
                    borderLeft: `2px solid ${isP1 ? "#dc2626" : "#f59e0b"}`,
                  }}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{
                        background: isP1 ? "#7f1d1d" : "#78350f",
                        color: isP1 ? "#fca5a5" : "#fcd34d",
                      }}>
                      {a.priority}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-medium">{a.sku}</div>
                      <div className="text-[11px]" style={{ color: "#94a3b8" }}>{a.body}</div>
                      <div className="text-[10px] mt-1" style={{ color: "#475569" }}>{a.age}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
