# Changes Log

## Latest Delivered (Commit: 8cec927)

- Enabled BigQuery live overview flow.
- Fixed dataset/env routing consistency to `category_intelligence`.
- Added SerpAPI ingest trigger and feed run status endpoints in frontend API proxy:
  - `POST /api/feeds/prices`
  - `GET /api/feeds/prices/status`
- Added SKU-level action proxy endpoint:
  - `POST /api/action`
- Upgraded dashboard UI with:
  - Agent timeline panel
  - Refresh-now control
  - Feed run metadata display
  - Clickable SKU rows with detail drawer
  - Action buttons (`reprice`, `replenish`, `draft_coop_email`, `queue_campaign`)
  - Search/filter/sort/pagination
- Added practical operational runbook in `README.md`.

## Next Changes (Planned)

1. Agent Step Wiring
- Wire actual SSE agent phases (`think/act/analyze/respond`) from chat stream into the left control center and timeline.
- Show per-step timestamps and duration.

2. BigQuery-First at Scale
- Move from in-memory UI filtering to full server-side paging (`limit/offset`) and sorting in backend query.
- Add total-count endpoint for accurate page count.

3. Action Governance UX
- Add explicit success/fail badges for each action call in SKU drawer.
- Surface backend audit row IDs for traceability.

4. PowerBI-style Visuals
- Add charts for:
  - gap distribution
  - top risk SKUs
  - stock-risk buckets
  - refresh trend over time

5. Scheduled Refresh
- Add Cloud Scheduler/Cloud Run job instructions and status UI showing next run window.

## Test Checklist (Current Build)

### A) Service Startup

```bash
# Backend
cd /home/appadmin/projects/Ram_Projects/Category_Analysis/backend
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8001 --reload

# Frontend (new terminal)
cd /home/appadmin/projects/Ram_Projects/Category_Analysis/frontend
npm run dev -- --port 3001
```

### B) API Health + Ingest

```bash
curl -s http://localhost:8001/health
curl -s -X POST "http://localhost:8001/feeds/prices?limit=20"
curl -s http://localhost:8001/feeds/prices/status
```

Expected:
- `status: ok` from health
- `rows_written > 0` from feeds/prices
- latest run available from feeds/prices/status

### C) Overview Data Path

```bash
curl -s "http://localhost:8001/dashboard/overview?q=sony&stock=all"
curl -s "http://localhost:3001/api/dashboard/overview?q=sony&stock=all"
```

Expected:
- source should be `bigquery-live` (preferred) or `live-serpapi` fallback
- rows array should be non-empty after successful ingest

### D) UI Acceptance

- Open `http://localhost:3001`
- Click `Refresh Now` and verify timeline receives a new event
- Verify feed run metadata updates
- Click a SKU row and verify detail drawer opens
- Click each action button and verify response appears in drawer
- Verify search/filter/sort/paging interactions work

## Known Gaps

- Control center phase cards are not yet fully wired to real SSE step stream globally.
- Backend action handlers may still be mocked for some action types.
- Charts are not added yet (table-first view currently).
