import { useState, useCallback } from 'react';

export type AgentStep = 'think' | 'act' | 'analyze' | 'respond' | 'respond_chunk' | 'done' | 'error';
export type Status = 'idle' | 'think' | 'act' | 'analyze' | 'respond' | 'done' | 'error';

export function useAgentStream() {
  const [steps, setSteps] = useState<{step: AgentStep, content: string}[]>([]);
  const [finalResponse, setFinalResponse] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (message: string, sessionId: string) => {
    setIsStreaming(true);
    setStatus('think');
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
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          let event;
          try {
            event = JSON.parse(data);
          } catch (_e) {
            continue; // skip malformed chunk
          }
          if (!event) continue;

          setSteps(prev => [...prev, event]);
          if (event.step === 'respond_chunk') {
            setFinalResponse(prev => prev + event.content);
            setStatus('respond');
          } else if (event.step === 'done') {
            setStatus('done');
          } else if (event.step === 'error') {
            setStatus('error');
            setError(event.content);
          } else {
            setStatus(event.step === 'think' ? 'think' : event.step === 'act' ? 'act' : 'analyze');
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

