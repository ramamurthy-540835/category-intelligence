# Category Intelligence Agent

AI-powered retail analytics platform for **Best Buy Home Theater** (Q4 2024). Monitors competitive pricing, inventory health, and margin opportunities across the category using live Google Shopping data and BigQuery analytics.

**Live:** https://category-intelligence-frontend-1035117862188.us-central1.run.app

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Google Cloud (ctoteam)                       │
│                                                                     │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────────┐  │
│  │   Frontend    │───▶│     Backend      │───▶│    BigQuery       │  │
│  │   Next.js 14  │    │     FastAPI      │    │ category_         │  │
│  │   Cloud Run   │    │     Cloud Run    │    │ intelligence      │  │
│  │   Port 3000   │    │     Port 8080    │    │                   │  │
│  └──────────────┘    └───────┬──────────┘    └───────────────────┘  │
│                              │                                      │
│                    ┌─────────┼─────────┐                            │
│                    ▼         ▼         ▼                            │
│              ┌──────────┐ ┌──────┐ ┌────────┐                      │
│              │ SerpAPI  │ │Vertex│ │Pub/Sub │                      │
│              │ Google   │ │  AI  │ │ Alerts │                      │
│              │ Shopping │ │Gemini│ │        │                      │
│              └──────────┘ └──────┘ └────────┘                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | Next.js 14 (App Router), Tailwind   |
| Backend  | FastAPI, Python 3.11+               |
| Database | BigQuery                            |
| AI/ML    | Vertex AI (Gemini 2.5 Flash)        |
| Pricing  | SerpAPI (Google Shopping)            |
| Infra    | Cloud Run, Cloud Build, Pub/Sub     |

---

## BigQuery Dataset & Schema

**GCP Project:** `ctoteam`
**Dataset:** `category_intelligence`

### Tables

#### 1. `sku_master` — SKU Catalog

The master product catalog. Source of truth for SKU names and internal pricing.

| Column        | Type    | Description                    |
|---------------|---------|--------------------------------|
| `sku_id`      | STRING  | Unique SKU identifier          |
| `sku_name`    | STRING  | Product display name           |
| `our_price`   | FLOAT64 | Internal/retail price          |
| `active_flag` | BOOL    | Whether SKU is actively tracked|
| `last_seen`   | TIMESTAMP | Last discovery/update time   |

#### 2. `competitor_price_snapshots` — Live Market Prices

Stores competitor pricing snapshots fetched from Google Shopping via SerpAPI.

| Column             | Type    | Description                              |
|--------------------|---------|------------------------------------------|
| `sku_id`           | STRING  | References `sku_master.sku_id`           |
| `sku_name`         | STRING  | Product name at time of snapshot         |
| `retailer_price`   | FLOAT64 | Our price at snapshot time               |
| `competitor_price` | FLOAT64 | Competitor's listed price                |
| `price_gap_pct`    | FLOAT64 | `(our - competitor) / our * 100`         |
| `competitor_name`  | STRING  | Source retailer (e.g., "Google Shopping")|
| `in_stock`         | BOOL    | Stock availability flag                  |
| `snapshot_time`    | STRING  | ISO timestamp of the snapshot            |
| `product_url`      | STRING  | Link to competitor listing               |
| `image_url`        | STRING  | Product thumbnail URL                    |
| `search_query_used`| STRING  | SerpAPI query that matched this product  |
| `last_checked`     | STRING  | ISO timestamp of last price check        |

#### 3. `competitor_price_feed_runs` — Feed Run History

Tracks metadata for each price-feed execution.

| Column         | Type   | Description                     |
|----------------|--------|---------------------------------|
| `run_id`       | STRING | Unique run identifier (UUID)    |
| `timestamp`    | STRING | When the run executed           |
| `skus_fetched` | INT64  | Number of SKUs processed        |
| `rows_written` | INT64  | Rows successfully written to BQ |
| `status`       | STRING | `success`, `partial`, or `error`|

#### 4. `feed_run_events` — Pipeline Event Log

Granular event log for observability into each feed run's pipeline stages.

