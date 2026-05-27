"use client";
import { useState, useEffect } from "react";
import { useAgentStream, AgentStep, Status } from "@/lib/sse/useSSE";
import ReactMarkdown from 'react-markdown';

const DEMO_FLOWS = [
  {label: 'Category Overview', q: 'Give me a full category overview from Q4 2024 through Q1 2026 across Home Appliance, Mobile, and Accessories'},
  {label: 'LG C3 Diagnosis', q: 'Why is LG C3 OLED underperforming?'},
  {label: 'Price vs Amazon', q: 'Show Samsung QN85C price gap vs Amazon'},
  {label: 'Gen Z Trends', q: 'What is the Gen Z interest in Home Appliance, Mobile, and Accessories SKUs?'},
  {label: 'Co-op Risk', q: 'Which vendor co-op budgets are at expiry risk?'},
  {label: 'Spring Assortment', q: 'Which SKUs should we cut in spring assortment?'},
];

export function ChatInterface() {
  const [message, setMessage] = useState("");
  const { steps, finalResponse, isStreaming, status, error, sendMessage: streamSendMessage } = useAgentStream();

  const handleSendMessage = async (msgToSend: string = message) => {
    if (!msgToSend.trim() || isStreaming) return;

    const sessionId = `session-${Date.now()}`;

    await streamSendMessage(msgToSend, sessionId);

    setMessage("");
  };

  const handleDemoFlowClick = (flowQ: string) => {
    setMessage(flowQ); // Set the message in the input field
    handleSendMessage(flowQ); // Immediately send the message
  };

  // Allow the far-left DemoFlowsSidebar (or any other sender) to inject a
  // chat prompt by dispatching `cat-flow-prompt` on window with detail = text.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "string" && detail.trim()) {
        handleDemoFlowClick(detail);
      }
    };
    window.addEventListener("cat-flow-prompt", onPrompt);
    return () => window.removeEventListener("cat-flow-prompt", onPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  const markdownComponents = {
    h1: ({node, ...props}) => <h1 className="text-yellow-400 font-bold text-xl mb-1.5" {...props} />,
    h2: ({node, ...props}) => <h2 className="text-yellow-400 font-bold text-lg mb-1.5" {...props} />,
    h3: ({node, ...props}) => <h3 className="text-yellow-400 font-bold text-base mb-1.5" {...props} />,
    strong: ({node, ...props}) => <strong className="text-white" {...props} />,
    ul: ({node, ...props}) => <ul className="list-disc list-inside text-gray-200 space-y-0.5 mb-1" {...props} />,
    li: ({node, ...props}) => <li className="text-gray-200" {...props} />,
    p: ({node, ...props}) => <p className="mb-1" {...props} />, // Add margin to paragraphs for spacing
  };

  return (
    <div className="flex flex-col flex-1 p-4 gap-3 w-full">
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-2">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[12px] font-semibold text-white">Agent Ops Flow</h4>
          <span className="text-[11px] text-slate-300">{status.toUpperCase()}</span>
        </div>
        <div className="grid grid-cols-4 gap-1 text-[11px]">
          {["think", "act", "analyze", "respond"].map((phase) => {
            const active = status.startsWith(phase) || (phase === "think" && status === "think") || (phase === "act" && status === "act") || (phase === "analyze" && status === "analyze") || (phase === "respond" && status === "respond");
            return (
              <div key={phase} className={`rounded px-2 py-1 text-center border ${active ? "bg-blue-900 border-blue-500 text-white" : "bg-slate-800 border-slate-700 text-slate-400"}`}>
                {phase}
              </div>
            );
          })}
        </div>
        <div className="mt-2 max-h-16 overflow-y-auto text-[11px] text-slate-300">
          {steps.length === 0 ? "No active agent events." : steps.slice(-6).map((s, i) => <div key={i}>[{s.step}] {s.content}</div>)}
        </div>
      </div>
      {/* Demo Flows */}
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {DEMO_FLOWS.map((flow, index) => (
          <button
            key={index}
            className="px-2.5 py-1 rounded-full bg-blue-900 text-white text-2xs hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handleDemoFlowClick(flow.q)}
            disabled={isStreaming}
          >
            {flow.label}
          </button>
        ))}
      </div>

      {/* Response */}
      {finalResponse && (
        <div className="bg-gray-900 text-white rounded-xl p-4 shadow-lg border-l-4 border-blue-500">
          <ReactMarkdown components={markdownComponents}>{finalResponse}</ReactMarkdown>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900 border border-red-500 rounded p-2 text-red-200 text-xs">
          {error}
        </div>
      )}

      {/* Streaming indicator */}
      {isStreaming && (
        <div className="text-blue-400 text-xs animate-pulse">
          Agent is thinking...
        </div>
      )}

      {/* Input */}
      <div className="flex gap-1.5 mt-auto">
        <input
          className="flex-1 bg-gray-800 rounded px-3 py-1.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Ask anything about Home Appliance, Mobile, and Accessories..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
          disabled={isStreaming}
        />
        <button
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-4 py-1.5 rounded text-white font-medium transition-colors"
          onClick={() => handleSendMessage()}
          disabled={isStreaming || !message.trim()}
        >
          {isStreaming ? "..." : "Ask"}
        </button>
      </div>
    </div>
  );
}
