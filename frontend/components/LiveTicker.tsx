"use client";

// Top-of-app ticker. Background is dark navy (NOT red); only the LIVE pill is red.
// Each alert is preceded by a red bullet dot, separated by spaces.

interface Alert { priority: string; sku: string; msg: string; }

export default function LiveTicker({ alerts }: { alerts: Alert[] }) {
  if (!alerts || alerts.length === 0) return null;
  const items = alerts.slice(0, 30);

  // Build the inline content twice so the marquee loops seamlessly.
  const renderRun = (keyPrefix: string) =>
    items.map((a, i) => (
      <span key={`${keyPrefix}-${i}`} className="inline-flex items-center mr-8">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--bby-ticker-dot-red)] mr-2" />
        <span className="text-[var(--bby-ticker-text)]">
          <strong className="text-white">{a.sku}</strong>
          <span className="text-slate-400"> — {a.msg}</span>
        </span>
      </span>
    ));

  return (
    <div className="w-full h-7 flex items-center bg-[var(--bby-ticker-bg)] border-b border-[var(--bby-border-subtle)]">
      <span
        className="text-white text-[10px] font-bold tracking-widest px-3 py-0.5 mx-3 rounded-sm flex-shrink-0"
        style={{ background: "var(--bby-live-badge-bg)" }}
      >
        LIVE
      </span>
      <div className="overflow-hidden flex-1">
        <div className="whitespace-nowrap text-[11px] animate-marquee">
          {renderRun("a")}
          {renderRun("b")}
        </div>
      </div>
    </div>
  );
}

