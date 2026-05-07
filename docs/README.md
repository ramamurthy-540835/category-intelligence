# Category Intelligence Agent

Retail decision platform for `ctoteam` with:

- Next.js 14 App Router frontend on port `3005`
- FastAPI backend on port `8080`
- Vertex AI Gemini tool-driven intelligence loop
- BigQuery analytics + BigQuery ML forecast SQL
- Pub/Sub alerting and ingestion scaffolding
- Audit, RBAC, PII masking, and offline-first dashboard fallbacks

## Run

```bash
./start.sh
```

## Frontend

- `app/` contains the Next.js App Router UI and API route handlers
- `components/` contains chat, dashboard, loyalty, and governance components
- `lib/` contains typed metrics, SSE hook, API client, and RBAC helpers

## Backend

- `backend/` contains the FastAPI app, agents, tools, audit, and data access layers

## Verify

```bash
python3 -m compileall app
python3 -m compileall backend
```

