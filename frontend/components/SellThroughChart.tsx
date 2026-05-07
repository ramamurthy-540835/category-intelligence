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
} from "recharts";

// 13-week sell-through trend — units by brand vs. forecast.
// Static demo data; swap to a real /api/dashboard/sell_through endpoint
// when the BigQuery weekly aggregation is wired.
const SELL_THROUGH_DATA = [
  { week: "W40", Samsung: 420, Sony: 180, LG: 160, Forecast: 400 },
  { week: "W42", Samsung: 380, Sony: 195, LG: 145, Forecast: 390 },
  { week: "W44", Samsung: 450, Sony: 210, LG: 130, Forecast: 420 },
  { week: "W46", Samsung: 510, Sony: 225, LG: 120, Forecast: 460 },
  { week: "W48", Samsung: 490, Sony: 240, LG: 115, Forecast: 480 },
  { week: "W50", Samsung: 530, Sony: 220, LG: 110, Forecast: 500 },
  { week: "W52", Samsung: 560, Sony: 200, LG: 105, Forecast: 520 },
];

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
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={SELL_THROUGH_DATA} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="#1e2532" strokeDasharray="3 3" />
          <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#64748b" }} stroke="#475569" />
          <YAxis tick={{ fontSize: 10, fill: "#64748b" }} stroke="#475569" />
          <Tooltip
            contentStyle={{
              background: "#1c2230",
              border: "1px solid #2d3748",
              borderRadius: 6,
              fontSize: 11,
              color: "#e2e8f0",
            }}
            labelStyle={{ color: "#94a3b8" }}
            cursor={{ stroke: "#3b82f6", strokeOpacity: 0.4 }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
          <Line type="monotone" dataKey="Samsung"  stroke="#3b82f6" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="Sony"     stroke="#f59e0b" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="LG"       stroke="#ef4444" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="Forecast" stroke="#475569" strokeWidth={1} strokeDasharray="4 4" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
