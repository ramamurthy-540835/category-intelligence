"use client";

import { useEffect, useRef, useState } from "react";

// ── useAnimatedNumber ──────────────────────────────────────────────────────
// Smoothly interpolates from the previous value to the new one over the
// given duration using requestAnimationFrame. No external dep.
function useAnimatedNumber(target: number, durationMs = 600): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = display;
    startRef.current = null;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    const tick = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const current = fromRef.current + (target - fromRef.current) * eased;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(target);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return display;
}

// ──────────────────────────────────────────────────────────────────────────────
// LIVE SCENARIO SIMULATOR — appears in place of the trend chart when the
// "Simulate: Samsung" demo flow is active. Two sliders + a 4-metric results
// card that recomputes on every slider change.
//
// The slider stores `priceReduction` as a POSITIVE value (0–20 = "discount %"),
// displayed as "-N%" so the user reads it as a price drop. The math treats
// it as positive — bigger discount → more units (price elasticity 2.3).
// ──────────────────────────────────────────────────────────────────────────────

const BASELINE_UNITS = 2200;
const ELASTICITY     = 2.3;
const ASP            = 1588;   // average selling price ($)
const MARGIN_RATE    = 0.185;  // 18.5% gross margin

const fmtMoney = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
    ? `$${(n / 1_000).toFixed(0)}K`
    : `$${n.toFixed(0)}`;

const fmtUnits = (n: number) => n.toLocaleString();

export default function ScenarioSimulator() {
  // Slider state. priceReduction is held as positive (0..20).
  // Display shows "-N%". The formula uses the positive value directly.
  const [priceReduction, setPriceReduction] = useState(10);
  const [coopInvestment, setCoopInvestment] = useState(200_000);

  const projectedUnits = Math.round(
    BASELINE_UNITS * (1 + (priceReduction / 100) * ELASTICITY) +
      (coopInvestment / 400_000) * 300,
  );
  const revenue = projectedUnits * ASP;
  const marginDollars = revenue * MARGIN_RATE;
  const irrWeeks = Math.max(1, Math.round(6 - priceReduction * 0.2));

  const baselineUnits = BASELINE_UNITS;
  const baselineRevenue = baselineUnits * ASP;
  const unitsDelta = projectedUnits - baselineUnits;
  const unitsDeltaPct = (unitsDelta / baselineUnits) * 100;
  const revenueDelta = revenue - baselineRevenue;

  // Animated displays — interpolate over 600ms when slider values change.
  const animUnits   = useAnimatedNumber(projectedUnits);
  const animRevenue = useAnimatedNumber(revenue);
  const animMargin  = useAnimatedNumber(marginDollars);
  const animIrrWk   = useAnimatedNumber(irrWeeks);

  return (
    <div
      style={{
        background: "#161b22",
        border: "1px solid #2d3748",
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <span style={{ color: "#fff", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em" }}>
          ⚡ LIVE SCENARIO SIMULATOR — SAMSUNG QN90D
        </span>
        <span
          style={{
            background: "#1e3a5f",
            color: "#60a5fa",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.1em",
            padding: "2px 8px",
            borderRadius: 4,
          }}
        >
          REAL-TIME
        </span>
      </div>

      {/* Sliders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "#94a3b8" }}>
              Price Reduction
            </label>
            <span className="text-[14px] font-bold tabular-nums" style={{ color: "#f59e0b" }}>
              -{priceReduction}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={20}
            step={1}
            value={priceReduction}
            onChange={(e) => setPriceReduction(Number(e.target.value))}
            className="w-full accent-amber-400"
          />
          <div className="flex justify-between text-[9px] mt-0.5" style={{ color: "#475569" }}>
            <span>0%</span><span>-10%</span><span>-20%</span>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "#94a3b8" }}>
              Co-op Investment
            </label>
            <span className="text-[14px] font-bold tabular-nums" style={{ color: "#60a5fa" }}>
              {fmtMoney(coopInvestment)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={400_000}
            step={10_000}
            value={coopInvestment}
            onChange={(e) => setCoopInvestment(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-[9px] mt-0.5" style={{ color: "#475569" }}>
            <span>$0</span><span>$200K</span><span>$400K</span>
          </div>
        </div>
      </div>

      {/* Results card */}
      <div
        style={{
          background: "#1e3a5f",
          border: "1px solid #2d4a7a",
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div className="text-[10px] font-bold tracking-widest uppercase mb-3" style={{ color: "#bfdbfe" }}>
          Projected Outcome
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "#bfdbfe" }}>
              Projected Units
            </div>
            <div className="text-[22px] font-bold leading-none mt-0.5 text-white tabular-nums">
              {fmtUnits(Math.round(animUnits))}
            </div>
            <div className={"text-[10px] mt-0.5 " + (unitsDelta >= 0 ? "text-emerald-300" : "text-red-300")}>
              {unitsDelta >= 0 ? "▲" : "▼"} {unitsDelta >= 0 ? "+" : ""}{unitsDelta} ({unitsDeltaPct >= 0 ? "+" : ""}{unitsDeltaPct.toFixed(1)}%) vs baseline
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "#bfdbfe" }}>
              Revenue
            </div>
            <div className="text-[22px] font-bold leading-none mt-0.5 text-white tabular-nums">
              {fmtMoney(animRevenue)}
            </div>
            <div className={"text-[10px] mt-0.5 " + (revenueDelta >= 0 ? "text-emerald-300" : "text-red-300")}>
              {revenueDelta >= 0 ? "▲" : "▼"} {revenueDelta >= 0 ? "+" : "-"}{fmtMoney(Math.abs(revenueDelta))} vs baseline
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "#bfdbfe" }}>
              Margin $
            </div>
            <div className="text-[22px] font-bold leading-none mt-0.5 text-white tabular-nums">
              {fmtMoney(animMargin)}
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: "#bfdbfe" }}>
              @ {(MARGIN_RATE * 100).toFixed(1)}% rate
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "#bfdbfe" }}>
              IRR Payback
            </div>
            <div className="text-[22px] font-bold leading-none mt-0.5 text-white tabular-nums">
              {Math.round(animIrrWk)}WK
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: "#bfdbfe" }}>
              break-even horizon
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

