"use client";

import React from "react";
import AgentResponse from "@/components/AgentResponse";

interface AgentFlyoutProps {
  isOpen: boolean;
  onClose: () => void;
  agentContent: string;
  status: "thinking" | "executing" | "done" | "error";
  prompt?: string;
}

export default function AgentFlyout({
  isOpen,
  onClose,
  agentContent,
  status,
  prompt,
}: AgentFlyoutProps) {
  if (!isOpen) return null;

  const statusColors = {
    thinking: { bg: "#78350f", text: "#f59e0b", dot: "#f59e0b" },
    executing: { bg: "#78350f", text: "#f59e0b", dot: "#f59e0b" },
    done: { bg: "#166534", text: "#22c55e", dot: "#22c55e" },
    error: { bg: "#7f1d1d", text: "#fca5a5", dot: "#ef4444" },
  };

  const statusConfig = statusColors[status];

  return (
    <>
      {/* Overlay backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-out panel from right */}
      <div
        className="fixed inset-y-0 right-0 w-[480px] bg-slate-950 border-l border-slate-800 shadow-2xl flex flex-col z-50 transform transition-transform duration-300 ease-in-out"
        style={{
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-white">AI Diagnostic Report</h2>
            <p className="text-sm text-slate-400 mt-0.5">Deep-dive analysis and insights</p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 text-slate-400 hover:text-slate-200 transition-colors text-xl font-bold"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Status badge */}
        <div className="px-6 py-3 border-b border-slate-800 flex-shrink-0">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium"
            style={{ background: statusConfig.bg, color: statusConfig.text }}
          >
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: statusConfig.dot }}
            />
            {status === "thinking" && "Thinking…"}
            {status === "executing" && "Executing…"}
            {status === "done" && "Complete"}
            {status === "error" && "Error"}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Active Prompt */}
          {prompt && (
            <div className="mb-6">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
                Your Question
              </h3>
              <div className="border-l-2 border-blue-500 pl-3 py-2 bg-slate-900/50 rounded-r px-3">
                <p className="text-sm text-slate-200 italic">&quot;{prompt}&quot;</p>
              </div>
            </div>
          )}

          {/* Diagnostic Content */}
          <div className="mb-6">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">
              Analysis Results
            </h3>
            <div className="space-y-2">
              {agentContent ? (
                <AgentResponse content={agentContent} />
              ) : (
                <div className="text-slate-400 italic text-sm">No diagnostic data yet.</div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="border-t border-slate-800 pt-4 mt-6">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">
              Actions
            </h3>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 px-3 py-2 rounded-md bg-slate-800 text-slate-200 text-sm hover:bg-slate-700 transition-colors border border-slate-700"
              >
                Close
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(agentContent);
                  // Could add a toast notification here
                }}
                className="flex-1 px-3 py-2 rounded-md bg-slate-700 text-slate-200 text-sm hover:bg-slate-600 transition-colors border border-slate-600"
              >
                Copy Text
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
