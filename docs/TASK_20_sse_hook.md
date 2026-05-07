# TASK_20_sse_hook.md — Frontend SSE Hook Hardening (`useSSE`)

**Status:** ✅ DONE  
**Phase:** 4 — API + Frontend  
**Prerequisite:** TASK_19 complete and validated  
**Assigned to:** Aider  
**Validated by:** Codex

---

## What to Build

Upgrade `lib/sse/useSSE.ts` into a resilient SSE client hook for agent chat streaming.

Current hook works for happy path but lacks robust error handling, stream cancellation, and typed event-state control. This task makes it production-safe without changing backend contracts.

---

## Files to Create / Edit (Aider scope — ONLY these)

```
lib/sse/useSSE.ts
```

---

## Functional Requirements

1. Preserve existing contract:
- Export `useAgentStream()`
- Keep returned fields:
  - `steps`
  - `finalResponse`
  - `isStreaming`
  - `sendMessage(...)`

2. Add typed runtime states:
- `error: string | null`
- `status: "idle" | "streaming" | "done" | "error"`

3. SSE parsing behavior:
- Parse only lines prefixed with `data: `
- Ignore keepalive/comment lines
- Safely handle malformed JSON event payloads without crashing hook
- Continue streaming on recoverable parse errors

4. Streaming lifecycle:
- Reset state at send start
- Support cancellation of in-flight stream via `AbortController`
- Ensure `isStreaming` and `status` are always finalized on done/error/abort

5. Event handling:
- If event `step === "respond_chunk"`, append to `finalResponse`
- Otherwise append to `steps`
- If event `step === "error"`, set `error` and `status="error"` and stop stream loop

6. Request handling:
- Keep POST `/api/chat` payload compatible with backend (`message`, `session_id`)
- Preserve existing headers and allow optional caller overrides via params if minimal to add
- If non-2xx HTTP response, capture body text (or status) into `error`

---

## Non-Goals

- Do not change backend SSE format
- Do not modify route handlers or UI components in this task
- Do not introduce new libraries

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file lib/sse/useSSE.ts
```

**Prompt to paste into Aider:**

```text
Implement TASK_20_sse_hook.md with minimal edits to lib/sse/useSSE.ts only.

Requirements:
- Keep existing hook API and behavior for steps/finalResponse/isStreaming/sendMessage.
- Add error + status state fields.
- Add AbortController-based stream cancellation safety.
- Harden SSE parsing:
  - parse only "data: " lines
  - ignore malformed chunks safely
  - continue when possible
- Handle backend non-OK responses with useful error messages.
- If an SSE event has step "error", set error/status and stop stream.
- Keep full TypeScript typing; no any.
- No other file changes.
```

---

## Validation Steps

```bash
cd /home/appadmin/projects/Ram_Projects/Category_Analysis
npx tsc --noEmit
cd /home/appadmin/projects/Ram_Projects/Category_Analysis && /home/appadmin/projects/Ram_Projects/Category_Analysis/.venv/bin/ruff --version
```

Note: second command is just env sanity in this mixed TS/Python workspace. TS compile is the required gate for this task.

---

## Definition of Done

- [x] `useAgentStream` still exports original fields and `sendMessage`
- [x] New `error` and `status` state fields exposed
- [x] Hook handles non-OK responses and malformed SSE data safely
- [x] Streaming lifecycle cannot get stuck in `isStreaming=true`
- [x] TypeScript compile passes

---

*Task created: April 2026 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*
