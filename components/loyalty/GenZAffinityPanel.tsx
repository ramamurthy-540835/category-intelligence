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
    <div className="p-4 border rounded bg-white">
      <h3 className="font-bold mb-2">Gen Z Affinity {skuId ? `- ${skuId}` : ''}</h3>
      
      <div className="text-3xl font-bold text-indigo-600 mb-4">
        {affinityScore !== undefined ? affinityScore : '--'}
      </div>

      {scoreDrivers && scoreDrivers.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-gray-600">Score Drivers</h4>
          <ul className="list-disc pl-5 text-sm">
            {scoreDrivers.map((driver, i) => <li key={i}>{driver}</li>)}
          </ul>
        </div>
      )}

      {trendingTerms && trendingTerms.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-gray-600">Trending Terms</h4>
          <div className="flex flex-wrap gap-2 mt-1">
            {trendingTerms.map((term, i) => (
              <span key={i} className="px-2 py-1 bg-gray-100 rounded text-xs">{term}</span>
            ))}
          </div>
        </div>
      )}

      {discoveryChannelMix && Object.keys(discoveryChannelMix).length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-gray-600">Channel Mix</h4>
          <div className="text-sm mt-1">
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
        <div className="mt-4 p-3 bg-indigo-50 text-indigo-900 text-sm rounded">
          <strong>Recommendation:</strong> {recommendation}
        </div>
      )}
    </div>
  );
}
