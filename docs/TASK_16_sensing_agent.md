# TASK_16_sensing_agent.md — Sensing Agent (Alert Detection + Pub/Sub)

**Status:** ✅ DONE  
**Phase:** 3 — Agents  
**Prerequisite:** TASK_15 complete and validated  
**Assigned to:** Aider  
**Validated by:** Codex

---

## What to Build

Implement `SensingAgent` to evaluate operational risk signals and publish normalized alert events.

The agent must:
- Read category risk signals from BigQuery
- Evaluate threshold rules for stockout, overstock, forecast deviation, competitor price gap, and co-op utilization
- Publish alert payloads to `PUBSUB_TOPIC_ALERTS`
- Return a summary report for API/ops visibility

Use env-driven config only (`.env.local`).

---

## Files to Create / Edit (Aider scope — ONLY these)

```
backend/agents/sensing_agent.py
backend/data/pubsub_client.py
backend/data/bigquery_client.py
backend/core/audit/logger.py
```

---

## Threshold Rules (must be explicit)

- `stockout_horizon_days < 14` -> `P1`
- `days_of_supply > 30` and `on_hand_units > 200` -> `P2`
- `abs(forecast_deviation_pct) > 0.15` -> `P2`
- `competitive_price_index > 1.07` -> `P1`
- `vendor_coop_utilisation < 0.50` and `days_to_coop_expiry < 30` -> `P1`

---

## Alert Event Contract

`SensingAgent` publishes one event per triggered SKU/store condition:

```json
{
  "event_id": "string",
  "timestamp": "ISO-8601",
  "agent_name": "SensingAgent",
  "priority": "P1|P2|P3",
  "alert_type": "stockout|overstock|forecast_deviation|competitive_gap|coop_risk",
  "sku_id": "string",
  "store_id": "string",
  "category": "string",
  "metric": "string",
  "metric_value": 0.0,
  "threshold": "string",
  "summary": "string"
}
```

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file backend/agents/sensing_agent.py \
  --file backend/data/pubsub_client.py \
  --file backend/data/bigquery_client.py \
  --file backend/core/audit/logger.py
```

**Prompt to paste into Aider:**

```text
Implement TASK_16_sensing_agent.md.

In backend/agents/sensing_agent.py:
- Create a SensingAgent class with async evaluate_and_publish() method.
- Query current status rows from BigQuery table:
  ctoteam.category_intelligence.sku_store_day_status_current
- Apply the threshold rules defined in TASK_16.
- Build normalized alert payloads and publish each to PUBSUB_TOPIC_ALERTS using PubSub client.
- Return summary: total_scanned, alerts_emitted, alerts_by_priority.

In backend/data/pubsub_client.py:
- Ensure a reusable async publish(topic_path, payload) method exists.
- Ensure alert topic path uses env-driven project/topic values.

In backend/data/bigquery_client.py:
- Add a helper query_current_status(limit: int = 1000) for sensing reads.

In backend/core/audit/logger.py:
- Log each sensing publish action as an agent action row (non-fatal on logging errors).

Constraints:
- Type hints required.
- Structured logging required.
- No hardcoded project IDs/topic names.
- Minimal surgical edits.
```

---

## Validation Steps

```bash
python3 -m compileall backend
cd backend && ruff check .
python3 - <<'PY'
from backend.agents.sensing_agent import SensingAgent
print("SensingAgent import OK:", SensingAgent.__name__)
PY
```

---

## Definition of Done

- [x] `SensingAgent.evaluate_and_publish()` exists and runs async
- [x] All threshold rules implemented exactly
- [x] Alert events publish to env-configured alert topic
- [x] BigQuery read path uses `sku_store_day_status_current`
- [x] Audit logger records sensing agent action
- [x] Backend compile and lint checks pass

---

*Task created: April 2026 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*
