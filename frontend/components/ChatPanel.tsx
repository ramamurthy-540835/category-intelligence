"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import AgentResponse from "@/components/AgentResponse";
import AgentFlyout from "@/components/AgentFlyout";
import { useAgentStream } from "@/lib/sse/useSSE";

// ──────────────────────────────────────────────────────────────────────────────
// ChatPanel — Azure-spec center chat surface for the Category Intelligence UI.
// Reuses the existing `useAgentStream` SSE hook so streaming logic isn't
// duplicated. Listens for `cat-flow-prompt` window events so the left sidebar
// can drop prompts into the chat without prop drilling.
// ──────────────────────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "agent";
  content: string;
  timestamp: number;
}

const SUGGESTED_PROMPTS = [
  "Why is LG C3 underperforming?",
  "Show Samsung price vs Amazon",
  "Compare Q4 promo ROAS (Return on Ad Spend)",
  "Which SKUs to cut in spring?",
];

const SESSION_ID =
  typeof globalThis !== "undefined" && (globalThis as any).crypto?.randomUUID
    ? (globalThis as any).crypto.randomUUID()
    : `session-${Date.now()}`;

export default function ChatPanel() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isFlyoutOpen, setIsFlyoutOpen] = useState(false);
  const [flyoutPrompt, setFlyoutPrompt] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    steps,
    finalResponse,
    isStreaming,
    status,
    error,
    sendMessage: streamSendMessage,
  } = useAgentStream();

  // When a stream finishes, snapshot finalResponse into the message list so it
  // persists across subsequent turns.
  const lastCapturedRef = useRef<string>("");
  useEffect(() => {
    if (!isStreaming && finalResponse && finalResponse !== lastCapturedRef.current) {
      lastCapturedRef.current = finalResponse;
      setMessages((prev) => [...prev, { role: "agent", content: finalResponse, timestamp: Date.now() }]);
    }
  }, [isStreaming, finalResponse]);

  // Publish chat status/steps so the Agent Control Center's Strategy Loop
  // can mirror Think → Act → Analyze → Respond in real time. ACC listens
  // for this same `cat-chat-status` event.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("cat-chat-status", { detail: { status, steps } }),
    );
  }, [status, steps]);

  // Scroll to bottom on every new step / message.
  useEffect(() => {
    // Use "auto" not "smooth" so streaming tokens don't queue up an animation per chunk.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" });
  }, [messages, steps, finalResponse]);

  // Allow the sidebar (or anything else) to inject a prompt via window event.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "string" && detail.trim()) submit(detail);
    };
    window.addEventListener("cat-flow-prompt", onPrompt);
    return () => window.removeEventListener("cat-flow-prompt", onPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    setMessages((prev) => [...prev, { role: "user", content: trimmed, timestamp: Date.now() }]);
    setInput("");
    // Re-broadcast so ACC session memory picks it up too.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("cat-flow-prompt-from-input", { detail: trimmed }));
    }
    await streamSendMessage(trimmed, SESSION_ID);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  };

  const isError = status === "error";
  const statusPill = useMemo(() => {
    if (isError) return { label: "Error", bg: "#7f1d1d", text: "#fca5a5", dot: "#ef4444", pulse: false };
    if (isStreaming) return { label: "Executing tools…", bg: "#78350f", text: "#f59e0b", dot: "#f59e0b", pulse: true };
    return { label: "Complete", bg: "#166534", text: "#22c55e", dot: "#22c55e", pulse: false };
  }, [isError, isStreaming]);

  // The "live" agent text for the in-progress turn (rendered below the
  // accumulated messages). Once streaming finishes we'll snapshot it into
  // `messages` and clear this view.
  const liveAgentText = isStreaming ? finalResponse : "";
  const showEmptyState = messages.length === 0 && !isStreaming && !error;

  const mapStatusToFlyout = (): "thinking" | "executing" | "done" | "error" => {
    if (error) return "error";
    if (isStreaming) return status === "thinking" ? "thinking" : "executing";
    return "done";
  };

  return (
    <>
      <section
        className="flex flex-col h-full overflow-hidden rounded-lg"
        style={{ background: "var(--bby-chat-bg)", border: "1px solid var(--bby-chat-border)" }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 h-14 flex-shrink-0"
          style={{ background: "var(--bby-chat-bg)", borderBottom: "1px solid var(--bby-chat-border)" }}
        >
          <span
            className="inline-flex items-center justify-center w-9 h-9 rounded-full text-base"
            style={{ background: "#1e3a5f", color: "var(--bby-step-active-icon)" }}
          >
            ⚡
          </span>
          <div className="flex-1 leading-tight">
            <div className="text-white font-semibold text-sm">Agentic Category AI</div>
            <div className="text-[11px]" style={{ color: "var(--bby-kpi-label)" }}>
              Multi-step reasoning · Real-time data · Autonomous monitoring
            </div>
          </div>
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium"
            style={{ background: statusPill.bg, color: statusPill.text }}
          >
            <span
              className={"inline-block w-1.5 h-1.5 rounded-full " + (statusPill.pulse ? "animate-pulse_dot" : "")}
              style={{ background: statusPill.dot }}
            />
            {statusPill.label}
          </span>
        </div>

      {/* Message area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 min-h-0">
        {showEmptyState && (
          // Compact empty state — no large hero icon/title.
          // Just a one-line hint plus the suggested-prompt chips so the
          // panel reads like a compact preview when no message has fired.
          <div className="flex flex-col items-start gap-2.5">
            <div className="text-[11px]" style={{ color: "var(--bby-kpi-label)" }}>
              Select a demo flow or ask any question.
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => submit(p)}
                  className="px-2.5 py-1 rounded-full text-[10px] transition-colors border bg-[#1e2532] border-[#2d3748] text-[#94a3b8] hover:bg-[#1e3a5f] hover:border-[#3b82f6] hover:text-[#60a5fa]"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div
              key={`u-${i}`}
              className="self-end max-w-[85%] px-3.5 py-2.5 text-white text-[14px]"
              style={{
                background: "var(--bby-chat-user-bubble)",
                border: "1px solid #2d4a7a",
                borderRadius: "12px 12px 2px 12px",
              }}
            >
              {m.content}
            </div>
          ) : (
            <div
              key={`a-${i}`}
              className="self-start w-full cursor-pointer group"
              onClick={() => {
                setFlyoutPrompt(messages.find((msg) => msg.role === "user" && msg.timestamp < m.timestamp)?.content || "");
                setIsFlyoutOpen(true);
              }}
            >
              <div className="relative">
                <AgentResponse content={m.content} />
                <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 text-xs text-slate-400 bg-slate-900/80 rounded">
                  Click to expand ↗
                </div>
              </div>
            </div>
          ),
        )}

        {/* Streaming response — shown live until status flips to done */}
        {isStreaming && (
          <div
            className="self-start w-full cursor-pointer group"
            onClick={() => {
              setFlyoutPrompt(messages.find((msg) => msg.role === "user" && msg.timestamp < Date.now())?.content || "");
              setIsFlyoutOpen(true);
            }}
          >
            <div className="relative">
              {liveAgentText ? (
                <AgentResponse content={liveAgentText} />
              ) : (
                <div className="text-[12px] italic" style={{ color: "var(--bby-kpi-label)" }}>
                  {steps.length > 0 ? `[${steps[steps.length - 1].step}] ${steps[steps.length - 1].content}` : "Thinking…"}
                </div>
              )}
              <span className="inline-block w-2 h-4 bg-[#3b82f6] align-middle ml-0.5 animate-pulse_dot" aria-hidden="true" />
              <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 text-xs text-slate-400 bg-slate-900/80 rounded">
                Click to expand ↗
              </div>
            </div>
          </div>
        )}

        {error && !isStreaming && (
          <div
            className="self-start max-w-[85%] px-3 py-2 rounded-md text-[12px]"
            style={{ background: "#7f1d1d", border: "1px solid #b91c1c", color: "#fecaca" }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div
        className="px-3 py-3 flex items-center gap-2 flex-shrink-0"
        style={{ borderTop: "1px solid var(--bby-chat-border)", background: "var(--bby-chat-bg)" }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={isStreaming}
          placeholder="Ask anything about Home Appliance, Mobile, and Accessories..."
          className="flex-1 rounded-lg px-3.5 py-2.5 text-white placeholder:text-[#475569] text-[13px] focus:outline-none focus:ring-1"
          style={{
            background: "var(--bby-chat-input-bg)",
            border: "1px solid var(--bby-chat-border)",
            // @ts-ignore — CSS variable on focus-ring color via Tailwind utility
            "--tw-ring-color": "var(--bby-chat-input-border)",
          } as React.CSSProperties}
        />
        <button
          type="button"
          onClick={() => submit(input)}
          disabled={isStreaming || !input.trim()}
          className="rounded-md px-3 py-2 text-white disabled:cursor-not-allowed transition-colors"
          style={{
            background: !input.trim() || isStreaming ? "#1e2532" : "var(--bby-chat-send-btn)",
            color: !input.trim() || isStreaming ? "#475569" : "#fff",
          }}
          aria-label="Send"
        >
          ➤
        </button>
      </div>

      {/* Agent Flyout Drawer */}
      <AgentFlyout
        isOpen={isFlyoutOpen}
        onClose={() => setIsFlyoutOpen(false)}
        agentContent={messages.find((m) => m.role === "agent" && m.timestamp > (messages.find((msg) => msg.content === flyoutPrompt)?.timestamp || 0))?.content || finalResponse || ""}
        status={mapStatusToFlyout()}
        prompt={flyoutPrompt}
      />
    </section>
    </>
  );
}
