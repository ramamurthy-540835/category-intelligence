import React from 'react';

interface Props {
  skuId?: string;
  affinityScore?: number;
  scoreDrivers?: string[];
  trendingTerms?: string[];
  discoveryChannelMix?: Record<string, number>;
  recommendation?: string;
}

export default function GenZAffinityPanel({
  skuId,
  affinityScore,
  scoreDrivers,
  trendingTerms,
  discoveryChannelMix,
  recommendation
}: Props) {
  return (
    <div className="p-3 border rounded bg-white text-sm">
      <h3 className="font-semibold text-lg mb-2">Gen Z Affinity {skuId ? `- ${skuId}` : ''}</h3>
      
      <div className="text-2xl font-bold text-indigo-600 mb-3">
        {affinityScore !== undefined ? affinityScore : '--'}
      </div>

      {scoreDrivers && scoreDrivers.length > 0 && (
        <div className="mb-3">
          <h4 className="text-xs font-semibold text-gray-500">Score Drivers</h4>
          <ul className="list-disc pl-4 text-xs space-y-0.5">
            {scoreDrivers.map((driver, i) => <li key={i}>{driver}</li>)}
          </ul>
        </div>
      )}

      {trendingTerms && trendingTerms.length > 0 && (
        <div className="mb-3">
          <h4 className="text-xs font-semibold text-gray-500">Trending Terms</h4>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {trendingTerms.map((term, i) => (
              <span key={i} className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">{term}</span>
            ))}
          </div>
        </div>
      )}

      {discoveryChannelMix && Object.keys(discoveryChannelMix).length > 0 && (
        <div className="mb-3">
          <h4 className="text-xs font-semibold text-gray-500">Channel Mix</h4>
          <div className="text-xs mt-0.5 space-y-0.5">
            {Object.entries(discoveryChannelMix).map(([channel, pct]) => (
              <div key={channel} className="flex justify-between">
                <span>{channel}</span>
                <span>{pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recommendation && (
        <div className="mt-3 p-2 bg-indigo-50 text-indigo-900 text-xs rounded">
          <strong>Recommendation:</strong> {recommendation}
        </div>
      )}
    </div>
  );
}