| Column                 | Type   | Description                          |
|------------------------|--------|--------------------------------------|
| `run_id`               | STRING | References the parent feed run       |
| `timestamp`            | STRING | Event timestamp                      |
| `stage`                | STRING | Pipeline stage (see stages below)    |
| `status`               | STRING | `RUNNING`, `SUCCESS`, `ERROR`, etc.  |
| `message`              | STRING | Human-readable event description     |
| `error_type`           | STRING | Error classification (if applicable) |
| `fix`                  | STRING | Suggested remediation                |
| `requested_skus`       | INT64  | SKUs requested in this run           |
| `active_skus`          | INT64  | Active SKUs found in catalog         |
| `processed_rows`       | INT64  | Rows processed                       |
| `written_rows`         | INT64  | Rows written to BigQuery             |
| `snapshot_rows`        | INT64  | Final snapshot row count             |
| `external_source_status`| STRING | SerpAPI connectivity status         |

**Pipeline stages:** `SENSING` > `FETCHING` > `ENRICHING` > `PROCESSING` > `ANALYZING` > `UPDATING` > `RESPONDING` > `COMPLETE`

#### 5. `sku_store_day_status_current` — Store-Level Status

Current store-level SKU status (queried via `SELECT *`).

---

## AI Agent System

The backend runs a multi-agent architecture with 10 intelligence tools:

```
IntegrationAgent (orchestrator)
├── IntelligenceAgent (keyword router + tool dispatcher)
│   ├── get_competitive_pricing    ← BigQuery-live
│   ├── get_margin_intelligence    ← BigQuery-live
│   ├── get_inventory_analysis     ← BigQuery-live
│   ├── get_promo_effectiveness    ← stub
│   ├── get_forecast_accuracy      ← stub
│   ├── get_attach_rate_analysis   ← stub
│   ├── get_assortment_planning    ← stub
│   ├── get_digital_performance    ← stub
│   ├── get_demand_intent          ← stub
│   └── get_gen_z_interest         ← stub
├── SensingAgent
└── NerveAgent
```

**Live tools** query BigQuery in real time. **Stub tools** return static placeholders (ready for wiring).

---

## API Endpoints

| Method | Path                      | Description                          |
|--------|---------------------------|--------------------------------------|
| GET    | `/health`                 | Health check + environment validation|
| POST   | `/agent/chat`             | SSE-streamed AI chat                 |
| POST   | `/agent/sensing-cycle`    | Trigger sensing agent cycle          |
| POST   | `/agent/action`           | Trigger agent action                 |
| GET    | `/agent/status`           | Agent config + pipeline status       |
| GET    | `/agent/events?run_id=`   | Event log for a specific run         |
| POST   | `/feeds/prices`           | Run competitor price feed            |
| GET    | `/feeds/prices/status`    | Latest feed run status               |
| GET    | `/feeds/prices/latest`    | Latest price snapshot data           |
| GET    | `/dashboard/{tab}`        | Dashboard data (overview, inventory, etc.) |
| POST   | `/bq/query`               | Ad-hoc read-only BigQuery explorer   |
| POST   | `/bq/update`              | Allowlisted SKU master updates       |

---

## External Data Sources

**SerpAPI / Google Shopping** fetches live competitor prices using two strategies:

1. **Catalog refresh** — looks up each active SKU from `sku_master` on Google Shopping
2. **Discovery** — searches seed queries to find new products in the category:
   - Sony OLED TV 65", Samsung QLED TV 55", LG OLED TV 77"
   - TCL mini LED TV 75", Hisense ULED TV 65"
   - Vizio, Samsung, Sonos, Bose soundbars
   - Chromecast streaming device

Discovered products are auto-merged into `sku_master` with `GS-<product_id>` SKU IDs.

---

## Environment Variables

