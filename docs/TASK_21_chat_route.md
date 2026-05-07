# TASK_21_chat_route.md — Next.js Chat SSE Proxy Route

**Status:** ✅ DONE  
**Phase:** 4 — API + Frontend  
**Prerequisite:** TASK_20 complete and validated  
**Assigned to:** Aider  
**Validated by:** Codex

---

## What to Build

Harden `app/api/chat/route.ts` as a production-safe SSE proxy between the browser and backend `/agent/chat`.

The route must:
- validate input shape
- forward identity/role headers consistently
- preserve SSE stream semantics
- return explicit JSON errors for non-streaming failures

Minimal edits only in this route file.

---

## Files to Create / Edit (Aider scope — ONLY these)

```
app/api/chat/route.ts
```

---

## Functional Requirements

1. Runtime and method:
- Keep `runtime = "nodejs"`
- Implement `POST` only

2. Request validation:
- Parse JSON body safely
- Require:
  - `message` string (non-empty)
  - `session_id` string (non-empty)
- If invalid body, return `400` JSON:
  - `{ "error": "invalid_request", "detail": "<reason>" }`

3. Header forwarding:
- Read:
  - `x-user-identity` (default `anonymous`)
  - `x-user-role` (default `viewer`)
- Forward these headers to backend as:
  - `X-User-Identity`
  - `X-User-Role`

4. Upstream call:
- Target: `${NEXT_PUBLIC_API_BASE_URL}/agent/chat`
- Use `POST`, `Content-Type: application/json`
- Forward exact validated body (no shape rewrite)

5. Response behavior:
- If upstream returns SSE stream:
  - proxy `upstream.body` directly
  - set headers:
    - `Content-Type: text/event-stream`
    - `Cache-Control: no-cache, no-transform`
    - `Connection: keep-alive`
- If upstream returns non-OK without stream:
  - return JSON error with upstream status
- If fetch/network throws:
  - return `502` JSON:
    - `{ "error": "upstream_unavailable", "detail": "<message>" }`

6. Logging:
- Add concise server-side logging for:
  - validation failures
  - upstream non-OK status
  - proxy/network errors
- Do not log full message payload text

---

## Non-Goals

- Do not modify frontend hook/components here
- Do not modify backend endpoints here
- Do not add authentication framework in this task

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file app/api/chat/route.ts
```

**Prompt to paste into Aider:**

```text
Implement TASK_21_chat_route.md with minimal edits to app/api/chat/route.ts only.

Requirements:
- Keep Node runtime.
- Validate POST JSON body requires non-empty message and session_id.
- On invalid request return 400 JSON {error, detail}.
- Forward x-user-identity and x-user-role to backend with defaults anonymous/viewer.
- Proxy SSE stream unchanged when upstream is successful.
- Handle upstream non-OK and network errors with structured JSON errors.
- Keep SSE headers explicit (text/event-stream, no-cache/no-transform, keep-alive).
- Add concise logging for validation/upstream errors without dumping message content.
- No other file changes.
```

---

## Validation Steps

```bash
cd /home/appadmin/projects/Ram_Projects/Category_Analysis
npx tsc --noEmit
```

Optional smoke check:

```bash
curl -i -X POST http://localhost:3005/api/chat \
  -H "Content-Type: application/json" \
  -H "x-user-identity: smoke-user" \
  -H "x-user-role: analyst" \
  -d '{"message":"hello","session_id":"smoke-001"}'
```

---

## Definition of Done

- [x] Request body validation is enforced
- [x] Identity/role headers are forwarded with defaults
- [x] SSE proxy path remains streaming and stable
- [x] Structured JSON error responses for invalid/upstream failures
- [x] TypeScript compile passes

---

*Task created: April 2026 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*
