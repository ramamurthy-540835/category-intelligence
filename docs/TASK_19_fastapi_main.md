# TASK_19_fastapi_main.md — FastAPI Main Wiring (IntegrationAgent + SSE)

**Status:** ✅ DONE  
**Phase:** 4 — API + Frontend  
**Prerequisite:** TASK_15, TASK_16, TASK_17, TASK_18 complete and validated  
**Assigned to:** Aider  
**Validated by:** Codex

---

## What to Build

Update `backend/main.py` to make `IntegrationAgent` the primary orchestration boundary for API flows.

This task wires:
- SSE chat through `IntegrationAgent.run_chat(...)`
- ops cycle endpoint through `IntegrationAgent.run_sensing_cycle()`
- guarded action endpoint through `IntegrationAgent.trigger_action(...)`

Minimal surgical edits only.

---

## Files to Create / Edit (Aider scope — ONLY these)

```
backend/main.py
backend/schemas/api.py
```

---

## Endpoint Requirements

1. `GET /health`
- Keep existing lightweight health response

2. `POST /agent/chat` (SSE)
- Keep request contract: `{message, session_id}`
- Delegate stream orchestration to `IntegrationAgent.run_chat(...)` (not direct IntelligenceAgent call)
- SSE payload format remains `{"data": "<json>"}` for each yielded event
- Include SSE-safe headers:
  - `Cache-Control: no-cache`
  - `Connection: keep-alive`
  - `X-Accel-Buffering: no`
- RBAC: requires diagnosis permission

3. `POST /agent/sensing-cycle`
- Call `IntegrationAgent.run_sensing_cycle()`
- Return JSON summary:
  - `total_scanned`
  - `alerts_emitted`
  - `alerts_routed`
  - `alerts_suppressed`
- RBAC: manager only (or trigger-action permission if mapped)

4. `POST /agent/action`
- Request schema:
  - `action_type: Literal["reprice","replenish","draft_coop_email","queue_campaign"]`
  - `payload: dict[str, Any]`
- Delegate to `IntegrationAgent.trigger_action(...)`
- Preserve `PermissionError` -> HTTP 403 mapping
- Surface other execution errors as HTTP 500 with safe message
- RBAC: manager only

---

## Dependency and Logging Requirements

- Keep `get_integration_agent()` dependency
- Remove unused direct `IntelligenceAgent` dependency wiring if no longer needed
- Structured logging for:
  - incoming chat request metadata (no PII payload dump)
  - sensing-cycle invocation/result
  - action trigger attempt/outcome
- No hardcoded env values

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file backend/main.py \
  --file backend/schemas/api.py
```

**Prompt to paste into Aider:**

```text
Implement TASK_19_fastapi_main.md with minimal edits.

In backend/main.py:
- Route /agent/chat through IntegrationAgent.run_chat() and stream SSE unchanged.
- Add /agent/sensing-cycle endpoint calling IntegrationAgent.run_sensing_cycle().
- Add /agent/action endpoint calling IntegrationAgent.trigger_action().
- Map PermissionError to 403, keep safe 500 handling for unexpected errors.
- Keep RBAC checks using existing middleware/dependency model.
- Add SSE headers: Cache-Control no-cache, Connection keep-alive, X-Accel-Buffering no.
- Remove any now-unused IntelligenceAgent direct dependency/import.

In backend/schemas/api.py:
- Add typed request model for action trigger payload.
- Keep existing ChatRequest model intact.

Constraints:
- Full type hints.
- Structured logging only.
- No hardcoded secrets/config.
- Minimal surgical edits.
```

---

## Validation Steps

```bash
python3 -m compileall backend
cd /home/appadmin/projects/Ram_Projects/Category_Analysis/backend && /home/appadmin/projects/Ram_Projects/Category_Analysis/.venv/bin/ruff check main.py schemas/api.py
cd /home/appadmin/projects/Ram_Projects/Category_Analysis && python3 -c "import sys; sys.path.insert(0, '.'); from backend.main import app; print('OK')"
```

---

## Definition of Done

- [x] `/agent/chat` delegates through `IntegrationAgent.run_chat`
- [x] `/agent/sensing-cycle` endpoint added and returns required summary keys
- [x] `/agent/action` endpoint added with manager guard and error mapping
- [x] Request schemas typed and validated
- [x] Compile, lint, and import checks pass

---

*Task created: April 2026 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*
