import React from 'react';
import { Status, AgentStep } from '../../lib/sse/useSSE';

interface Alert {
  priority: 'P1' | 'P2';
  sku: string;
  msg: string;
}

interface Props {
  status?: Status;
  steps?: {step: AgentStep, content: string}[];
  error?: string | null;
  alerts?: Alert[];
}

export default function AgentControlCenter({ status = 'idle', steps = [], error, alerts = [] }: Props) {
  const PHASES = ['Think', 'Act', 'Analyze', 'Respond'];
  const latestStepContent = steps.length > 0 ? steps[steps.length - 1].content : '';
  const latestStepType = steps.length > 0 ? steps[steps.length - 1].step : '';

  const getBadgeText = () => {
    if (status === 'error') return 'Error';
    if (status === 'done') return 'Done';
    if (status === 'idle') return 'Idle';
    return 'Streaming';
  };

  const getBadgeClasses = () => {
    if (status === 'error') return 'bg-red-600 text-white';
    if (status === 'done') return 'bg-green-600 text-white';
    if (status === 'idle') return 'bg-gray-700 text-gray-300';
    return 'bg-blue-600 text-white animate-pulse';
  };

  const getPhaseCardClasses = (phase: string) => {
    const phaseLower = phase.toLowerCase();
    const currentPhaseIndex = PHASES.findIndex(p => p.toLowerCase() === latestStepType);
    const thisPhaseIndex = PHASES.indexOf(phase);

    if (status === 'done' || status === 'error') {
      // If done or error, all phases up to the last executed step are "completed"
      if (thisPhaseIndex <= currentPhaseIndex || (status === 'done' && thisPhaseIndex < PHASES.length)) {
        return 'bg-gray-800 border border-green-600 text-gray-200';
      }
    }

    if (latestStepType === phaseLower) {
      return 'bg-blue-900 border border-blue-500 text-white'; // Active
    } else if (thisPhaseIndex < currentPhaseIndex) {
      return 'bg-gray-800 border border-green-600 text-gray-200'; // Completed
    }
    return 'bg-gray-800 border border-gray-600 text-gray-500'; // Idle
  };

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-1.5 flex flex-col h-full text-white text-xs">
      <div className="flex justify-between items-center mb-1.5">
        <h3 className="font-semibold text-xs">Agent Control Center</h3>
        <span className={`px-1.5 py-0.5 text-2xs rounded ${getBadgeClasses()}`}>{getBadgeText()}</span>
      </div>
      
      <div className="flex gap-1 mb-1.5 flex-wrap">
        {PHASES.map(phase => (
          <div key={phase} className={`px-1 py-0.5 text-3xs rounded ${getPhaseCardClasses(phase)}`}>
            {phase}
          </div>
        ))}
      </div>

      {latestStepContent && (
        <div className="text-gray-400 italic mb-1.5 overflow-hidden text-ellipsis whitespace-nowrap">
          {latestStepContent}
        </div>
      )}
      {error && <div className="mt-1 text-red-300 bg-red-900 p-1 rounded mb-1.5 overflow-wrap break-words">{error}</div>}

      {/* Live Alerts Section */}
      <div className="mt-auto pt-1.5 border-t border-gray-700">
        <h4 className="font-semibold mb-1 text-gray-200">Live Alerts</h4>
        {alerts.length === 0 ? (
          <div className="text-gray-500 text-2xs">No active alerts.</div>
        ) : (
          <div className="space-y-0.5">
            {alerts.slice(0, 4).map((alert, index) => ( // Show max 4 alerts
              <div key={index} className="flex items-start gap-0.5 bg-gray-800 rounded p-0.5">
                <span className={`px-0.5 py-0.25 rounded text-white font-semibold text-3xs ${alert.priority === 'P1' ? 'bg-red-600' : 'bg-yellow-600'}`}>
                  {alert.priority}
                </span>
                <div className="flex-1 text-gray-300 overflow-hidden text-3xs">
                  <span className="font-semibold">{alert.sku}</span>: <span className="text-gray-400 overflow-wrap break-words">{alert.msg}</span>
                </div>
              </div>
            ))}
            {alerts.length > 4 && (
              <div className="text-gray-500 text-3xs mt-0.5 text-center">
                +{alerts.length - 4} more alerts
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
