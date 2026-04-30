'use client';

import React, { useState, useEffect } from 'react';

interface Alert {
  priority: 'P1' | 'P2';
  sku: string;
  msg: string;
}

interface Props {
  alerts: Alert[];
}

export default function AlertTicker({ alerts }: Props) {
  const [currentAlertIndex, setCurrentAlertIndex] = useState(0);

  useEffect(() => {
    if (alerts.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentAlertIndex((prevIndex) => (prevIndex + 1) % alerts.length);
    }, 6000); // Change alert every 6 seconds

    return () => clearInterval(interval);
  }, [alerts]);

  if (alerts.length === 0) {
    return null;
  }

  const currentAlert = alerts[currentAlertIndex];

  return (
    <div className="bg-red-700 text-white text-xs py-0.5 px-4 overflow-hidden relative h-6 flex items-center">
      <div className="absolute whitespace-nowrap animate-ticker hover:animation-pause" style={{ animationDuration: `${alerts.length * 6}s` }}>
        {alerts.map((alert, index) => (
          <span key={index} className="inline-block mx-3">
            <span className="font-semibold">{alert.sku}</span> <span className="text-red-200">— {alert.msg}</span>
          </span>
        ))}
        {/* Duplicate alerts to ensure seamless looping */}
        {alerts.map((alert, index) => (
          <span key={index + alerts.length} className="inline-block mx-3">
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
