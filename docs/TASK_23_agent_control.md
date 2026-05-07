# TASK_23_agent_control.md — Agent Control Center Live Status UI

**Status:** ✅ DONE  
**Phase:** 4 — API + Frontend  
**Prerequisite:** TASK_22 complete and validated  
**Assigned to:** Aider  
**Validated by:** Codex

---

## What to Build

Upgrade `components/chat/AgentControlCenter.tsx` from static phase cards to a live status panel that reflects `useAgentStream` lifecycle.

This task focuses on UI behavior and typed props only in the control-center component.

---

## Files to Create / Edit (Aider scope — ONLY these)

```
components/chat/AgentControlCenter.tsx
```

---

## Functional Requirements

1. Component contract:
- Keep exported component name: `AgentControlCenter`
- Add typed props (optional-safe defaults):
  - `status?: "idle" | "thinking" | "acting" | "analyzing" | "responding" | "done" | "error"`
  - `steps?: Array<{ step: string; content: string }>`
  - `error?: string | null`

2. Phase mapping:
- Map status to four core phases:
  - `thinking` -> Think active
  - `acting` -> Act active
  - `analyzing` -> Analyze active
  - `responding` -> Respond active
- `done` marks all phases complete
- `error` visually flags current/last phase and shows error summary

3. Visual behavior:
- Keep current design language (`panel`, rounded cards) but add:
  - active indicator for current phase
  - completed state for past phases
  - idle state before stream starts
- Include a compact status badge:
  - Idle / Streaming / Done / Error

4. Live details:
- Show latest event content snippet from `steps` (if present)
- If `error` is set, render a visible error block with safe text

5. Accessibility:
- Use semantic labels and sufficient contrast classes
- No motion-heavy animation required in this task

---

## Non-Goals

- Do not modify `ChatInterface.tsx` in this task
- Do not modify `lib/sse/useSSE.ts` in this task
- Do not fetch data directly in this component

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file components/chat/AgentControlCenter.tsx
```

**Prompt to paste into Aider:**

```text
Implement TASK_23_agent_control.md with minimal edits to components/chat/AgentControlCenter.tsx only.

Requirements:
- Keep AgentControlCenter export.
- Add typed optional props: status, steps, error.
- Render phase cards with active/completed/idle visual state based on status.
- Add compact status badge (Idle/Streaming/Done/Error).
- Show latest step content when available.
- Show explicit error block when error prop exists.
- Preserve existing visual language and keep component standalone.
- No other file changes.
```

---

## Validation Steps

```bash
cd /home/appadmin/projects/Ram_Projects/Category_Analysis
npx tsc --noEmit
```

Optional UI smoke:

```bash
# Start app then verify control center responds as status prop changes
npm run dev
```

---

## Definition of Done

- [x] `AgentControlCenter` accepts typed live-status props
- [x] Phase cards reflect active/completed states
- [x] Status badge and latest-step summary are rendered
- [x] Error state is clearly visible when provided
- [x] TypeScript compile passes

---

*Task created: April 2026 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*
