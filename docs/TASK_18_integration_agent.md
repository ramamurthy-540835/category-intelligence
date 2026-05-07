# TASK_18_integration_agent.md — Integration Agent (Agent Orchestration Layer)

**Status:** ✅ DONE  
**Phase:** 3 — Agents  
**Prerequisite:** TASK_15, TASK_16, TASK_17 complete and validated  
**Assigned to:** Aider  
**Validated by:** Codex

---

## What to Build

Implement `IntegrationAgent` as the orchestration layer that coordinates:
- `IntelligenceAgent` (reasoning/response flow)
- `SensingAgent` (alert detection/publish)
- `NerveAgent` (alert routing/dedup/urgency)

The integration layer must provide a single async entrypoint for application use and return structured outputs suitable for API and SSE layers.

---

## Files to Create / Edit (Aider scope — ONLY these)

```
backend/agents/integration_agent.py
```

---

## Required Responsibilities

1. Dependency wiring
- Initialize with injected agent instances when provided.
- Support safe lazy construction if instances are not injected.
- Keep constructor typed and test-friendly.

2. Chat orchestration path
- Expose async method to run intelligence chat flow (session/user context included).
- Forward streamed/structured events from `IntelligenceAgent` without reformatting semantics.

3. Ops orchestration path
- Expose async method to run sensing scan, then route resulting alerts through `NerveAgent`.
- Return summary object:
  - total scanned
  - alerts emitted
  - alerts routed
  - alerts suppressed
  - by-priority counts

4. Error handling
- Catch and log per-stage failures with structured logging.
- Fail one branch without crashing unrelated branch when possible.
- Return explicit error metadata in response payload.

5. Type safety and contracts
- Full type hints.
- Typed payload contracts (TypedDict/dataclass) for orchestration responses.
- No hardcoded environment values in orchestration logic.

---

## Non-Goals

- Do not modify FastAPI routes yet (that is TASK_19).
- Do not modify tool modules.
- Do not refactor existing agent internals unless required for import compatibility in this file.

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file backend/agents/integration_agent.py
```

**Prompt to paste into Aider:**

```text
Implement TASK_18_integration_agent.md with minimal safe edits.

Create backend/agents/integration_agent.py implementing an IntegrationAgent class that orchestrates IntelligenceAgent, SensingAgent, and NerveAgent.

Requirements:
- async chat path that delegates to IntelligenceAgent
- async ops path that runs sensing then routes alerts via NerveAgent
- structured logging at each stage
- typed response payloads and method signatures
- resilient error handling per stage (do not crash whole flow when a sub-stage fails)
- no hardcoded env values
- no broad refactor outside this file
```

---

## Validation Steps

```bash
cd backend
ruff check agents/integration_agent.py
python3 -c "from agents.integration_agent import IntegrationAgent; print('OK')"
```

---

## Definition of Done

- [x] `IntegrationAgent` exists with async orchestration methods
- [x] Intelligence chat path delegated cleanly
- [x] Sensing + Nerve ops flow orchestrated end-to-end
- [x] Structured responses include routing/suppression counts
- [x] Stage-level errors are captured and returned safely
- [x] File passes Ruff and import smoke test

---

*Task created: April 2026 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*
