"use client";

import { useState } from "react";

// Far-left "Demo Flows" sidebar (Part 3 spec).
// Self-contained: manages its own activeFlowId so the highlight works
// without any wiring from the parent page. A parent can still override
// via the `activeFlowId` prop if it needs to drive selection externally.
//
// Clicking a flow:
//   • highlights the row immediately,
//   • fires a rich `cat-flow-event` (used by AgentControlCenter), and
//   • fires the legacy `cat-flow-prompt` event (used by ChatPanel) so the
//     prompt streams to the chat.

type Flow = {
  id: string;
  icon: string;
  label: string;
  alert?: boolean;
  flowId?: string;
  prompt: string;
  description: string;
};

const DEMO_FLOWS: Flow[] = [
  {
    id: "category-overview",
    icon: "⊕",
    label: "Category Overview",
    alert: true,
    prompt: "Give me a full category overview from Q4 2024 through Q1 2026 — revenue, margin, inventory health, and forecast accuracy across Home Appliance, Mobile, and Accessories SKUs.",
    description: "Q4 performance snapshot across all brands and channels",
  },
  {
    id: "health-check",
    icon: "♡",
    label: "Health Check",
    alert: true,
    prompt: "Run a 90-day health check across Home Appliance, Mobile, and Accessories. Identify anomalies, overstock risks, and stockout threats using z-score analysis.",
    description: "90-day anomaly detection with z-score analysis",
  },
  {
    id: "diagnose-lg-c3",
    icon: "⚕",
    label: "Diagnose: LG C3",
    alert: false,
    prompt: "The LG C3 is down 31%. Walk me through what happened and tell me what I should do about it.",
    description: "Root cause analysis — price, promo, competitive",
  },
  {
    id: "simulate-samsung",
    icon: "⚡",
    label: "Simulate: Samsung",
    alert: false,
    prompt: "Run a demand simulation for Samsung QN90D. Model 4 scenarios using price and co-op levers. Show projected units, revenue, margin and IRR per scenario.",
    description: "4-scenario demand simulation with IRR",
  },
  {
    id: "spring-assortment",
    icon: "☰",
    label: "Spring Assortment",
    alert: false,
    prompt: "Build a Spring cycle assortment plan for Home Theater. Which SKUs to add, drop, or expand? Evaluate bottom-quartile performers and price gaps in high-growth segments.",
    description: "Seasonal add/drop/expand with data scoring",
  },
  {
    id: "exec-review",
    icon: "📊",
    label: "Exec Review",
    alert: false,
    prompt: "Generate a full executive review for Q4 2024 through Q1 2026 across Home Appliance, Mobile, and Accessories. Include competitive scorecard, digital friction summary, cycle recommendations, and a 30/60-day action plan.",
    description: "C-suite narrative + 30/60-day action plan",
  },
  {
    id: "ad-plan-optimizer",
    icon: "📣",
    label: "Ad Plan Optimizer",
    alert: true,
    prompt: "Run the ad plan optimizer. Show vendor co-op balances, rank channels by ROAS, generate a monthly promotional calendar, and flag any budgets at expiry risk.",
    description: "Co-op tracker, ROAS ranking, expiry flags",
  },
  {
    id: "price-vs-amazon",
    icon: "🏷️",
    label: "Price vs Amazon",
    alert: true,
    prompt: "Compare our prices vs Amazon across Home Appliance, Mobile, and Accessories SKUs. Show the biggest gaps with unit-level margin impact and urgency scores.",
    description: "Real-time price gaps + margin-at-risk",
  },
];

const QUICK_ACTIONS: Flow[] = [
  {
    id: "qa-health",
    flowId: "health-check",
    icon: "♡",
    label: "90-Day Health Check",
    prompt: "Run a 90-day health check on the Home Theater category.",
    description: "",
  },
  {
    id: "qa-diagnose",
    flowId: "diagnose-lg-c3",
    icon: "⚕",
    label: "Diagnose LG C3",
    prompt: "The LG C3 is down 31%. Walk me through root cause and recovery paths.",
    description: "",
  },
  {
    id: "qa-price",
    flowId: "price-vs-amazon",
    icon: "🏷️",
    label: "Price vs Amazon",
    prompt: "Compare our Home Theater prices vs Amazon. Show biggest gaps with margin impact.",
    description: "",
  },
  {
    id: "qa-ad",
    flowId: "ad-plan-optimizer",
    icon: "📣",
    label: "Ad Plan Optimizer",
    prompt: "Show vendor co-op balances, ROAS by channel, and flag expiry risks.",
    description: "",
  },
];

