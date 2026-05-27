'use client';

import React from 'react';

interface Alert {
  priority: 'P1' | 'P2';
  sku: string;
  msg: string;
}

interface Props {
  alerts: Alert[];
}

export default function AlertTicker({ alerts }: Props) {
  if (alerts.length === 0) {
    return null;
  }
  const uniqueAlerts = Array.from(new Map(alerts.map((a) => [`${a.priority}|${a.sku}|${a.msg}`, a])).values());

  return (
    <div className="bg-red-700 text-white text-[11px] py-1 px-4 overflow-hidden relative h-7 flex items-center">
      <div className="ticker-track flex items-center whitespace-nowrap animate-ticker hover:animation-pause" style={{ animationDuration: `120s` }}>
        {uniqueAlerts.map((alert, index) => (
          <span key={index} className="inline-flex items-center mx-4">
            <span className="font-semibold">{alert.sku}</span> <span className="text-red-200">— {alert.msg}</span>
            <span className="mx-3 text-red-300">•</span>
          </span>
        ))}
      </div>
      <style jsx>{`
        @keyframes ticker {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-50%); }
        }
        .animate-ticker {
          animation: ticker linear infinite;
        }
        .ticker-track {
          width: max-content;
          min-width: 200%;
        }
        .hover\\:animation-pause:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}
