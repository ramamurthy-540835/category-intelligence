"use client";
import { useState, useRef, useEffect } from "react";

interface FlyoutCardProps {
  title: string;
  subtitle?: string;
  icon?: string;
  badge?: React.ReactNode;
  preview?: React.ReactNode;   // what shows in the COLLAPSED card — keep tiny
  children: React.ReactNode;   // full content — shown ONLY in flyout + hover tooltip
  defaultWidth?: string;
}

export default function FlyoutCard({
  title, subtitle, icon, badge, preview, children, defaultWidth = "w-full",
}: FlyoutCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onEnter = () => { tipTimer.current = setTimeout(() => setShowTip(true), 320); };
  const onLeave = () => { if (tipTimer.current) clearTimeout(tipTimer.current); setShowTip(false); };
  const open = () => { setShowTip(false); setIsOpen(true); };

  return (
    <>
      {/* ── COLLAPSED CARD ─────────────────────────────── */}
      <div
        className={`${defaultWidth} min-w-0 flex flex-col bg-[#0f141c] border border-[#1e2532] rounded-lg overflow-visible relative group`}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        {/* Header */}
        <div
          onClick={open}
          className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[#1e2532] cursor-pointer hover:bg-[#161b22] transition-colors"
        >
          {icon && <span className="text-[12px] flex-shrink-0">{icon}</span>}
          <span className="text-[#e2e8f0] text-[10px] font-semibold truncate flex-1 min-w-0">{title}</span>
          {subtitle && (
            <span className="text-[#475569] text-[9px] truncate hidden sm:block flex-shrink-0 max-w-[72px]">
              {subtitle}
            </span>
          )}
          {badge && <div className="flex-shrink-0 ml-1">{badge}</div>}
          <svg className="w-2.5 h-2.5 text-[#475569] group-hover:text-[#60a5fa] transition-colors flex-shrink-0 ml-1"
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
          </svg>
        </div>

        {/* Mini preview — ONLY this renders in collapsed state, no full content */}
        <div style={{height:'48px',overflow:'hidden'}}
             onClick={open} className="px-2.5 py-2 cursor-pointer">
          {preview
            ? <div className="text-[9px] text-[#64748b] leading-relaxed line-clamp-3 w-full">{preview}</div>
            : <div className="text-[9px] text-[#475569] italic">Hover to preview · click to expand</div>
          }
        </div>

        {/* ── HOVER TOOLTIP ── */}
        {showTip && !isOpen && (
          <div
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 z-50 w-64 pointer-events-none"
            style={{ animation: "tip-in 140ms ease-out" }}
          >
            <div className="bg-[#1c2230] border border-[#2d4a6a] rounded-xl shadow-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-[#1e3a5f] border-b border-[#2d4a6a]">
                {icon && <span className="text-[11px]">{icon}</span>}
                <span className="text-white text-[11px] font-semibold flex-1 truncate">{title}</span>
                {badge && <div className="flex-shrink-0">{badge}</div>}
              </div>
              <div className="p-3 max-h-52 overflow-y-auto text-[10px] leading-relaxed text-[#94a3b8]">
                {children}
              </div>
              <div className="px-3 py-1.5 bg-[#0d1117] border-t border-[#1e2532] flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-[#3b82f6] animate-pulse" />
                <span className="text-[#3b82f6] text-[9px] font-bold tracking-widest uppercase">
                  Click to open full view
                </span>
              </div>
            </div>
            <div className="w-2 h-2 bg-[#1c2230] border-r border-b border-[#2d4a6a] rotate-45 mx-auto -mt-1" />
          </div>
        )}
      </div>

      {/* ── FLYOUT PANEL ───────────────────────────────── */}
      {isOpen && (
        <>
          {/* Backdrop — fixed full-viewport, sits ABOVE the page header / ticker */}
          <div
            ref={overlayRef}
            className="fixed inset-0 z-[9999]"
            style={{ background: "rgba(0,0,0,0.7)" }}
            onClick={() => setIsOpen(false)}
          />
          {/* Panel — fixed, full-screen on mobile, 480px on tablet, 40% (cap 720) on desktop */}
          <div
            className="fixed top-0 right-0 h-full z-[10000] flex flex-col bg-[#0d1117] border-l border-[#2d3748] shadow-2xl w-full sm:w-[480px] lg:w-[40%] lg:max-w-[720px]"
            style={{ animation: "flyout-in 220ms cubic-bezier(0.16,1,0.3,1)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 bg-[#003087] flex-shrink-0">
              <div className="flex items-center gap-2.5">
                {icon && <span className="text-sm">{icon}</span>}
                <div>
                  <p className="text-white text-[13px] font-semibold">{title}</p>
                  {subtitle && <p className="text-blue-200 text-[10px] mt-0.5">{subtitle}</p>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {badge}
                <button onClick={() => setIsOpen(false)}
                  className="text-white/50 hover:text-white p-1 rounded transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            </div>

            <div
              className="flex-1 overflow-y-auto overflow-x-hidden p-4 text-[12px]"
              style={{ overflowWrap: "break-word", wordBreak: "break-word" }}
            >
              {children}
            </div>

            <div className="px-5 py-2 border-t border-[#1e2532] flex-shrink-0">
              <p className="text-[#475569] text-[10px]">
                Press <kbd className="bg-[#1e2532] text-[#94a3b8] px-1 py-0.5 rounded font-mono text-[9px]">Esc</kbd> or click outside to close
              </p>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes flyout-in {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes tip-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
