# AGENTS.md — Category Intelligence Agent (ctoteam)
## Master Control File for Codex + Aider Workflow

---

## AGENT ROLES

| Agent | Role | Invocation |
|---|---|---|
| **Codex** | Planner, task decomposer, file creator, validator | `codex` (interactive shell) |
| **Aider** | Code executor, file editor, implementation | `aider --model gemini/gemini-3.1-pro-preview` |

### Rules for Codex (Planner)
- Codex NEVER writes production code directly — it creates task files and delegates to Aider
- Codex reads existing files before creating tasks (`read` then `plan` then `delegate`)
- Codex validates after every Aider run: `tsc --noEmit` and `ruff check .`
- Codex creates one `.md` task file per logical unit of work (not per file)
- Codex must confirm a task is DONE before starting the next one

### Rules for Aider (Executor)
- Aider always runs with `--model gemini/gemini-3.1-pro-preview --env-file .env.local`
- Aider edits ONLY the files listed in the task file — no scope creep
- Aider makes minimal, surgical edits — do not rewrite files that are not broken
- Aider must not touch `.env.local`, `infra/`, or `docs/` unless explicitly listed
- Every Aider run ends with a summary of changed lines

### Approved auto-run pattern (Codex uses this)
```
aider --model gemini/gemini-3.1-pro-preview --env-file .env.local --file <file1> --file <file2>
```

---

## PROJECT CONSTANTS

```
GCP_PROJECT_ID=ctoteam
GCP_REGION=us-central1
BIGQUERY_DATASET=category_intelligence
VERTEX_MODEL=gemini-3.1-pro-preview
VERTEX_AI_LOCATION=us-central1
PUBSUB_TOPIC_EVENTS=cat-intel-events
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
```

---

## BUILD ORDER (strict sequence — do not skip)

```
Phase 1 — Foundation
  TASK_01_metric_spine.md         → lib/metrics/spine.ts + core/metrics/spine.py
  TASK_02_bigquery_schema.md      → infra/bigquery/schema/*.json + BQ tables
  TASK_03_bq_client.md            → backend/data/bigquery_client.py

Phase 2 — Tools
  TASK_04_base_tool.md            → backend/tools/base_tool.py
  TASK_05_inventory_tool.md       → backend/tools/inventory_analysis.py
  TASK_06_margin_tool.md          → backend/tools/margin_intelligence.py
  TASK_07_promo_tool.md           → backend/tools/promo_effectiveness.py
  TASK_08_attach_tool.md          → backend/tools/attach_rate_analysis.py
  TASK_09_forecast_tool.md        → backend/tools/forecast_accuracy.py
  TASK_10_competitive_tool.md     → backend/tools/competitive_intelligence.py
  TASK_11_digital_tool.md         → backend/tools/digital_performance.py
  TASK_12_assortment_tool.md      → backend/tools/assortment_planning.py
  TASK_13_genz_tool.md            → backend/tools/gen_z_interest.py  ← NEW
  TASK_14_demand_intent_tool.md   → backend/tools/demand_intent.py   ← NEW

Phase 3 — Agents
  TASK_15_intelligence_agent.md   → backend/agents/intelligence_agent.py
  TASK_16_sensing_agent.md        → backend/agents/sensing_agent.py
  TASK_17_nerve_agent.md          → backend/agents/nerve_agent.py
  TASK_18_integration_agent.md    → backend/agents/integration_agent.py

Phase 4 — API + Frontend
  TASK_19_fastapi_main.md         → backend/main.py
  TASK_20_sse_hook.md             → lib/sse/useSSE.ts
  TASK_21_chat_route.md           → app/api/chat/route.ts
  TASK_22_dashboard_routes.md     → app/api/dashboard/[tab]/route.ts
  TASK_23_agent_control.md        → components/chat/AgentControlCenter.tsx
  TASK_24_chat_interface.md       → components/chat/ChatInterface.tsx
  TASK_25_kpi_cards.md            → components/dashboard/KPICard.tsx
  TASK_26_genz_panel.md           → components/loyalty/GenZAffinityPanel.tsx ← NEW

Phase 5 — Governance
  TASK_27_audit_logger.md         → backend/core/audit/logger.py
  TASK_28_rbac.md                 → backend/core/auth/rbac.py + lib/auth/rbac.ts
  TASK_29_pii_masking.md          → backend/core/pii/masker.py

Phase 6 — Tests
  TASK_30_tool_tests.md           → backend/tests/test_tools.py
  TASK_31_agent_tests.md          → backend/tests/test_agents.py
```

---

## VALIDATION STEPS (run after every Aider task)

### Frontend (TypeScript)
```bash
cd /home/appadmin/projects/Ram_Projects/Category_Analysis
npx tsc --noEmit
npx eslint app/ components/ lib/ --ext .ts,.tsx --max-warnings 0
```

### Backend (Python)
```bash
cd backend
ruff check .
mypy . --ignore-missing-imports
python -m pytest tests/ -v
```

### Integration check
```bash
# Backend health
curl http://localhost:8080/health

# Agent chat (smoke test)
curl -X POST http://localhost:8080/agent/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Identity: test-user" \
  -d '{"message": "Give me a category overview", "session_id": "smoke-test-001"}'
```

---

## CODEX SESSION STARTUP INSTRUCTIONS

When starting a new Codex session, say:

```
Read AGENTS.md and the most recently completed task file.
Tell me which phase we are in, which task is next, and what files Aider needs to edit.
Do not write any code. Create the next task file only.
```

---

## COMMON FIXES CODEX SHOULD KNOW

| Error | Fix |
|---|---|
| `crypto.randomUUID is not a function` | Use `createSessionId()` helper with globalThis fallback |
| `Module not found: lib/metrics/spine` | Check tsconfig paths; ensure `@/` alias is set in next.config.ts |
| `vertexai init fails` | Check `GOOGLE_APPLICATION_CREDENTIALS` env var points to service account JSON |
| `BigQuery 403` | Check service account has `roles/bigquery.dataViewer` on `ctoteam` dataset |
| `SSE stream drops` | Add `Connection: keep-alive` and `X-Accel-Buffering: no` headers in FastAPI response |
| `aider exits immediately` | Add `--no-auto-commits` flag; check `.env.local` is present |
