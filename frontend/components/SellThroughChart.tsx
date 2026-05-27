"use client";
import React from "react";
import { useEffect } from "react";

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  type TooltipProps,
} from "recharts";

export const SELL_THROUGH_DATA = [
  { week: "W40", Samsung: 420, Sony: 180, LG: 160, Forecast: 400 },
  { week: "W42", Samsung: 380, Sony: 195, LG: 145, Forecast: 390 },
  { week: "W44", Samsung: 450, Sony: 210, LG: 130, Forecast: 420 },
  { week: "W46", Samsung: 510, Sony: 225, LG: 120, Forecast: 460 },
  { week: "W48", Samsung: 490, Sony: 240, LG: 115, Forecast: 480 },
  { week: "W50", Samsung: 530, Sony: 220, LG: 110, Forecast: 500 },
  { week: "W52", Samsung: 560, Sony: 200, LG: 105, Forecast: 520 },
];

function buildWeekSeries(weeks: number) {
  const data = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const weekNum = 52 - i;
    const base = 380 + (weeks - i) * 9;
    const samsung = Math.round(base + Math.sin((weeks - i) * 0.8) * 38);
    const sony = Math.round(180 + (weeks - i) * 4 + Math.cos((weeks - i) * 0.6) * 16);
    const lg = Math.round(165 - (weeks - i) * 2 + Math.sin((weeks - i) * 0.4) * 14);
    const forecast = Math.round(360 + (weeks - i) * 8 + Math.cos((weeks - i) * 0.3) * 10);
    data.push({ week: `W${weekNum > 0 ? weekNum : 52 + weekNum}`, Samsung: samsung, Sony: sony, LG: lg, Forecast: forecast });
  }
  return data;
}

export type SellThroughRow = (typeof SELL_THROUGH_DATA)[number];

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{ background: "#1c2230", border: "1px solid #2d4a6a", borderRadius: 8, padding: "10px 14px", fontSize: 11, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
      <p style={{ color: "#60a5fa", fontWeight: 600, marginBottom: 6, fontSize: 12 }}>{label}</p>
      {payload.map((p) => (
        <div key={String(p.dataKey)} style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 2 }}>
          <span style={{ color: p.color }}>● {p.name}</span>
          <span style={{ color: "#fff", fontWeight: 600 }}>{typeof p.value === "number" ? p.value.toLocaleString() : String(p.value)} units</span>
        </div>
      ))}
    </div>
  );
}

const legendFormatter = (value: string, entry: any) => <span style={{ color: entry?.color, marginRight: 12, fontSize: 11 }}>● {value}</span>;

function makePulseDot(color: string, classSuffix: string, lastIndex: number) {
  return (props: any) => {
    const { cx, cy, index } = props;
    if (index !== lastIndex) return null;
    return (
      <g>
        <circle cx={cx} cy={cy} r={5} fill={color} className={`pulse-ring ${classSuffix}`} />
        <circle cx={cx} cy={cy} r={4} fill={color} stroke="#fff" strokeWidth={1.2} />
      </g>
    );
  };
}

interface Props {
  flowKey?: string | number;
  onWeekClick?: (week: string) => void;
  weekWindow?: number;
  onWeekWindowChange?: (weeks: number) => void;
  onDataChange?: (rows: Array<{ week: string; Samsung: number; Sony: number; LG: number; Forecast: number }>) => void;
}

