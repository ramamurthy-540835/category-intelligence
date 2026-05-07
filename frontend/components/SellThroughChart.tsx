"use client";

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
const LAST_INDEX = SELL_THROUGH_DATA.length - 1;

export type SellThroughRow = (typeof SELL_THROUGH_DATA)[number];

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

const legendFormatter = (value: string, entry: any) => (
  <span style={{ color: entry?.color, marginRight: 12, fontSize: 11 }}>● {value}</span>
);

// ── Pulsing end-dot factory ─────────────────────────────────────────────────
// Renders a CSS-animated SVG circle ONLY at the last data point. The class
// `pulse-ring-N` is keyed so each brand staggers its phase by N * 200ms.
function makePulseDot(color: string, classSuffix: string) {
  return (props: any) => {
    const { cx, cy, index } = props;
    if (index !== LAST_INDEX) return null;
    return (
      <g>
        {/* Outer halo: scales 1 → 1.8, fades */}
        <circle cx={cx} cy={cy} r={5} fill={color} className={`pulse-ring ${classSuffix}`} />
        {/* Solid inner dot */}
        <circle cx={cx} cy={cy} r={4} fill={color} stroke="#fff" strokeWidth={1.2} />
      </g>
    );
  };
}

interface Props {
  /** When this prop changes the chart re-mounts and re-animates. */
  flowKey?: string | number;
  /** Fires when a user clicks anywhere on the chart at a data X. */
  onWeekClick?: (week: string) => void;
}

export default function SellThroughChart({ flowKey, onWeekClick }: Props) {
  const handleChartClick = (state: any) => {
    const week = state?.activeLabel;
    if (typeof week === "string" && week) onWeekClick?.(week);
  };
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
        {/* `key={flowKey}` forces a re-mount → recharts replays the line-draw
            animation every time the parent's active flow changes. */}
        <ComposedChart
          key={flowKey}
          data={SELL_THROUGH_DATA}
          margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
          onClick={handleChartClick}
          style={{ cursor: onWeekClick ? "pointer" : undefined }}
        >
          <defs>
            <linearGradient id="samsung-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.30} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="sony-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.30} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="lg-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.30} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="#1e2532" strokeDasharray="3 3" vertical horizontal />
          <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#64748b" }} stroke="#475569" />
          <YAxis tick={{ fontSize: 10, fill: "#64748b" }} stroke="#475569" />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: "#3b82f6", strokeWidth: 1, strokeDasharray: "4 4" }}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={legendFormatter} />

          <ReferenceLine
            y={400}
            stroke="#475569"
            strokeDasharray="3 3"
            label={{ value: "Plan", fill: "#475569", fontSize: 10, position: "right" }}
          />

          <Area
            type="monotone"
            dataKey="Samsung"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#samsung-gradient)"
            fillOpacity={1}
            dot={makePulseDot("#3b82f6", "pulse-samsung")}
            activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }}
            isAnimationActive
            animationDuration={1400}
            animationEasing="ease-out"
          />
          <Area
            type="monotone"
            dataKey="Sony"
            stroke="#f59e0b"
            strokeWidth={2}
            fill="url(#sony-gradient)"
            fillOpacity={1}
            dot={makePulseDot("#f59e0b", "pulse-sony")}
            activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }}
            isAnimationActive
            animationDuration={1400}
            animationEasing="ease-out"
          />
          <Area
            type="monotone"
            dataKey="LG"
            stroke="#ef4444"
            strokeWidth={2}
            fill="url(#lg-gradient)"
            fillOpacity={1}
            dot={makePulseDot("#ef4444", "pulse-lg")}
            activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff" }}
            isAnimationActive
            animationDuration={1400}
            animationEasing="ease-out"
          />

          {/* Forecast stays a thin dashed line — no fill, no pulse */}
          <Line
            type="monotone"
            dataKey="Forecast"
            stroke="#475569"
            strokeWidth={1}
            strokeDasharray="4 4"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
            isAnimationActive
            animationDuration={1400}
            animationEasing="ease-out"
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Pulse keyframes for the end-dots. The class is applied to SVG <circle>
          which supports CSS `transform: scale()` with `transform-origin`. The
          `transform-box: fill-box` wraps scaling around the circle's centre. */}
      <style>{`
        .pulse-ring {
          transform-box: fill-box;
          transform-origin: center;
          animation: pulse-ring 1.6s ease-in-out infinite;
        }
        .pulse-samsung { animation-delay: 0ms;   }
        .pulse-sony    { animation-delay: 200ms; }
        .pulse-lg      { animation-delay: 400ms; }
        @keyframes pulse-ring {
          0%   { transform: scale(1);   opacity: 0.85; }
          50%  { transform: scale(1.8); opacity: 0.20; }
          100% { transform: scale(1);   opacity: 0.85; }
        }
      `}</style>
    </div>
  );
}

