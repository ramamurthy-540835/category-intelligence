# TASK_GRAPH_FIX.md — Immediate Bug Fixes (Current Session)

**Status:** 🔴 IN PROGRESS  
**Phase:** 4 — API + Frontend  
**Assigned to:** Aider  
**Validated by:** Codex after Aider completes

---

## Problem Description

The ChatInterface crashes on `crypto.randomUUID()` in some browser/Node runtimes
because `crypto` is not guaranteed to be available as a global in all Next.js
execution contexts (middleware, SSR edge, older browsers).

Aider already patched `ChatInterface.tsx` with a `createSessionId()` helper.
This task validates that fix and extends it to all other places session IDs are generated.

---

## Root Cause Checklist

- [x] `crypto.randomUUID()` called directly without `globalThis` guard → **FIXED** in `ChatInterface.tsx`
- [ ] Same pattern may exist in `lib/sse/useSSE.ts` — check line ~12 for any UUID call
- [ ] Same pattern may exist in `app/api/chat/route.ts` — server side should use `crypto` from Node `crypto` module, not Web Crypto API
- [ ] `session_id` passed as prop is sometimes `undefined` if button clicked before state initialises

---

## Files to Inspect (Aider scope — ONLY these files)

```
components/chat/ChatInterface.tsx
lib/sse/useSSE.ts
app/api/chat/route.ts
```

---

## Expected Outcome

1. `createSessionId()` helper extracted to `lib/utils/session.ts` so it is shared:

```typescript
// lib/utils/session.ts
export function createSessionId(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}
```

2. `ChatInterface.tsx` imports from `lib/utils/session.ts` instead of defining inline
3. `useSSE.ts` uses `createSessionId()` if it generates its own session IDs
4. `app/api/chat/route.ts` uses Node's built-in `crypto` for server-side UUID:

```typescript
import { randomUUID } from "crypto"; // Node built-in — always safe server-side
```

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file components/chat/ChatInterface.tsx \
  --file lib/sse/useSSE.ts \
  --file app/api/chat/route.ts \
  --file lib/utils/session.ts
```

**Prompt to paste into Aider after files load:**

```
Extract the createSessionId() helper that was added inline in ChatInterface.tsx
into a new shared file lib/utils/session.ts.

Update ChatInterface.tsx to import createSessionId from lib/utils/session.ts
instead of defining it inline.

Check useSSE.ts — if it calls crypto.randomUUID() anywhere, replace with
import { createSessionId } from "@/lib/utils/session".

In app/api/chat/route.ts, replace any Web Crypto UUID calls with:
  import { randomUUID } from "crypto"
since this file always runs server-side in Node.

Do not change any other logic. Minimal edits only.
```

---

## Validation Steps

```bash
# 1. TypeScript — no errors
npx tsc --noEmit

# 2. No direct crypto.randomUUID() calls remain outside session.ts
grep -rn "crypto\.randomUUID" app/ components/ lib/ | grep -v "session.ts"
# Expected output: (empty — no matches)

# 3. session.ts exists and exports createSessionId
cat lib/utils/session.ts

# 4. Hot reload — open browser on localhost:3005, send a message, no console errors
```

---

## Definition of Done

- [ ] `lib/utils/session.ts` exists with exported `createSessionId()`
- [ ] Zero direct `crypto.randomUUID()` calls outside `session.ts`
- [ ] `npx tsc --noEmit` exits with code 0
- [ ] Chat sends a message and receives SSE stream without error in browser console
- [ ] Mark this file status as ✅ DONE when all boxes checked

---

*Task created: April 2026 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*
