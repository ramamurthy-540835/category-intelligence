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

  return (
    <div className="bg-red-700 text-white text-[11px] py-1 px-4 overflow-hidden relative h-7 flex items-center">
      <div className="absolute whitespace-nowrap overflow-hidden animate-ticker hover:animation-pause" style={{ animationDuration: `120s` }}>
        {alerts.map((alert, index) => (
          <span key={index} className="inline-block mx-4">
            <span className="font-semibold">{alert.sku}</span> <span className="text-red-200">— {alert.msg}</span>
          </span>
        ))}
        {/* Duplicate alerts to ensure seamless looping */}
        {alerts.map((alert, index) => (
          <span key={index + alerts.length} className="inline-block mx-4">
            <span className="font-semibold">{alert.sku}</span> <span className="text-red-200">— {alert.msg}</span>
          </span>
        ))}
      </div>
      <style jsx>{`
        @keyframes ticker {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
        .animate-ticker {
          animation: ticker linear infinite;
        }
        .hover\\:animation-pause:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}
