import React from 'react';
import { Status, AgentStep } from '../../lib/sse/useSSE';

interface Props {
  status?: Status;
  steps?: {step: AgentStep, content: string}[];
  error?: string | null;
}

export default function AgentControlCenter({ status = 'idle', steps = [], error }: Props) {
  const PHASES = ['Think', 'Act', 'Analyze', 'Respond'];
  const latestStep = steps.length > 0 ? steps[steps.length - 1].content : '';

  const getBadge = () => {
    if (status === 'error') return 'Error';
    if (status === 'done') return 'Done';
    if (status === 'idle') return 'Idle';
    return 'Streaming';
  };

  return (
    <div className="border p-4 rounded bg-gray-50">
      <div className="flex justify-between mb-4">
        <h3 className="font-bold">Agent Control Center</h3>
        <span className="px-2 py-1 bg-gray-200 rounded text-sm">{getBadge()}</span>
      </div>
      
      <div className="flex gap-2 mb-4">
        {PHASES.map(phase => (
          <div key={phase} className="px-3 py-1 border rounded text-sm bg-white">
            {phase}
          </div>
        ))}
      </div>

      {latestStep && <div className="text-sm text-gray-600 italic">{latestStep}</div>}
      {error && <div className="mt-2 text-red-500 text-sm bg-red-50 p-2 rounded">{error}</div>}
    </div>
  );
}
