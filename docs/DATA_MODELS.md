# Data Models & Schemas

Complete reference for all data models, BigQuery table schemas, API contracts, and type definitions used in the Category Intelligence platform.

---

## BigQuery Tables

**Project:** `ctoteam`  
**Dataset:** `category_intelligence`

### 1. `sku_master` — Product Catalog

Source of truth for all tracked SKUs. Updated via `/bq/update` (allowlisted fields only) and auto-expanded by the discovery feed.

```sql
CREATE TABLE IF NOT EXISTS `ctoteam.category_intelligence.sku_master` (
  sku_id         STRING    NOT NULL,   -- Unique ID. Discovered products: "GS-<product_id>"
  sku_name       STRING    NOT NULL,   -- Product display name
  our_price      FLOAT64,              -- Internal / retail price
  retailer_price FLOAT64,              -- Alias used in some queries (same as our_price)
  active_flag    BOOL      DEFAULT TRUE,
  last_seen      TIMESTAMP             -- Last discovery or update time
);
```

**Access patterns:**
- `intelligence_agent.py` — joins with snapshots for pricing/margin/inventory queries
- `external_feeds.py` — reads active SKUs for catalog refresh; inserts discovered SKUs
- `main.py` — `/bq/update` allows writes to `our_price` and `sku_name` only

---

### 2. `competitor_price_snapshots` — Market Price Data

Point-in-time competitor pricing from Google Shopping via SerpAPI. One row per SKU per competitor per snapshot.

```sql
CREATE TABLE IF NOT EXISTS `ctoteam.category_intelligence.competitor_price_snapshots` (
  sku_id              STRING    NOT NULL,   -- FK → sku_master.sku_id
  sku_name            STRING,               -- Product name at snapshot time
  retailer_price      FLOAT64,              -- Our price at snapshot time
  competitor_price    FLOAT64,              -- Competitor listed price
  price_gap_pct       FLOAT64,              -- (our - competitor) / our * 100
  competitor_name     STRING,               -- Source retailer (e.g. "Google Shopping")
  in_stock            BOOL,                 -- Competitor stock availability
  snapshot_time       STRING,               -- ISO 8601 timestamp of the snapshot batch
  product_url         STRING,               -- Link to competitor product listing
  image_url           STRING,               -- Product thumbnail URL
  search_query_used   STRING,               -- SerpAPI query that matched this product
  last_checked        STRING                -- ISO 8601 timestamp of last check
);
```

**Access patterns:**
- `intelligence_agent.py` — competitive pricing & margin queries (joined with `sku_master`, deduplicated via `QUALIFY ROW_NUMBER()`)
- `main.py` — `/feeds/prices/latest` returns latest snapshot batch; `/dashboard/overview` powers the main grid
- `external_feeds.py` — streaming inserts after each feed run

---

### 3. `competitor_price_feed_runs` — Feed Execution Log

One row per price-feed execution. Tracks success/failure and volume.

```sql
CREATE TABLE IF NOT EXISTS `ctoteam.category_intelligence.competitor_price_feed_runs` (
  run_id        STRING  NOT NULL,   -- UUID v4
  timestamp     STRING,             -- ISO 8601 execution time
  skus_fetched  INT64,              -- Number of SKUs processed
  rows_written  INT64,              -- Rows written to competitor_price_snapshots
  status        STRING              -- "success" | "partial" | "error"
);
```

**Access patterns:**
- `main.py` — `/feeds/prices/status` returns latest run ordered by timestamp DESC
- `external_feeds.py` — inserts run metadata after completion

---

### 4. `feed_run_events` — Pipeline Event Log

Granular event log for observability. Each feed run emits events as it progresses through pipeline stages.

```sql
CREATE TABLE IF NOT EXISTS `ctoteam.category_intelligence.feed_run_events` (
  run_id                  STRING  NOT NULL,   -- FK → competitor_price_feed_runs.run_id
  timestamp               STRING,             -- ISO 8601 event time
  stage                   STRING,             -- Pipeline stage (see enum below)
  status                  STRING,             -- "RUNNING" | "SUCCESS" | "ERROR" | "WARNING" | "FAILED"
  message                 STRING,             -- Human-readable event description
  error_type              STRING,             -- Error classification (nullable)
  fix                     STRING,             -- Suggested remediation (nullable)
  requested_skus          INT64,              -- SKUs requested in this run
  active_skus             INT64,              -- Active SKUs found in catalog
  processed_rows          INT64,              -- Rows processed so far
  written_rows            INT64,              -- Rows written to BigQuery
  snapshot_rows           INT64,              -- Final snapshot row count
  external_source_status  STRING              -- SerpAPI connectivity status
);
```

