# TASK_27_audit_logger.md — Governance Audit Logger Hardening

**Status:** ✅ DONE  
**Phase:** 5 — Governance  
**Prerequisite:** Phase 4 complete (TASK_26 implemented)  
**Assigned to:** Aider  
**Validated by:** Codex

---

## What to Build

Harden `backend/core/audit/logger.py` so all agent/tool audit events are reliably captured with structured logging and safe failure behavior, aligned to governance requirements for `ctoteam.category_intelligence.agent_action_log`.

---

## Files to Create / Edit (Aider scope — ONLY these)

```
backend/core/audit/logger.py
```

---

## Functional Requirements

1. Keep and standardize async audit APIs:
- `log_tool_call(...)`
- `log_agent_action(...)`
- `log_sensing_run(...)`
- Ensure each method always returns `None` and never raises to callers

2. Ensure audit row contract for `agent_action_log`:
- Required keys must always be present:
  - `event_id`, `timestamp`, `user_id`, `user_role`, `agent_name`
  - `tool_called`, `tool_inputs`, `tool_output_summary`
  - `recommendation_text`, `action_triggered`, `action_status`
  - `pii_masked`, `session_id`
- Keep `pii_masked=True` default for all rows
- Truncate large free-text fields defensively (for example summaries/recommendations)

3. Structured logging (Python `logging`):
- Use module logger for info/warn/error events
- Include contextual fields (`agent_name`, `tool_name`, `session_id`, `user_id` when available)
- Do not print stack traces directly unless via logger exception path

4. BigQuery write safety:
- Use existing `BigQueryClient` integration; do not hardcode project/dataset/table identifiers
- On insert failures, log error and continue (never bubble exceptions)
- If BigQuery client is unavailable, log warning and continue

5. Cloud Logging initialization safety:
- Keep Google Cloud Logging setup optional and failure-tolerant
- Never fail service startup due to Cloud Logging auth/init issues

6. Event ID and timestamp hygiene:
- Generate deterministic, collision-resistant `event_id` format per event type
- Use UTC ISO-8601 timestamps consistently

7. Backward compatibility:
- Do not break existing call sites in agents/tools
- Keep method signatures compatible unless strictly required by type safety

---

## Non-Goals

- Do not edit `backend/data/bigquery_client.py`
- Do not edit agent implementations in this task
- Do not add new infrastructure or schema files

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file backend/core/audit/logger.py
```

**Prompt to paste into Aider:**

```text
Implement TASK_27_audit_logger.md with minimal edits to backend/core/audit/logger.py only.

Requirements:
- Preserve existing async logging APIs: log_tool_call, log_agent_action, log_sensing_run.
- Enforce consistent agent_action_log row shape and safe defaults.
- Use structured python logging and remove direct print-based error handling.
- Never raise from audit methods; swallow/log errors and continue.
- Keep BigQuery and Cloud Logging initialization failure-tolerant.
- No hardcoded project/dataset/table config.
- Keep backward compatibility with current callers.
- No other file changes.
```

---

## Validation Steps

```bash
cd /home/appadmin/projects/Ram_Projects/Category_Analysis/backend
ruff check core/audit/logger.py
mypy core/audit/logger.py --ignore-missing-imports
python -m compileall core/audit/logger.py
```

---

## Definition of Done

- [x] `AuditLogger` methods are safe (no exception propagation)
- [x] Audit row payloads are consistent and complete
- [x] Structured logging is used for success/failure paths
- [x] BigQuery/Cloud Logging failures are handled gracefully
- [x] `ruff`, `mypy`, and `compileall` checks pass for logger module

---

*Task created: April 2026 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*