| Variable                        | Required | Default                                          |
|---------------------------------|----------|--------------------------------------------------|
| `GCP_PROJECT_ID`                | Yes      | —                                                |
| `GOOGLE_CLOUD_PROJECT`          | Fallback | — (used if `GCP_PROJECT_ID` not set)             |
| `BIGQUERY_DATASET`              | Yes      | `category_intelligence`                          |
| `SKU_MASTER_TABLE`              | Yes      | `{project}.category_intelligence.sku_master`     |
| `SERPAPI_KEY`                    | Yes      | — (stored in Secret Manager for Cloud Run)       |
| `VERTEX_MODEL`                  | Yes      | `gemini-2.5-flash`                               |
| `VERTEX_AI_LOCATION`            | Yes      | `us-central1`                                    |
| `PUBSUB_TOPIC_ALERTS`           | No       | `alerts`                                         |
| `GOOGLE_APPLICATION_CREDENTIALS`| Local    | — (not needed on Cloud Run with service account) |

---

## Local Development

### Prerequisites

- Python 3.11+
- Node.js 18+
- GCP credentials (`gcloud auth application-default login`)
- SerpAPI key

### Quick Start

```bash
# 1. Clone and enter the repo
git clone https://github.com/ramamurthy-540835/category-intelligence.git
cd category-intelligence

# 2. Create .env.local at repo root
cat > .env.local <<EOF
GCP_PROJECT_ID=ctoteam
BIGQUERY_DATASET=category_intelligence
SKU_MASTER_TABLE=ctoteam.category_intelligence.sku_master
SERPAPI_KEY=your-serpapi-key
VERTEX_MODEL=gemini-2.5-flash
VERTEX_AI_LOCATION=us-central1
EOF

# 3. Set up Python environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# 4. Start both services
./scripts/start.sh
```

Default ports: **Backend** on `8005`, **Frontend** on `3005`.

Custom ports: `./scripts/start.sh 8006 3006`

Stop: `./scripts/start.sh --kill-only` or `Ctrl+C`

---

## Deployment

Both services deploy to **Cloud Run** in `us-central1` via Cloud Build.

```bash
# Full stack (backend first, then frontend with backend URL injected)
gcloud builds submit --config=cloudbuild.yaml

# Frontend only (uses hardcoded backend URL)
gcloud builds submit --config=frontend-cloudbuild.yaml
```

**Service account:** `category-intelligence-sa@ctoteam.iam.gserviceaccount.com`

### Cloud Run Services

| Service                             | Port | CPU | Memory |
|-------------------------------------|------|-----|--------|
| `category-intelligence-backend`     | 8080 | 2   | 2Gi    |
| `category-intelligence-frontend`    | 3000 | 1   | 1Gi    |

---

## Project Structure

```
category-intelligence/
├── backend/
│   ├── main.py                  # FastAPI app, all API endpoints
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── agents/
│   │   ├── intelligence_agent.py  # Tool router + BQ queries + SSE streaming
│   │   ├── integration_agent.py   # Orchestrator agent
│   │   ├── sensing_agent.py       # Sensing cycle agent
│   │   └── nerve_agent.py         # Alert/nerve agent
│   ├── data/
│   │   ├── bigquery_client.py     # BigQuery connection + query helper
│   │   ├── external_feeds.py      # SerpAPI competitor price feed
│   │   └── pubsub_client.py       # Pub/Sub alert publisher
│   ├── tools/                     # Tool class stubs (per-tool files)
│   ├── schemas/api.py             # Pydantic request models
│   ├── core/                      # Auth, RBAC, audit
│   └── tests/
├── frontend/
│   ├── app/                       # Next.js App Router pages + API routes
│   ├── components/                # React components (chat, dashboard, etc.)
│   ├── lib/                       # API client, SSE hook, RBAC, metrics
│   ├── package.json
│   └── Dockerfile
├── scripts/
│   └── start.sh                   # Local dev startup script
├── docs/                          # Task documentation
├── cloudbuild.yaml                # Full-stack Cloud Build config
└── frontend-cloudbuild.yaml       # Frontend-only Cloud Build config
```

---

## Security & Governance

- **RBAC** — role-based access control on agent actions
- **PII masking** — data sanitization layer
- **Audit logging** — tracks agent tool calls, user sessions, and recommendations
- **Read-only BQ explorer** — `/bq/query` blocks `DELETE`, `UPDATE`, `INSERT`, `DROP`, etc.
- **Allowlisted updates** — `/bq/update` only permits `our_price` and `sku_name` on `sku_master`
- **Parameterized queries** — all BigQuery queries use parameterized inputs
