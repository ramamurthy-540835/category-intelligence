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
  
  // Determine the latest relevant step for phase highlighting
  const lastRelevantStep = steps.slice().reverse().find(s => PHASES.map(p => p.toLowerCase()).includes(s.step));
  const latestStepContent = lastRelevantStep ? lastRelevantStep.content : '';
  const latestStepType = lastRelevantStep ? lastRelevantStep.step : '';

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
    const thisPhaseIndex = PHASES.indexOf(phase);
    const currentPhaseIndex = PHASES.indexOf(phase.charAt(0).toUpperCase() + phase.slice(1)); // Match case

    if (status === 'error') {
      // If error, highlight the phase that errored, or show all as completed if error is generic
      if (latestStepType === phaseLower) {
        return 'bg-red-900/40 border border-red-500 text-red-200';
      } else if (thisPhaseIndex < currentPhaseIndex) {
         return 'bg-emerald-900/30 border border-emerald-500 text-emerald-200'; // Completed before error
      }
      return 'bg-gray-800 border border-gray-600 text-gray-400'; // Not reached
    }

    if (status === 'done') {
      // If done, all phases are considered completed
      return 'bg-emerald-900/30 border border-emerald-500 text-emerald-200';
    }

    // For streaming status
    if (latestStepType === phaseLower) {
      return 'bg-blue-900 border border-blue-400 text-white shadow-[0_0_0_1px_rgba(59,130,246,0.35)]'; // Active
    } else if (thisPhaseIndex < currentPhaseIndex) {
      return 'bg-emerald-900/20 border border-emerald-600 text-emerald-200'; // Completed
    }
    return 'bg-gray-800 border border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors'; // Idle
  };

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-2.5 flex flex-col h-full text-white text-[12px]">
      <div className="flex justify-between items-center mb-1.5">
        <h3 className="font-semibold text-[12px]">Agent Control Center</h3>
        <span className={`px-1.5 py-0.5 text-2xs rounded ${getBadgeClasses()}`}>{getBadgeText()}</span>
      </div>
      
      <div className="flex gap-1 mb-1.5 flex-wrap">
        {PHASES.map(phase => (
          <div key={phase} title={`${phase} phase`} className={`px-1.5 py-0.5 text-[11px] rounded cursor-help ${getPhaseCardClasses(phase)}`}>
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
          <div className="space-y-0.5 max-h-56 overflow-y-auto pr-1">
            {alerts.map((alert, index) => (
              <div key={index} className="flex items-start gap-1 bg-gray-800 rounded p-1">
                <span className={`px-1 py-0.5 rounded text-white font-semibold text-[10px] ${alert.priority === 'P1' ? 'bg-red-600' : 'bg-yellow-600'}`}>
                  {alert.priority}
                </span>
                <div className="flex-1 text-gray-300 overflow-hidden text-[11px] leading-4">
                  <span className="font-semibold">{alert.sku}</span>: <span className="text-gray-400 overflow-wrap break-words">{alert.msg}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
