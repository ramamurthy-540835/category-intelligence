import React, { useState } from 'react';
import { useAgentStream } from '../../lib/sse/useSSE';
import { createSessionId } from '../../lib/utils/session';
import AgentControlCenter from './AgentControlCenter';

export default function ChatInterface() {
  const { steps, finalResponse, isStreaming, status, error, sendMessage } = useAgentStream();
  const [input, setInput] = useState('');
  const [sessionId] = useState(createSessionId());

  const handleSend = () => {
    if (input.trim() === '' || isStreaming) return;
    sendMessage(input, sessionId);
    setInput('');
  };

  const statusLabel = status === 'idle' ? 'Ready' : isStreaming ? 'Streaming' : status === 'done' ? 'Done' : 'Error';

  return (
    <div className="flex flex-col h-full p-4">
      <div className="mb-4">Status: {statusLabel}</div>
      <AgentControlCenter status={status} steps={steps} error={error} />
      
      <div className="flex-1 overflow-y-auto my-4 p-4 border rounded">
        {error && <div className="text-red-500 mb-4">Error: {error}</div>}
        <div className="whitespace-pre-wrap">{finalResponse}</div>
      </div>

      <div className="flex gap-2">
        <input 
          type="text" 
          value={input} 
          onChange={e => setInput(e.target.value)}
          className="flex-1 border p-2 rounded"
          disabled={isStreaming}
        />
        <button 
          onClick={handleSend} 
          disabled={isStreaming || input.trim() === ''}
          className="bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          Ask
        </button>
      </div>
    </div>
  );
}
