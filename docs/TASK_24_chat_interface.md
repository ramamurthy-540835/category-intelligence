# TASK_24_chat_interface.md — Chat Interface Wiring to Stream State

**Status:** ✅ DONE  
**Phase:** 4 — API + Frontend  
**Prerequisite:** TASK_23 complete and validated  
**Assigned to:** Aider  
**Validated by:** Codex

---

## What to Build

Wire `components/chat/ChatInterface.tsx` to fully consume the enriched `useAgentStream` state (`status`, `error`) and pass live state into `AgentControlCenter`.

This task keeps existing layout and style language while making chat behavior more robust and explicit.

---

## Files to Create / Edit (Aider scope — ONLY these)

```
components/chat/ChatInterface.tsx
```

---

## Functional Requirements

1. Hook integration:
- Keep using `useAgentStream()`
- Read fields:
  - `steps`
  - `finalResponse`
  - `isStreaming`
  - `sendMessage`
  - `status`
  - `error`

2. Agent control wiring:
- Render `AgentControlCenter` inside chat section using live props:
  - `status={status}`
  - `steps={steps}`
  - `error={error}`

3. Ask button behavior:
- Keep existing session creation
- Disable button when:
  - `isStreaming === true`
  - OR trimmed message is empty
- Add accessible label text unchanged or improved minimally

4. Input handling:
- Prevent sending empty/whitespace-only message
- Keep current default prompt string unless clearly necessary

5. Stream status text:
- Replace simple `Streaming/Ready` label with status-aware text:
  - `idle` -> Ready
  - `thinking/acting/analyzing/responding` -> Streaming
  - `done` -> Done
  - `error` -> Error

6. Error rendering:
- If `error` exists:
  - show non-intrusive inline error block near chat input/response area
  - do not remove previously streamed content

7. Existing behavior to preserve:
- `respond_chunk` accumulation display in response panel
- existing step list rendering
- existing panel structure and utility classes as baseline

---

## Non-Goals

- Do not modify `components/chat/AgentControlCenter.tsx` in this task
- Do not modify `lib/sse/useSSE.ts` in this task
- Do not change backend API contracts

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file components/chat/ChatInterface.tsx
```

**Prompt to paste into Aider:**

```text
Implement TASK_24_chat_interface.md with minimal edits to components/chat/ChatInterface.tsx only.

Requirements:
- Consume status and error from useAgentStream().
- Keep existing steps/finalResponse/sendMessage behavior.
- Disable Ask button on empty trimmed message and while streaming.
- Pass status/steps/error props into AgentControlCenter.
- Replace top-right status label with status-aware text (Ready/Streaming/Done/Error).
- Render an inline error block when error exists.
- Preserve existing layout and className style patterns.
- No other file changes.
```

---

## Validation Steps

```bash
cd /home/appadmin/projects/Ram_Projects/Category_Analysis
npx tsc --noEmit
```

Optional smoke:

```bash
npm run dev
# Submit empty message (button disabled)
# Submit valid message and watch control center + response state transitions
```

---

## Definition of Done

- [ ] Chat UI consumes `status` and `error` from stream hook
- [ ] Ask button guards empty input and active stream
- [ ] AgentControlCenter receives live status/steps/error props
- [ ] Inline error block is visible when stream errors occur
- [ ] TypeScript compile passes

---

*Task created: April 2026 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*
