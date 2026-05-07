# TASK_22_dashboard_routes.md — Dashboard Tab Route Hardening

**Status:** ✅ DONE  
**Phase:** 4 — API + Frontend  
**Prerequisite:** TASK_21 complete and validated  
**Assigned to:** Aider  
**Validated by:** Codex

---

## What to Build

Harden `app/api/dashboard/[tab]/route.ts` so dashboard API behavior is deterministic, typed, and resilient when backend is unavailable.

The route should keep offline-first behavior but return clearer metadata and stricter tab validation.

---

## Files to Create / Edit (Aider scope — ONLY these)

```
app/api/dashboard/[tab]/route.ts
```

---

## Functional Requirements

1. Runtime and method:
- Keep `runtime = "nodejs"`
- Keep `GET` handler only

2. Supported tabs:
- Enforce allowlist:
  - `overview`
  - `inventory`
  - `dc-stock`
  - `promos`
  - `competitive`
  - `vendor`
- If tab is not allowed:
  - return `404` JSON
  - payload:
    - `error: "not_found"`
    - `detail: "unknown dashboard tab"`

3. Backend proxy path:
- Fetch `${NEXT_PUBLIC_API_BASE_URL}/dashboard/{tab}`
- Keep `cache: "no-store"`
- Forward optional identity header if present:
  - incoming `x-user-identity` -> upstream `X-User-Identity`

4. Success response:
- If upstream `response.ok`:
  - return upstream JSON payload as-is
  - add top-level marker field:
    - `source: "backend"`

5. Offline fallback response:
- If fetch fails or upstream non-OK:
  - return `offlineDashboard[tab]` fallback (or `overview` as safe fallback)
  - add top-level marker fields:
    - `source: "fallback"`
    - `fallback_reason: "network_or_upstream_error"`

6. Logging:
- `console.error` for upstream non-OK and network failures
- Never log sensitive payloads

---

## Non-Goals

- Do not modify `lib/reference/dashboard.ts`
- Do not add new API routes
- Do not change frontend page components in this task

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file app/api/dashboard/[tab]/route.ts
```

**Prompt to paste into Aider:**

```text
Implement TASK_22_dashboard_routes.md with minimal edits to app/api/dashboard/[tab]/route.ts only.

Requirements:
- Enforce tab allowlist and return 404 JSON for unknown tabs.
- Keep GET route and Node runtime.
- Proxy to backend /dashboard/{tab} with cache no-store.
- Forward x-user-identity header to upstream as X-User-Identity when present.
- On success: return backend JSON plus source="backend".
- On upstream failure/network error: return offline fallback plus source="fallback" and fallback_reason.
- Add concise console.error logs for failures.
- No other file changes.
```

---

## Validation Steps

```bash
cd /home/appadmin/projects/Ram_Projects/Category_Analysis
npx tsc --noEmit
```

Optional smoke checks:

```bash
curl -s http://localhost:3005/api/dashboard/overview | head
curl -s -o /dev/null -w "%{http_code}" http://localhost:3005/api/dashboard/unknown-tab
# Expected: 404
```

---

## Definition of Done

- [x] Unknown tab handling returns 404 JSON
- [x] Valid tabs proxy to backend and include `source="backend"` on success
- [x] Fallback path includes `source="fallback"` and reason metadata
- [x] Identity header forwarding implemented safely
- [x] TypeScript compile passes

---

*Task created: April 2026 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*
