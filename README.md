# Category Intelligence (ctoteam)

Live Category Intelligence dashboard with:
- SerpAPI competitor pricing ingest
- BigQuery-backed category overview
- Agent flow UI and SKU-level action controls

## Current Architecture

- `backend/` FastAPI service (`:8001`)
- `frontend/` Next.js app (`:3001`)
- BigQuery dataset: `ctoteam.category_intelligence`
- SerpAPI feed writes to `competitor_price_snapshots`

## Required BigQuery Tables

- `sku_master`
- `competitor_price_snapshots`
- `competitor_price_feed_runs`

## Environment (Single Source)

Use root `.env.local` as source of truth, then copy to backend/frontend when needed.

Required keys:

```env
GCP_PROJECT_ID=ctoteam
BIGQUERY_DATASET=category_intelligence
SKU_MASTER_TABLE=ctoteam.category_intelligence.sku_master
BACKEND_URL=http://127.0.0.1:8001
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8001
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8001
SERPAPI_KEY=...
```

## Start Services

Backend:

```bash
cd backend
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

Frontend:

```bash
cd frontend
npm run dev -- --port 3001
```

## Live Data Test Flow

1. Trigger SerpAPI refresh:

```bash
curl -s -X POST "http://localhost:8001/feeds/prices?limit=20"
```

2. Check ingest status:

```bash
curl -s "http://localhost:8001/feeds/prices/status"
```

3. Check backend overview:

```bash
curl -s "http://localhost:8001/dashboard/overview?q=sony&stock=all"
```

4. Check frontend proxy overview:

```bash
curl -s "http://localhost:3001/api/dashboard/overview?q=sony&stock=all"
```

Expected:
- `source` should be `bigquery-live` (or `live-serpapi` fallback)
- `rows` should be non-zero after successful ingest

## UI Features (Phase 1)

- Live pricing table with search/sort/filter/paging
- SKU click drawer
- Action buttons (`reprice`, `replenish`, `draft_coop_email`, `queue_campaign`)
- Refresh-now control and ingest run status
- Agent timeline panel

## Troubleshooting

- `source: fallback` in frontend but backend is live:
  - restart Next.js server after env changes
  - ensure `BACKEND_URL` points to `127.0.0.1:8001`

- `rows_written: 0`:
  - check backend logs for SerpAPI empty results or BigQuery schema mismatch

- Missing BigQuery tables:
  - create `competitor_price_feed_runs`
  - ensure `sku_master` has active SKUs