**Pipeline stages (enum):**
```
SENSING → FETCHING → ENRICHING → PROCESSING → ANALYZING → UPDATING → RESPONDING → COMPLETE
                                                                                    ↘ ERROR
```

---

### 5. `agent_action_log` — Audit Trail

Captures all agent tool calls, actions, and sensing runs for compliance and debugging.

```sql
CREATE TABLE IF NOT EXISTS `ctoteam.category_intelligence.agent_action_log` (
  -- Common fields
  event_type            STRING,   -- "tool_call" | "agent_action" | "sensing_run"
  
  -- tool_call events
  tool_name             STRING,
  inputs                STRING,   -- Stringified JSON of tool inputs
  output_summary        STRING,
  
  -- agent_action events
  agent_name            STRING,
  tool_calls_summary    STRING,
  recommendation_text   STRING,
  
  -- sensing_run events
  total_scanned         INT64,
  alerts_emitted        INT64,
  alerts_by_priority    STRING,   -- Stringified JSON {"high": N, "medium": N, ...}
  
  -- Session context
  user_id               STRING,
  session_id            STRING,
  user_role             STRING
);
```

---

### 6. `sku_store_day_status_current` — Store-Level Status

Current store-level SKU status. Schema inferred at query time (queried via `SELECT *`).

---

## Entity Relationships

```
┌──────────────┐          ┌──────────────────────────────┐
│  sku_master   │─────1:N──│  competitor_price_snapshots   │
│              │          │  (FK: sku_id)                │
└──────────────┘          └──────────────────────────────┘

┌──────────────────────────┐       ┌─────────────────┐
│  competitor_price_feed_   │──1:N──│  feed_run_events │
│  runs                    │       │  (FK: run_id)    │
│  (run_id = UUID)         │       └─────────────────┘
└──────────────────────────┘

┌──────────────────┐
│ agent_action_log  │   (standalone — no FK, append-only audit)
└──────────────────┘
```

---

## API Request / Response Models

### Pydantic Models (Backend)

```python
# backend/schemas/api.py

class ChatRequest(BaseModel):
    message: str          # User's natural-language query
    session_id: str       # Client-generated session UUID
    user_id: str          # User identifier
    user_role: str        # "viewer" | "analyst" | "manager" | "admin"

class ActionRequest(BaseModel):
    action_type: str      # "reprice" | "replenish" | "draft_coop_email" | "queue_campaign"
    payload: Dict[str, Any]
    user_id: str
    user_role: str
```

### Agent SSE Stream Events

The `/agent/chat` endpoint returns a `text/event-stream` with JSON events:

```typescript
// Each SSE data line
{
  "step": "think" | "act" | "analyze" | "respond" | "respond_chunk" | "done" | "error",
  "content": string
}
```

---

## Frontend TypeScript Types

### SSE / Agent Stream

```typescript
// frontend/lib/sse/useSSE.ts

type AgentStep = 'think' | 'act' | 'analyze' | 'respond' | 'respond_chunk' | 'done' | 'error';
type Status    = 'idle' | 'thinking' | 'acting' | 'analyzing' | 'responding' | 'done' | 'error';

interface StepEvent {
  step: AgentStep;
  content: string;
}

// useAgentStream() hook return type
interface AgentStream {
  steps: StepEvent[];
  finalResponse: string;
  isStreaming: boolean;
  status: Status;
  error: string | null;
  sendMessage(message: string, sessionId: string): Promise<void>;
}
```

### RBAC