export default function SellThroughChart({ flowKey, onWeekClick, weekWindow = 13, onWeekWindowChange, onDataChange }: Props) {
  const [remoteRows, setRemoteRows] = React.useState<Array<{ week: string; Samsung: number; Sony: number; LG: number; Forecast: number }>>([]);
  const [fromWeek, setFromWeek] = React.useState<string>("");
  const [toWeek, setToWeek] = React.useState<string>("");
  const safeWindow = Math.max(5, Math.min(20, weekWindow));
  const generated = buildWeekSeries(safeWindow);
  const baseData = remoteRows.length > 0 ? remoteRows : generated;
  const windowedData = baseData.slice(Math.max(0, baseData.length - safeWindow));
  const data = windowedData.filter((r) => {
    if (!fromWeek && !toWeek) return true;
    const n = Number(r.week.replace("W", ""));
    const from = fromWeek ? Number(fromWeek.replace("W", "")) : -Infinity;
    const to = toWeek ? Number(toWeek.replace("W", "")) : Infinity;
    return n >= from && n <= to;
  });
  const currentWeek = data.length > 0 ? data[data.length - 1].week : "--";
  const flowTitleSuffix = flowKey === "diagnose-lg-c3"
    ? " (LG C3 Focus)"
    : flowKey === "price-vs-amazon"
    ? " (Price Gap Watch)"
    : "";
  React.useEffect(() => {
    const params = new URLSearchParams({
      start_date: "2026-04-30",
      end_date: "2026-05-27",
      categories: "TV,Soundbar,Receiver,Streaming,Projector,Headphones",
    });
    fetch(`/api/dashboard/sell-through?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.rows) && d.rows.length) setRemoteRows(d.rows);
      })
      .catch(() => {});
  }, [flowKey]);
  useEffect(() => {
    onDataChange?.(data);
  }, [onDataChange, safeWindow, fromWeek, toWeek, remoteRows.length]);
  const lastIndex = data.length - 1;
  const handleChartClick = (state: any) => {
    const week = state?.activeLabel;
    if (typeof week === "string" && week) onWeekClick?.(week);
  };

  return (
    <div style={{ background: "#161b22", border: "1px solid #2d3748", borderRadius: 8, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: "#fff", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em" }}>
          {safeWindow}-WEEK SELL-THROUGH TREND - UNITS BY BRAND
          {flowTitleSuffix}
          <span style={{ color: "#94a3b8", fontWeight: 500 }}> (Samsung / Sony / LG)</span>
        </span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {[5, 10, 13, 15].map((w) => (
            <button key={w} type="button" onClick={() => onWeekWindowChange?.(w)} style={{ border: "1px solid #334155", borderRadius: 4, padding: "1px 6px", fontSize: 10, color: safeWindow === w ? "#60a5fa" : "#94a3b8", background: safeWindow === w ? "#1e3a5f" : "#161b22" }}>
              {w}w
            </button>
          ))}
          <span style={{ background: "#1e3a5f", color: "#60a5fa", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", padding: "2px 8px", borderRadius: 4 }}>REAL-TIME</span>
          <span style={{ background: "#111827", color: "#cbd5e1", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", padding: "2px 8px", borderRadius: 4, border: "1px solid #334155" }}>
            {currentWeek}
          </span>
          <select value={fromWeek} onChange={(e) => setFromWeek(e.target.value)} style={{ border: "1px solid #334155", borderRadius: 4, padding: "1px 6px", fontSize: 10, color: "#cbd5e1", background: "#161b22" }}>
            <option value="">From</option>
            {baseData.map((r) => <option key={`f-${r.week}`} value={r.week}>{r.week}</option>)}
          </select>
          <select value={toWeek} onChange={(e) => setToWeek(e.target.value)} style={{ border: "1px solid #334155", borderRadius: 4, padding: "1px 6px", fontSize: 10, color: "#cbd5e1", background: "#161b22" }}>
            <option value="">To</option>
            {baseData.map((r) => <option key={`t-${r.week}`} value={r.week}>{r.week}</option>)}
          </select>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart key={flowKey} data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }} onClick={handleChartClick} style={{ cursor: onWeekClick ? "pointer" : undefined }}>
          <defs>
            <linearGradient id="samsung-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient>
            <linearGradient id="sony-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} /><stop offset="95%" stopColor="#f59e0b" stopOpacity={0} /></linearGradient>
            <linearGradient id="lg-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid stroke="#1e2532" strokeDasharray="3 3" vertical horizontal />
          <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#64748b" }} stroke="#475569" />
          <YAxis tick={{ fontSize: 10, fill: "#64748b" }} stroke="#475569" />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#3b82f6", strokeWidth: 1, strokeDasharray: "4 4" }} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={legendFormatter} />
          <ReferenceLine y={400} stroke="#475569" strokeDasharray="3 3" label={{ value: "Plan", fill: "#475569", fontSize: 10, position: "right" }} />
          <Area type="monotone" dataKey="Samsung" stroke="#3b82f6" strokeWidth={2} fill="url(#samsung-gradient)" fillOpacity={1} dot={makePulseDot("#3b82f6", "pulse-samsung", lastIndex)} activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }} isAnimationActive animationDuration={1400} animationEasing="ease-out" />
          <Area type="monotone" dataKey="Sony" stroke="#f59e0b" strokeWidth={2} fill="url(#sony-gradient)" fillOpacity={1} dot={makePulseDot("#f59e0b", "pulse-sony", lastIndex)} activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }} isAnimationActive animationDuration={1400} animationEasing="ease-out" />
          <Area type="monotone" dataKey="LG" stroke="#ef4444" strokeWidth={2} fill="url(#lg-gradient)" fillOpacity={1} dot={makePulseDot("#ef4444", "pulse-lg", lastIndex)} activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }} isAnimationActive animationDuration={1400} animationEasing="ease-out" />
          <Line type="monotone" dataKey="Forecast" stroke="#475569" strokeWidth={1} strokeDasharray="4 4" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} isAnimationActive animationDuration={1400} animationEasing="ease-out" />
        </ComposedChart>
      </ResponsiveContainer>

      <style>{`
        .pulse-ring { transform-box: fill-box; transform-origin: center; animation: pulse-ring 1.6s ease-in-out infinite; }
        .pulse-samsung { animation-delay: 0ms; }
        .pulse-sony { animation-delay: 200ms; }
        .pulse-lg { animation-delay: 400ms; }
        @keyframes pulse-ring { 0% { transform: scale(1); opacity: 0.85; } 50% { transform: scale(1.8); opacity: 0.20; } 100% { transform: scale(1); opacity: 0.85; } }
      `}</style>
    </div>
  );
}
