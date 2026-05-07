import React from 'react';

interface Props {
  label: string;
  value: string | number;
  metric: string;
  delta?: string;
  trend?: 'up' | 'down' | 'flat';
  status?: 'good' | 'warning' | 'critical';
  updatedAt?: string;
}

export default function KPICard({ label, value, metric, delta, trend, status, updatedAt }: Props) {
  const borderClass = status === 'critical' ? 'border-red-500' : status === 'warning' ? 'border-yellow-500' : status === 'good' ? 'border-green-500' : 'border-gray-200';
  
  const renderTrend = () => {
    if (trend === 'up') return <span className="text-green-500">▲</span>;
    if (trend === 'down') return <span className="text-red-500">▼</span>;
    if (trend === 'flat') return <span className="text-gray-500">—</span>;
    return null;
  };

  return (
    <div className={`p-2 border rounded shadow-sm ${borderClass}`}>
      <div className="text-2xs text-gray-400">{label}</div>
      <div className="text-lg font-bold my-0.25">{value}</div>
      <div className="text-3xs text-gray-500">{metric}</div>
      
      {(delta || trend) && (
        <div className="mt-1 text-2xs flex items-center gap-0.5">
          {renderTrend()} {delta}
        </div>
      )}
      
      {updatedAt && <div className="mt-1 text-3xs text-gray-400 text-right">Updated: {updatedAt}</div>}
    </div>
  );
}