```typescript
// frontend/lib/auth/rbac.ts

type UserRole   = 'viewer' | 'analyst' | 'manager';
type Permission = 'read_kpis' | 'run_diagnosis' | 'run_simulation'
                | 'trigger_action' | 'export' | 'manage_campaigns';

const ROLE_PERMISSIONS: Record<UserRole, Set<Permission>> = {
  viewer:  new Set(['read_kpis']),
  analyst: new Set(['read_kpis', 'run_diagnosis', 'run_simulation']),
  manager: new Set(['read_kpis', 'run_diagnosis', 'run_simulation',
                    'trigger_action', 'export', 'manage_campaigns'])
};
```

---

## Intelligence Tool Schemas

Each tool is registered with a JSON Schema for input validation and an output contract.

### Live Tools (BigQuery-backed)

#### `get_competitive_pricing`

```
Input:  {} (no parameters)
Output: {
  source:    "bigquery",
  table:     "competitor_price_snapshots JOIN sku_master",
  row_count: int,
  data: [{
    sku_id:        string,
    sku_name:      string,
    our_price:     float,
    market_price:  float,    -- competitor_price
    price_gap_pct: float,
    stock_status:  string,   -- "In Stock" | "Out of Stock"
    snapshot_time: string
  }]
}
```

**SQL logic:** Joins `competitor_price_snapshots` with `sku_master`, filters to latest snapshot, deduplicates via `QUALIFY ROW_NUMBER() OVER (PARTITION BY sku_id ORDER BY snapshot_time DESC)`, applies like-for-like filter (`competitor_price BETWEEN our_price * 0.5 AND our_price * 1.5`), orders by `price_gap_pct DESC`.

#### `get_margin_intelligence`

```
Input:  { "sku": string (optional) }
Output: {
  source:    "bigquery",
  table:     "competitor_price_snapshots JOIN sku_master",
  note:      string,
  row_count: int,
  data: [{
    sku_id:        string,
    sku_name:      string,
    our_price:     float,
    market_price:  float,
    price_gap_abs: float,    -- our_price - competitor_price
    price_gap_pct: float
  }]
}
```

**SQL logic:** Same join as competitive pricing but filters for `price_gap_pct < 0` (we are cheaper than market = margin expansion opportunity).

#### `get_inventory_analysis`

```
Input:  { "sku": string (optional) }
Output: {
  source:    "bigquery",
  table:     "sku_master",
  note:      string,
  row_count: int,
  data: [{
    sku_id:      string,
    sku_name:    string,
    active_flag: bool
  }]
}
```

### Stub Tools (Static Placeholders)

| Tool                          | Input Schema                              | Status |
|-------------------------------|-------------------------------------------|--------|
| `get_promo_effectiveness`     | `{ campaign_id: string }`                 | Stub   |
| `get_forecast_accuracy`       | `{ sku: string }`                         | Stub   |
| `get_attach_rate_analysis`    | `{ sku: string }`                         | Stub   |
| `get_assortment_planning`     | `{ category: string }`                    | Stub   |
| `get_digital_performance`     | `{ sku: string }`                         | Stub   |
| `get_competitive_intelligence`| `{ sku: string }`                         | Stub   |
| `get_demand_intent`           | `{}`                                      | Stub   |
| `get_gen_z_interest`          | `{}`                                      | Stub   |

#### `get_demand_intent` (Stub Response)

```json
{
  "top_search_queries": [...],
  "sku_funnel_diagnostics": [...],
  "market_basket_top_pairs": [...],
  "share_of_search": [...]
}
```

#### `get_gen_z_interest` (Stub Response)

```json
{
  "affinity_score_by_sku": [...],
  "trending_search_terms": [...],
  "funnel_by_cohort": [...],
  "market_basket_gen_z": [...],
  "discovery_channel_mix": [...],
  "recommendations": [...]
}
```

---

## Metric Spine

Canonical metric definitions shared between backend and frontend. Used by the AI agent for consistent KPI interpretation.

