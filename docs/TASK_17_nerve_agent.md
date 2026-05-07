# TASK_17_nerve_agent.md — Nerve Agent (Alert Routing + Dedup)

**Status:** ✅ DONE  
**Phase:** 3 — Agents  
**Prerequisite:** TASK_16 complete and validated  
**Assigned to:** Aider  
**Validated by:** Codex

---

## What to Build

Implement `NerveAgent` to consume normalized alert events and route each event to the correct analysis tool with urgency classification.

The agent must:
- Accept alert events from sensing flow
- Deduplicate repeated alerts within a 1-hour window using key `(sku_id, alert_type)`
- Map alert types to tool modules
- Write routing decisions to `agent_action_log`
- Return a routing result payload for downstream agents

Use env-driven config only (`.env.local`).

---

## Files to Create / Edit (Aider scope — ONLY these)

```
backend/agents/nerve_agent.py
backend/core/audit/logger.py
backend/data/bigquery_client.py
```

---

## Routing Rules

- `stockout_horizon` -> `inventory_analysis_tool` (`P1`)
- `overstock` -> `inventory_analysis_tool` (`P2`)
- `forecast_deviation` -> `forecast_accuracy_tool` (`P2`)
- `competitive_price` -> `competitive_intelligence_tool` (`P1`)
- `coop_expiry` -> `margin_intelligence_tool` (`P1`)
- Unknown alert type -> `digital_performance_tool` (`P3`)

---

## Dedup Rules

- Dedup window: 1 hour
- Dedup key: `sku_id + alert_type`
- If duplicate found inside window:
  - skip routing
  - return `{"routed": false, "reason": "duplicate_within_window"}`

Persist dedup state in-memory for now (placeholder) with clear TODO note for Redis/Firestore production backing.

---

## Routing Decision Contract

```json
{
  "event_id": "string",
  "timestamp": "ISO-8601",
  "agent_name": "NerveAgent",
  "routed": true,
  "urgency": "P1|P2|P3",
  "tool_name": "string",
  "reason": "string",
  "dedup_applied": true
}
```

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file backend/agents/nerve_agent.py \
  --file backend/core/audit/logger.py \
  --file backend/data/bigquery_client.py
```

**Prompt to paste into Aider:**

```text
Implement TASK_17_nerve_agent.md.

In backend/agents/nerve_agent.py:
- Build NerveAgent class with async route_alert(alert_event: dict, user_id: str = "system") -> dict.
- Apply exact alert_type -> tool routing rules from TASK_17.
- Implement in-memory dedup for 1 hour with key: sku_id + alert_type.
- Return routing decision payload as specified.
- Log structured events via logging module.

In backend/core/audit/logger.py:
- Add async log_nerve_routing(event_id, sku_id, alert_type, routed, tool_name, urgency, reason) method.
- Write rows to agent_action_log through existing BigQuery writer.
- Never raise exceptions from logging methods.

In backend/data/bigquery_client.py:
- Add helper (if needed) to read/write routing audit rows in a typed way without breaking existing methods.

Constraints:
- Full type hints.
- No hardcoded project IDs or dataset names.
- Minimal surgical edits.
```

---

## Validation Steps

```bash
python3 -m compileall backend
cd /home/appadmin/projects/Ram_Projects/Category_Analysis/backend && /home/appadmin/projects/Ram_Projects/Category_Analysis/.venv/bin/ruff check .
cd /home/appadmin/projects/Ram_Projects/Category_Analysis && python3 -c "import sys; sys.path.insert(0, '.'); from backend.agents.nerve_agent import NerveAgent; print('OK')"
```

---

## Definition of Done

- [ ] `NerveAgent.route_alert()` implemented and async
- [ ] Routing rules implemented exactly
- [ ] 1-hour dedup by `sku_id + alert_type` works
- [ ] Routing decision audit logging implemented (non-fatal)
- [ ] Compile, lint, and import checks pass

---

*Task created: April 2026 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*
