import { useState, useCallback } from 'react';

export type AgentStep = 'think' | 'act' | 'analyze' | 'respond' | 'respond_chunk' | 'done' | 'error';
export type Status = 'idle' | 'thinking' | 'acting' | 'analyzing' | 'responding' | 'done' | 'error';

export function useAgentStream() {
  const [steps, setSteps] = useState<{step: AgentStep, content: string}[]>([]);
  const [finalResponse, setFinalResponse] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (message: string, sessionId: string) => {
    setIsStreaming(true);
    setStatus('thinking');
    setError(null);
    setSteps([]);
    setFinalResponse('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, session_id: sessionId })
      });

      if (!res.ok) throw new Error('Network response was not ok');
      if (!res.body) throw new Error('No body in response');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            if (!raw || raw === '[DONE]') continue;
            let data: any;
            try {
              data = JSON.parse(raw);
            } catch (_e) {
              continue;
            }
            setSteps(prev => [...prev, data]);
            if (data.step === 'respond_chunk') {
              setFinalResponse(prev => prev + data.content);
              setStatus('responding');
            } else if (data.step === 'done') {
              setStatus('done');
            } else if (data.step === 'error') {
              setStatus('error');
              setError(data.content);
            } else {
              setStatus(data.step === 'think' ? 'thinking' : data.step === 'act' ? 'acting' : 'analyzing');
            }
          }
        }
      }
    } catch (err: any) {
      setError(err.message);
      setStatus('error');
    } finally {
      setIsStreaming(false);
    }
  }, []);

  return { steps, finalResponse, isStreaming, status, error, sendMessage };
}
