"use client";
import ReactMarkdown from "react-markdown";

interface AgentResponseProps {
  content: string;
}

export default function AgentResponse({ content }: AgentResponseProps) {
  return (
    <div
      className="agent-md"
      style={{ overflowWrap: "break-word", wordBreak: "break-word" }}
    >
      <ReactMarkdown
        components={{

          // ## INTELLIGENCE FLOW / ROOT CAUSE / DATA SIGNALS / RECOMMENDATION / CONFIDENCE
          h2: ({ children }) => (
            <div className="flex items-center gap-2 mt-3 mb-1.5 first:mt-0">
              <span className="text-[#60a5fa] text-[9px] font-bold tracking-[0.12em] uppercase whitespace-nowrap">
                {children}
              </span>
              <div className="flex-1 h-px bg-[#1e3a5f]" />
            </div>
          ),

          h3: ({ children }) => (
            <p className="text-[#94a3b8] text-[9px] font-semibold uppercase tracking-wider mt-1.5 mb-1">
              {children}
            </p>
          ),

          // normal paragraphs
          p: ({ children }) => (
            <p className="text-[#cbd5e1] text-[11px] leading-[1.55] mb-1.5">
              {children}
            </p>
          ),

          // bullet list — tight rows, no floating orphan dots
          ul: ({ children }) => (
            <div className="flex flex-col gap-1 mb-2">
              {children}
            </div>
          ),

          // numbered list
          ol: ({ children }) => (
            <div className="flex flex-col gap-1 mb-2">
              {children}
            </div>
          ),

          // each list item as a compact pill row
          li: ({ children, index, ordered, ...props }: any) => (
            <div className="flex items-baseline gap-1.5 bg-[#161b22] border border-[#1e2532] rounded px-2.5 py-1.5 text-[10.5px] text-[#cbd5e1] leading-snug">
              <span className="text-[#3b82f6] text-[9px] flex-shrink-0 font-bold mt-px">
                {ordered ? `${(props as any).node?.position?.start?.offset ?? ''}` : '▸'}
              </span>
              <span className="flex-1">{children}</span>
            </div>
          ),

          // inline code  e.g. `bigquery-live`
          code: ({ children, className }: any) => {
            const isBlock = className?.includes("language-");
            if (isBlock) {
              return (
                <pre
                  className="bg-[#0d1117] border border-[#2d3748] rounded p-2.5 overflow-x-auto my-1.5"
                  style={{ maxWidth: "100%" }}
                >
                  <code className="text-[#22c55e] text-[9px] font-mono leading-relaxed">{children}</code>
                </pre>
              );
            }
            return (
              <code className="bg-[#1e3a5f] text-[#60a5fa] text-[9px] font-mono px-1.5 py-0.5 rounded">
                {children}
              </code>
            );
          },

          strong: ({ children }) => (
            <strong className="text-white font-semibold">{children}</strong>
          ),

          em: ({ children }) => (
            <em className="text-[#94a3b8] not-italic font-medium">{children}</em>
          ),

          hr: () => <div className="my-2 border-t border-[#1e2532]" />,

          blockquote: ({ children }) => (
            <div className="border-l-2 border-[#3b82f6] pl-3 my-1.5 bg-[#0f1923] rounded-r py-1.5 pr-2 text-[10.5px] text-[#94a3b8]">
              {children}
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>

      {/* Suppress any remaining default list styling */}
      <style>{`
        .agent-md ul, .agent-md ol { list-style: none; padding: 0; margin: 0; }
        .agent-md li { display: block; }
        .agent-md li::marker { display: none; }
        .agent-md li p { margin: 0; }
      `}</style>
    </div>
  );
}
