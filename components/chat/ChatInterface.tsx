"use client";
import { useState } from "react";
import { useAgentStream, AgentStep, Status } from "@/lib/sse/useSSE";
import ReactMarkdown from 'react-markdown';

const DEMO_FLOWS = [
  {label: 'Category Overview', q: 'Give me a full Q4 category overview for Home Theater'},
  {label: 'LG C3 Diagnosis', q: 'Why is LG C3 OLED underperforming?'},
  {label: 'Price vs Amazon', q: 'Show Samsung QN85C price gap vs Amazon'},
  {label: 'Gen Z Trends', q: 'What is the Gen Z interest in Home Theater SKUs?'},
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

  const markdownComponents = {
    h1: ({node, ...props}) => <h1 className="text-yellow-400 font-bold text-2xl mb-2" {...props} />,
    h2: ({node, ...props}) => <h2 className="text-yellow-400 font-bold text-xl mb-2" {...props} />,
    h3: ({node, ...props}) => <h3 className="text-yellow-400 font-bold text-lg mb-2" {...props} />,
    strong: ({node, ...props}) => <strong className="text-white" {...props} />,
    ul: ({node, ...props}) => <ul className="list-disc list-inside text-gray-200 space-y-1 mb-2" {...props} />,
    li: ({node, ...props}) => <li className="text-gray-200" {...props} />,
    p: ({node, ...props}) => <p className="mb-2" {...props} />, // Add margin to paragraphs for spacing
  };

  return (
    <div className="flex flex-col flex-1 p-6 gap-4 w-full">
      {/* Demo Flows */}
      <div className="flex flex-wrap gap-2 mb-2">
        {DEMO_FLOWS.map((flow, index) => (
          <button
            key={index}
            className="px-3 py-1.5 rounded-full bg-blue-900 text-white text-xs hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handleDemoFlowClick(flow.q)}
            disabled={isStreaming}
          >
            {flow.label}
          </button>
        ))}
      </div>

      {/* Response */}
      {finalResponse && (
        <div className="bg-gray-900 text-white rounded-xl p-6 shadow-lg border-l-4 border-blue-500">
          <ReactMarkdown components={markdownComponents}>{finalResponse}</ReactMarkdown>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900 border border-red-500 rounded p-3 text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Streaming indicator */}
      {isStreaming && (
        <div className="text-blue-400 text-sm animate-pulse">
          Agent is thinking...
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 mt-auto">
        <input
          className="flex-1 bg-gray-800 rounded px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Ask anything about Home Theater category..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
          disabled={isStreaming}
        />
        <button
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-6 py-2 rounded text-white font-medium transition-colors"
          onClick={() => handleSendMessage()}
          disabled={isStreaming || !message.trim()}
        >
          {isStreaming ? "..." : "Ask"}
        </button>
      </div>
    </div>
  );
}
