"use client";

import {
  LineChart,
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

const SELL_THROUGH_DATA = [
  { week: "W40", Samsung: 420, Sony: 180, LG: 160, Forecast: 400 },
  { week: "W42", Samsung: 380, Sony: 195, LG: 145, Forecast: 390 },
  { week: "W44", Samsung: 450, Sony: 210, LG: 130, Forecast: 420 },
  { week: "W46", Samsung: 510, Sony: 225, LG: 120, Forecast: 460 },
  { week: "W48", Samsung: 490, Sony: 240, LG: 115, Forecast: 480 },
  { week: "W50", Samsung: 530, Sony: 220, LG: 110, Forecast: 500 },
  { week: "W52", Samsung: 560, Sony: 200, LG: 105, Forecast: 520 },
];

// ── Custom tooltip ─────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: "#1c2230",
        border: "1px solid #2d4a6a",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 11,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      <p style={{ color: "#60a5fa", fontWeight: 600, marginBottom: 6, fontSize: 12 }}>{label}</p>
      {payload.map((p) => (
        <div
          key={String(p.dataKey)}
          style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 2 }}
        >
          <span style={{ color: p.color }}>● {p.name}</span>
          <span style={{ color: "#fff", fontWeight: 600 }}>
            {typeof p.value === "number" ? p.value.toLocaleString() : String(p.value)} units
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Custom legend formatter ────────────────────────────────────────────────
const legendFormatter = (value: string, entry: any) => (
  <span style={{ color: entry?.color, marginRight: 12, fontSize: 11 }}>● {value}</span>
);

export default function SellThroughChart() {
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
          13-WEEK SELL-THROUGH TREND — UNITS BY BRAND
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
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={SELL_THROUGH_DATA} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="#1e2532" strokeDasharray="3 3" />
          <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#64748b" }} stroke="#475569" />
          <YAxis tick={{ fontSize: 10, fill: "#64748b" }} stroke="#475569" />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#3b82f6", strokeOpacity: 0.4 }} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={legendFormatter} />

          {/* Plan baseline reference */}
          <ReferenceLine
            y={400}
            stroke="#475569"
            strokeDasharray="3 3"
            label={{ value: "Plan", fill: "#475569", fontSize: 10, position: "right" }}
          />

          <Line
            type="monotone"
            dataKey="Samsung"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
            isAnimationActive
            animationDuration={1200}
            animationEasing="ease-out"
          />
          <Line
            type="monotone"
            dataKey="Sony"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
            isAnimationActive
            animationDuration={1200}
            animationEasing="ease-out"
          />
          <Line
            type="monotone"
            dataKey="LG"
            stroke="#ef4444"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
            isAnimationActive
            animationDuration={1200}
            animationEasing="ease-out"
          />
          <Line
            type="monotone"
            dataKey="Forecast"
            stroke="#475569"
            strokeWidth={1}
            strokeDasharray="4 4"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
            isAnimationActive
            animationDuration={1200}
            animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