```
┌────────────────────────────┬──────────────────────────────────────────────────────┐
│ Metric                     │ Formula                                              │
├────────────────────────────┼──────────────────────────────────────────────────────┤
│ revenue_vs_plan            │ actual_net_revenue / planned_revenue - 1             │
│ avg_margin_pct             │ (net_revenue - cogs - vendor_coop) / net_revenue     │
│ inventory_health_score     │ composite 0-100: DoS, in_stock_pct,                 │
│                            │   overstock_risk, stockout_horizon                   │
│ days_of_supply             │ on_hand_units / avg_daily_sales_13w                  │
│ forecast_accuracy          │ 1 - abs(actual - forecast) / forecast                │
│ forecast_bias              │ mean(actual - forecast) / mean(forecast)             │
│ promo_roas                 │ incremental_revenue / promo_spend                    │
│ competitive_price_index    │ retailer_price / lowest_competitor_price             │
│ margin_at_risk             │ units_at_risk * (current_price - competitor_price)   │
│                            │   * margin_pct                                       │
│ vendor_coop_utilisation    │ spent_coop / approved_coop_budget                    │
│ attach_rate                │ companion_units / primary_units                      │
│ gen_z_affinity_score       │ visits*0.25 + conversion*0.25 + repeat*0.2           │
│                            │   + social*0.15 + bopis*0.15                         │
└────────────────────────────┴──────────────────────────────────────────────────────┘
```

**Source files:** `backend/core/metrics/spine.py`, `frontend/lib/metrics/spine.ts`

---

## External Data Contracts

### SerpAPI → CompetitorPriceFeed

Raw Google Shopping response is normalized into this structure before BigQuery insert:

```python
{
  "sku_id":             str,    # Matched from sku_master or generated as "GS-<product_id>"
  "sku_name":           str,    # Product title from Google Shopping
  "retailer_price":     float,  # Our price (from sku_master.our_price)
  "competitor_price":   float,  # Extracted price from shopping result
  "price_gap_pct":      float,  # Computed: (our - competitor) / our * 100
  "competitor_name":    str,    # "Google Shopping"
  "search_query_used":  str,    # The query sent to SerpAPI
  "product_url":        str,    # Link to product on retailer site
  "image_url":          str,    # Thumbnail URL
  "in_stock":           bool,   # Availability flag
  "last_checked":       str     # ISO 8601 timestamp
}
```

### Pub/Sub Alert Message

```python
Topic:   projects/{GCP_PROJECT_ID}/topics/{PUBSUB_TOPIC_ALERTS}
Payload: Dict[str, Any]   # Flexible schema — currently { "alert": str }
```

---

## Action Type Registry

Supported agent actions dispatched via `/agent/action`:

| `action_type`       | Response Message                     | Required Permission |
|---------------------|--------------------------------------|---------------------|
| `reprice`           | "Reprice recommendation queued"      | `trigger_action`    |
| `replenish`         | "Replenishment workflow queued"      | `trigger_action`    |
| `draft_coop_email`  | "Co-op draft generated"             | `trigger_action`    |
| `queue_campaign`    | "Campaign task queued"              | `manage_campaigns`  |

---

## PII Masking Rules

Applied to all agent responses before delivery. Defined in `backend/core/pii/masker.py`.

| Pattern        | Replacement   |
|----------------|---------------|
| Email regex    | `[REDACTED]`  |
| Phone regex    | `[REDACTED]`  |

**Sensitive key tokens** (masked when found as dict keys):  
`customer`, `loyalty`, `member`, `email`, `phone`, `name`, `id`, `address`, `dob`, `ssn`

---

## BigQuery Connection

```python
# backend/data/bigquery_client.py

from google.cloud import bigquery
from google.auth import default

credentials, project = default()
client = bigquery.Client(credentials=credentials, project=PROJECT_ID)

# Parameterized query execution
job_config = bigquery.QueryJobConfig(
    query_parameters=[
        bigquery.ScalarQueryParameter(name, type, value)
        # Supported types: STRING, INT64, FLOAT64, BOOL
    ]
)
results = client.query(sql, job_config=job_config).result()

# Streaming inserts
client.insert_rows_json(table_ref, rows)
```

**Environment-driven config:**

| Variable             | Used For                              | Default                          |
|----------------------|---------------------------------------|----------------------------------|
| `GCP_PROJECT_ID`     | BigQuery project                      | —                                |
| `BIGQUERY_DATASET`   | Dataset name                          | `category_intelligence`          |
| `SKU_MASTER_TABLE`   | Fully-qualified sku_master reference  | `{project}.{dataset}.sku_master` |