interface Props {
  // Optional: parent can drive selection. If omitted the sidebar manages its
  // own active state, defaulting to "category-overview".
  activeFlowId?: string;
  onFlowSelect?: (prompt: string, flowId: string) => void;
  alertFlowIds?: Set<string>;
}

const SectionLabel = ({ children, mt }: { children: React.ReactNode; mt?: string }) => (
  <p
    className={"px-4 text-[9px] font-semibold tracking-widest uppercase mb-1.5 " + (mt || "")}
    style={{ color: "var(--bby-sidebar-label, #475569)" }}
  >
    {children}
  </p>
);

export default function DemoFlowsSidebar({ activeFlowId, onFlowSelect, alertFlowIds }: Props) {
  // Internal active state. If a parent passes `activeFlowId`, it wins.
  const [internalActive, setInternalActive] = useState<string>("category-overview");
  const active = activeFlowId ?? internalActive;

  const fire = (flow: Flow) => {
    if (activeFlowId === undefined) setInternalActive(flow.id);
    onFlowSelect?.(flow.prompt, flow.id);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("cat-flow-event", {
          detail: { prompt: flow.prompt, flowId: flow.flowId || flow.id, label: flow.label, icon: flow.icon },
        }),
      );
      window.dispatchEvent(new CustomEvent("cat-flow-prompt", { detail: flow.prompt }));
    }
  };

  const hasAlert = (f: Flow) => (alertFlowIds ? alertFlowIds.has(f.id) : !!f.alert);

  return (
    <aside
      className="w-64 h-full flex-shrink-0 flex flex-col py-4 overflow-y-auto scrollbar-none"
      style={{
        background: "var(--bby-sidebar-bg, #0d1117)",
        borderRight: "1px solid var(--bby-border-subtle, #1e2532)",
      }}
    >
      <SectionLabel>Analytical Workflows</SectionLabel>

      <div className="flex flex-col gap-0.5 px-2 mb-2">
        {DEMO_FLOWS.map((flow) => {
          const isActive = active === flow.id;
          return (
            <button
              key={flow.id}
              type="button"
              onClick={() => fire(flow)}
              title={flow.description}
              className={
                "flex items-center gap-2.5 text-left w-full transition-colors duration-150 " +
                (isActive
                  ? "py-1.5 pl-2.5 pr-3 rounded-r-md font-medium"
                  : "px-3 py-1.5 rounded-md hover:bg-[#1c2230] hover:text-[#e2e8f0]")
              }
              style={
                isActive
                  ? {
                      background: "var(--bby-sidebar-active-bg, #1e3a5f)",
                      borderLeft: "2px solid var(--bby-sidebar-active-border, #3b82f6)",
                      color: "var(--bby-sidebar-active-text, #60a5fa)",
                    }
                  : {
                      borderLeft: "2px solid transparent",
                      color: "var(--bby-sidebar-text, #94a3b8)",
                    }
              }
            >
              <span className="text-[12px] flex-shrink-0 leading-none w-4 text-center" aria-hidden="true">
                {flow.icon}
              </span>
              <span className="flex-1 truncate text-[11px]">{flow.label}</span>
              {hasAlert(flow) && (
                <span
                  className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                  style={{ background: "var(--bby-alert-badge-bg, #dc2626)", color: "#fff" }}
                  aria-label="Alert"
                >
                  !
                </span>
              )}
            </button>
          );
        })}
      </div>

      <SectionLabel mt="mt-5">Quick Actions</SectionLabel>

      <div className="flex flex-col gap-0.5 px-2">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => fire(action)}
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-md text-left w-full transition-colors hover:bg-[#1c2230] hover:text-[#e2e8f0]"
            style={{ color: "var(--bby-muted, #64748b)" }}
          >
            <span className="text-[11px] flex-shrink-0 leading-none w-4 text-center" aria-hidden="true">
              {action.icon}
            </span>
            <span className="text-[10px]">{action.label}</span>
          </button>
        ))}
      </div>

      {/* Governance badge — pinned to bottom */}
      <div
        className="mt-auto mx-2 mt-6 rounded-md px-3 py-2.5 text-[10px] leading-tight"
        style={{
          background: "var(--bby-surface-1, #161b22)",
          border: "1px solid var(--bby-border, #2d3748)",
        }}
      >
        <div className="flex items-center gap-1.5 font-bold tracking-wide" style={{ color: "#22c55e" }}>
          <span>🔒</span>
          <span>GOVERNANCE ON</span>
        </div>
        <div className="mt-1 leading-relaxed" style={{ color: "#475569" }}>
          VPC-isolated · PII redacted · Full audit log
        </div>
      </div>
    </aside>
  );
}
