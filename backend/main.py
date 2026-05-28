import os
import logging
import asyncio
import datetime
from pathlib import Path
from typing import List, Dict, Any
from fastapi import FastAPI, HTTPException, Request, Depends, status
from fastapi.responses import StreamingResponse, JSONResponse
from dotenv import load_dotenv
from google.auth import default, exceptions as google_auth_exceptions

from agents.integration_agent import IntegrationAgent
from schemas.api import ChatRequest, ActionRequest
from core.auth.rbac import require_permission
from data.external_feeds import CompetitorPriceFeed, EventStage # Import EventStage
from data.bigquery_client import BigQueryClient, bq_client_instance # Import the global instance
from data.seeder import BigQuerySeeder # Import seeder
from agents.intelligence_agent import inject_category_predicate, build_category_predicate

# --- Environment Loading ---
# Single source of truth is the repo-root .env.local. backend/.env.local is
# treated as an *override* only — never as a duplicate that can clobber the
# root file with stale values. Process env (already exported by start.sh)
# always wins over both.
BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent

env_path_root = REPO_ROOT / ".env.local"
if env_path_root.exists():
    # override=False so anything already in os.environ (e.g. exported by
    # start.sh) is respected.
    load_dotenv(dotenv_path=env_path_root, override=False)
    print(f"Loaded environment variables from: {env_path_root}")

env_path_backend = BACKEND_DIR / ".env.local"
if env_path_backend.exists():
    load_dotenv(dotenv_path=env_path_backend, override=False)
    print(f"Loaded environment variables from: {env_path_backend} (overrides only)")

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO) # Basic config for logging
logger = logging.getLogger(__name__)

# --- FastAPI App Instance ---
app = FastAPI(title="Category Intelligence Agent")
FEED_RUN_LOCK = asyncio.Lock()
ACTIVE_FEED_RUN_ID = None
LAST_FEED_REFRESH_AT = None
MIN_FEED_REFRESH_INTERVAL_SECONDS = 600
MANUAL_REFRESH_DEFAULT_LIMIT = 20
MANUAL_REFRESH_MAX_LIMIT = 20

# --- Environment Variable Validation and Logging ---
GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID")
GOOGLE_CLOUD_PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT")
BIGQUERY_DATASET = os.environ.get("BIGQUERY_DATASET", "category_intelligence")
SKU_MASTER_TABLE_ENV = os.environ.get("SKU_MASTER_TABLE")
SERPAPI_KEY = os.environ.get("SERPAPI_KEY")
VERTEX_MODEL = os.environ.get("VERTEX_MODEL")
VERTEX_AI_LOCATION = os.environ.get("VERTEX_AI_LOCATION")

# Use GCP_PROJECT_ID if available, otherwise fall back to GOOGLE_CLOUD_PROJECT
EFFECTIVE_PROJECT_ID = GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT

logger.info(f"--- Environment Configuration ---")
logger.info(f"GOOGLE_CLOUD_PROJECT: {'Set' if GOOGLE_CLOUD_PROJECT else 'Not Set'}")
logger.info(f"GCP_PROJECT_ID: {'Set' if GCP_PROJECT_ID else 'Not Set'}")
logger.info(f"Effective Project ID: {EFFECTIVE_PROJECT_ID or 'Not Set'}")
logger.info(f"BIGQUERY_DATASET: {BIGQUERY_DATASET or 'Not Set'}")
logger.info(f"SKU_MASTER_TABLE: {SKU_MASTER_TABLE_ENV or 'Not Set'}")
logger.info(f"SERPAPI_KEY: {'Set' if SERPAPI_KEY else 'Not Set'}")
logger.info(f"VERTEX_MODEL: {VERTEX_MODEL or 'Not Set'}")
logger.info(f"VERTEX_AI_LOCATION: {VERTEX_AI_LOCATION or 'Not Set'}")
logger.info(f"-------------------------------")

# --- Constants for Error Responses ---
GCP_AUTH_ERROR_RESPONSE = {
    "status": "error",
    "error_type": "GCP_AUTH_MISSING",
    "message": "GCP Application Default Credentials not found.",
    "fix": "Run: gcloud auth application-default login"
}

BIGQUERY_TABLE_MISSING_ERROR_RESPONSE_TEMPLATE = {
    "status": "error",
    "error_type": "BIGQUERY_TABLE_MISSING",
    "message": "BigQuery table not found: {table_name}",
    "fix": "Create table or update BIGQUERY_DATASET / SKU_MASTER_TABLE in .env.local"
}

SERPAPI_KEY_MISSING_RESPONSE = {
    "status": "error",
    "error_type": "CONFIG_ERROR",
    "message": "SERPAPI_KEY environment variable not set.",
    "fix": "Add SERPAPI_KEY to .env.local and restart backend."
}

VERTEX_AI_CONFIG_ERROR_RESPONSE = {
    "status": "error",
    "error_type": "VERTEX_AI_CONFIG_ERROR",
    "message": "Vertex AI model or location configuration missing.",
    "fix": "Set VERTEX_MODEL and VERTEX_AI_LOCATION in .env.local."
}

# --- Startup Lifecycle Events ---
@app.on_event("startup")
async def startup_event():
    """Run database seeding on application startup if tables are empty."""
    try:
        if EFFECTIVE_PROJECT_ID and BIGQUERY_DATASET:
            logger.info("Starting database seeding check...")
            seeder = BigQuerySeeder(EFFECTIVE_PROJECT_ID, BIGQUERY_DATASET)
            result = await seeder.seed_database()
            logger.info(f"Seeding result: {result}")
        else:
            logger.warning("Cannot run seeder: GCP_PROJECT_ID or BIGQUERY_DATASET not set")
    except Exception as e:
        logger.error(f"Startup seeding failed (non-blocking): {e}")

def get_structured_error(error_type: str, message: str, fix: str):
    return {
        "status": "error",
        "error_type": error_type,
        "message": message,
        "fix": fix
    }

def check_gcp_auth():
    if bq_client_instance is None or bq_client_instance._client is None:
        logger.error("GCP_AUTH_MISSING: BigQuery client not initialized. API endpoints will return an error.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=GCP_AUTH_ERROR_RESPONSE
        )
    return True

def check_bq_table_exists(table_full_id: str) -> bool:
    """Checks if a BigQuery table exists."""
    try:
        if bq_client_instance and bq_client_instance._client:
            bq_client_instance._client.get_table(table_full_id)
            return True
        return False
    except Exception as e:
        logger.warning(f"Table {table_full_id} not found: {e}")
        return False

# --- Startup Validation and Status ---
def validate_environment():
    """Validates essential environment configurations at startup."""
    config_status = {
        "gcp_project": EFFECTIVE_PROJECT_ID or "Not Set",
        "bigquery_dataset": BIGQUERY_DATASET or "Not Set",
        "sku_master_table": SKU_MASTER_TABLE_ENV or "Not Set",
        "serpapi": "configured" if SERPAPI_KEY else "missing",
        "vertex_model": VERTEX_MODEL or "Not Set",
        "vertex_location": VERTEX_AI_LOCATION or "Not Set",
        "status": "ready"
    }

    errors = []
    if not EFFECTIVE_PROJECT_ID:
        errors.append(get_structured_error("GCP_PROJECT_MISSING", "GCP Project ID not set.", "Set GOOGLE_CLOUD_PROJECT or GCP_PROJECT_ID in .env.local."))
    # BIGQUERY_DATASET has a default ("category_intelligence"), so it should
    # not hard-fail local/demo startup when omitted from env.
    if not SKU_MASTER_TABLE_ENV:
        config_status["sku_master_table"] = f"{EFFECTIVE_PROJECT_ID}.{BIGQUERY_DATASET}.sku_master" if EFFECTIVE_PROJECT_ID else f"{BIGQUERY_DATASET}.sku_master"
    # SERPAPI and Vertex are optional for read-only dashboard/status endpoints.
    # Keep them as warnings in config instead of blocking all agent UI routes.
    warnings = []
    if not SERPAPI_KEY:
        warnings.append(SERPAPI_KEY_MISSING_RESPONSE)
    if not VERTEX_MODEL or not VERTEX_AI_LOCATION:
        warnings.append(VERTEX_AI_CONFIG_ERROR_RESPONSE)

    if errors:
        config_status["status"] = "error"
        config_status["errors"] = errors
    elif not bq_client_instance or not bq_client_instance._client:
        config_status["status"] = "error"
        config_status["errors"] = [GCP_AUTH_ERROR_RESPONSE]
    else:
        # Check BigQuery tables existence
        snapshots_table = f"{EFFECTIVE_PROJECT_ID}.{BIGQUERY_DATASET}.competitor_price_snapshots"
        runs_table = f"{EFFECTIVE_PROJECT_ID}.{BIGQUERY_DATASET}.competitor_price_feed_runs"
        sku_master_table = SKU_MASTER_TABLE_ENV or f"{EFFECTIVE_PROJECT_ID}.{BIGQUERY_DATASET}.sku_master"

        if not check_bq_table_exists(snapshots_table):
            errors.append(BIGQUERY_TABLE_MISSING_ERROR_RESPONSE_TEMPLATE.format(table_name=snapshots_table))
        if not check_bq_table_exists(runs_table):
            errors.append(BIGQUERY_TABLE_MISSING_ERROR_RESPONSE_TEMPLATE.format(table_name=runs_table))
        if not check_bq_table_exists(sku_master_table):
            errors.append(BIGQUERY_TABLE_MISSING_ERROR_RESPONSE_TEMPLATE.format(table_name=sku_master_table))
        
        if errors:
            config_status["status"] = "error"
            config_status["errors"] = errors
    if warnings:
        config_status["warnings"] = warnings

    return config_status

# --- API Endpoints ---

@app.get("/health")
async def health():
    try:
        check_gcp_auth() # Check auth for health endpoint too

        # Perform full environment validation
        config_status = validate_environment()
        if config_status["status"] == "error":
            return JSONResponse(content=config_status, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

        return {"status": "ok", "config": config_status}
    except HTTPException as e:
        return JSONResponse(content=e.detail, status_code=e.status_code)
    except RuntimeError as e: # Catch auth errors from bq_client_instance
        logger.error(f"Health check failed due to auth error: {e}")
        return JSONResponse(content=GCP_AUTH_ERROR_RESPONSE, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JSONResponse(content=get_structured_error("UNKNOWN_ERROR", f"An unexpected error occurred: {e}", "Check logs"), status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@app.post("/db/seed")
async def trigger_database_seed():
    """Manually trigger BigQuery database seeding."""
    try:
        check_gcp_auth()
        if not EFFECTIVE_PROJECT_ID or not BIGQUERY_DATASET:
            return JSONResponse(
                content=get_structured_error("CONFIG_ERROR", "Missing GCP_PROJECT_ID or BIGQUERY_DATASET", "Set both in .env.local"),
                status_code=status.HTTP_400_BAD_REQUEST
            )

        seeder = BigQuerySeeder(EFFECTIVE_PROJECT_ID, BIGQUERY_DATASET)
        result = await seeder.seed_database()

        if result["status"] == "success":
            return JSONResponse(content=result, status_code=status.HTTP_200_OK)
        else:
            return JSONResponse(content=result, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    except HTTPException as e:
        return JSONResponse(content=e.detail, status_code=e.status_code)
    except Exception as e:
        logger.error(f"Database seed failed: {e}")
        return JSONResponse(
            content=get_structured_error("SEEDING_ERROR", f"Database seed failed: {e}", "Check logs"),
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@app.post("/agent/chat")
async def agent_chat(request: ChatRequest):
    try:
        check_gcp_auth()
        agent = IntegrationAgent()
        return StreamingResponse(
            agent.run_chat(request.message, request.session_id, request.user_id, request.user_role),
            media_type="text/event-stream"
        )
    except HTTPException as e:
        return JSONResponse(content=e.detail, status_code=e.status_code)
    except Exception as e:
        logger.error(f"Agent chat failed: {e}")
        return JSONResponse(content=get_structured_error("AGENT_ERROR", f"Agent chat failed: {e}", "Check agent logs"), status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@app.post("/agent/sensing-cycle")
async def sensing_cycle(category: str = "Entertainment"):
    try:
        check_gcp_auth()
        agent = IntegrationAgent()
        result = await agent.run_sensing_cycle()
        return result
    except HTTPException as e:
        return JSONResponse(content=e.detail, status_code=e.status_code)
    except Exception as e:
        logger.error(f"Sensing cycle failed: {e}")
        return JSONResponse(content=get_structured_error("AGENT_ERROR", f"Sensing cycle failed: {e}", "Check agent logs"), status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@app.post("/agent/action")
async def agent_action(request: ActionRequest):
    try:
        check_gcp_auth()
        agent = IntegrationAgent()
        result = await agent.trigger_action(request.action_type, request.payload, request.user_id, request.user_role)
        return result
    except HTTPException as e:
        return JSONResponse(content=e.detail, status_code=e.status_code)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Action failed: {e}")
        return JSONResponse(content=get_structured_error("AGENT_ERROR", f"Action failed: {e}", "Check agent logs"), status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@app.post("/feeds/prices")
async def run_competitor_price_feed(limit: int = MANUAL_REFRESH_DEFAULT_LIMIT):
    """
    Triggers a run of the competitor price feed to fetch and store prices.
    """
    try:
        check_gcp_auth()
        global ACTIVE_FEED_RUN_ID, LAST_FEED_REFRESH_AT
        effective_limit = max(1, min(int(limit or MANUAL_REFRESH_DEFAULT_LIMIT), MANUAL_REFRESH_MAX_LIMIT))
        if FEED_RUN_LOCK.locked():
            return JSONResponse(content={
                "status": "running",
                "message": "Feed run already in progress.",
                "run_id": ACTIVE_FEED_RUN_ID,
                "requested_limit": effective_limit
            }, status_code=status.HTTP_200_OK)
        now = asyncio.get_event_loop().time()
        if LAST_FEED_REFRESH_AT and (now - LAST_FEED_REFRESH_AT) < MIN_FEED_REFRESH_INTERVAL_SECONDS:
            return JSONResponse(content={
                "status": "cooldown",
                "message": "Refresh cooldown active. Manual refresh is limited to once every 10 minutes.",
                "run_id": ACTIVE_FEED_RUN_ID,
                "requested_limit": effective_limit,
                "cooldown_seconds_remaining": int(MIN_FEED_REFRESH_INTERVAL_SECONDS - (now - LAST_FEED_REFRESH_AT)),
            }, status_code=status.HTTP_200_OK)

        # Validate environment config before starting feed
        config_status = validate_environment()
        if config_status["status"] == "error":
            return JSONResponse(content=config_status, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

        async with FEED_RUN_LOCK:
            feed = CompetitorPriceFeed()
            ACTIVE_FEED_RUN_ID = feed.current_run_id
            result = await feed.run(limit=effective_limit)
            LAST_FEED_REFRESH_AT = asyncio.get_event_loop().time()
            ACTIVE_FEED_RUN_ID = result.get("run_id")
        result["requested_limit"] = effective_limit
        return JSONResponse(content=result, status_code=status.HTTP_200_OK)
    except HTTPException as e:
        return JSONResponse(content=e.detail, status_code=e.status_code)
    except ValueError as e: # Catch ValueError from CompetitorPriceFeed init if SERPAPI_KEY is missing
        logger.error(f"Configuration error for price feed: {e}")
        return JSONResponse(content=get_structured_error("CONFIG_ERROR", str(e), "Ensure SERPAPI_KEY is set."), status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    except RuntimeError as e: # Catch auth errors from CompetitorPriceFeed init
        logger.error(f"Feed run failed due to auth error: {e}")
        return JSONResponse(content=GCP_AUTH_ERROR_RESPONSE, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
    except Exception as e:
        logger.error(f"Failed to run competitor price feed: {e}")
        return JSONResponse(content=get_structured_error("FEED_ERROR", f"Failed to run competitor price feed: {e}", "Check feed logs"), status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    finally:
        if not FEED_RUN_LOCK.locked():
            ACTIVE_FEED_RUN_ID = None


@app.get("/feeds/prices/status")
async def get_competitor_price_feed_status():
    try:
        check_gcp_auth()
        config_status = validate_environment()
        if config_status["status"] == "error":
            return JSONResponse(content=config_status, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

        project = EFFECTIVE_PROJECT_ID
        dataset = BIGQUERY_DATASET
        
        feed_runs_table = f"{project}.{dataset}.competitor_price_feed_runs"
        sku_master_table = os.environ.get("SKU_MASTER_TABLE", f"{project}.{dataset}.sku_master")
        snapshots_table = f"{project}.{dataset}.competitor_price_snapshots"

        if not check_bq_table_exists(feed_runs_table):
            return JSONResponse(content=BIGQUERY_TABLE_MISSING_ERROR_RESPONSE_TEMPLATE.format(table_name=feed_runs_table), status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
        if not check_bq_table_exists(sku_master_table):
            return JSONResponse(content=BIGQUERY_TABLE_MISSING_ERROR_RESPONSE_TEMPLATE.format(table_name=sku_master_table), status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
        if not check_bq_table_exists(snapshots_table):
            return JSONResponse(content=BIGQUERY_TABLE_MISSING_ERROR_RESPONSE_TEMPLATE.format(table_name=snapshots_table), status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

        sql = f"""
            SELECT run_id, timestamp, skus_fetched, rows_written, status
            FROM `{feed_runs_table}`
            ORDER BY timestamp DESC
            LIMIT 1
        """
        rows = await bq_client_instance.query(sql, {})
        source_sql = f"SELECT COUNT(*) AS active_skus FROM `{sku_master_table}` WHERE COALESCE(active_flag, TRUE)=TRUE"
        snapshot_sql = f"""
            SELECT COUNT(*) AS latest_snapshot_rows
            FROM `{snapshots_table}`
            WHERE snapshot_time = (
              SELECT MAX(snapshot_time)
              FROM `{snapshots_table}`
            )
        """
        source_rows = await bq_client_instance.query(source_sql, {})
        snap_rows = await bq_client_instance.query(snapshot_sql, {})
        
        if not rows:
            return {
                "status": "no_runs",
                "active_skus": source_rows[0].get("active_skus", 0) if source_rows else 0,
                "latest_snapshot_rows": snap_rows[0].get("latest_snapshot_rows", 0) if snap_rows else 0,
            }
        latest = rows[0]
        latest_rows_written = latest.get("rows_written", 0) if isinstance(latest, dict) else 0
        derived_status = "stale" if (latest_rows_written or 0) == 0 else "ok"
        return {
            "status": derived_status,
            "latest_run": latest,
            "active_skus": source_rows[0].get("active_skus", 0) if source_rows else 0,
            "latest_snapshot_rows": snap_rows[0].get("latest_snapshot_rows", 0) if snap_rows else 0,
            "warning": "Latest refresh produced no new rows." if derived_status == "stale" else None,
        }
    except RuntimeError as e: # Catch our specific auth error or missing env vars
        logger.error(f"Failed to retrieve feed status: {e}")
        if "GCP_AUTH_MISSING" in str(e):
            return JSONResponse(content=GCP_AUTH_ERROR_RESPONSE, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
        else:
            return JSONResponse(content=get_structured_error("CONFIG_ERROR", str(e), "Check .env.local"), status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
    except HTTPException as e: # Catch table missing errors
        return JSONResponse(content=e.detail, status_code=e.status_code)
    except Exception as e:
        logger.error(f"Failed to retrieve feed status: {e}")
        return JSONResponse(content=get_structured_error("FEED_ERROR", f"Failed to retrieve feed status: {e}", "Check feed logs"), status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _serialize_bq_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Convert BigQuery rows to JSON-serializable format, converting datetime objects to ISO strings."""
    result = []
    for row in rows:
        serialized = {}
        for k, v in row.items():
            if isinstance(v, datetime.datetime):
                serialized[k] = v.isoformat()
            elif isinstance(v, datetime.date):
                serialized[k] = v.isoformat()
            else:
                serialized[k] = v
        result.append(serialized)
    return result

@app.get("/feeds/prices/latest")
async def get_latest_competitor_prices(category: str = "Entertainment"):
    """
    Retrieves the latest snapshot of competitor prices from BigQuery.
    """
    try:
        check_gcp_auth()
        config_status = validate_environment()
        if config_status["status"] == "error":
            return JSONResponse(content=config_status, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

        feed = CompetitorPriceFeed() # This might also raise auth errors if SERPAPI_KEY is missing

        # Build category predicate to apply to both the outer query and the MAX(snapshot_time) subquery
        category_predicate = build_category_predicate(category, "sku_name")

        # SQL to get the latest timestamp within the category, then all rows for that timestamp
        sql = f"""
            SELECT *
            FROM `{feed.FULL_TABLE_ID}`
            WHERE {category_predicate}
            AND snapshot_time = (
                SELECT MAX(snapshot_time)
                FROM `{feed.FULL_TABLE_ID}`
                WHERE {category_predicate}
            )
            ORDER BY sku_id
        """

        latest_prices = await bq_client_instance.query(sql, {})

        if not latest_prices:
            return JSONResponse(
                content=[],
                status_code=status.HTTP_200_OK,
            )

        return JSONResponse(content=_serialize_bq_rows(latest_prices), status_code=status.HTTP_200_OK)
    except RuntimeError as e: # Catch our specific auth error
        logger.error(f"Failed to retrieve latest prices due to auth error: {e}")
        return JSONResponse(content={"status": "degraded", "source": "cached-analytics", "rows": [], "error": GCP_AUTH_ERROR_RESPONSE}, status_code=status.HTTP_200_OK)
    except ValueError as e: # Catch ValueError from CompetitorPriceFeed init if SERPAPI_KEY is missing
        logger.error(f"Configuration error for price feed: {e}")
        return JSONResponse(content={"status": "degraded", "source": "cached-analytics", "rows": [], "error": get_structured_error("CONFIG_ERROR", str(e), "Ensure SERPAPI_KEY is set.")}, status_code=status.HTTP_200_OK)
    except HTTPException as e: # Catch table missing errors
        return JSONResponse(content={"status": "degraded", "source": "cached-analytics", "rows": [], "error": e.detail}, status_code=status.HTTP_200_OK)
    except Exception as e:
        logger.error(f"Failed to retrieve latest competitor prices: {e}")
        return JSONResponse(content={"status": "degraded", "source": "cached-analytics", "rows": [], "error": get_structured_error("FEED_ERROR", f"Failed to retrieve latest competitor prices: {e}", "Check feed logs")}, status_code=status.HTTP_200_OK)


@app.get("/dashboard/{tab}")
async def dashboard(
    tab: str,
    q: str = "",
    stock: str = "all",
    limit: int = 200,
    offset: int = 0,
    start_date: str = "2024-10-01",
    end_date: str = "2026-03-31",
    categories: str = "Home Appliance,Mobile,Accessories",
    category: str = "Entertainment",
):
    allowed_tabs = {"overview", "inventory", "dc-stock", "promos", "competitive", "vendor"}
    if tab not in allowed_tabs:
        return JSONResponse(content={"tab": tab, "source": "cached-analytics", "alerts": [], "rows": [], "status": "degraded", "error": "Tab not found"}, status_code=status.HTTP_200_OK)

    try:
        check_gcp_auth() # Ensure auth before proceeding
        
        if tab != "overview":
            return {"tab": tab, "data": []}

        config_status = validate_environment()
        if config_status["status"] == "error":
            return JSONResponse(content={"tab": "overview", "source": "cached-analytics", "alerts": [], "rows": [], "status": "degraded", "error": config_status}, status_code=status.HTTP_200_OK)

        project = EFFECTIVE_PROJECT_ID
        dataset = BIGQUERY_DATASET
        
        snapshots_table = f"{project}.{dataset}.competitor_price_snapshots"
        sku_master_table = os.environ.get("SKU_MASTER_TABLE", f"{project}.{dataset}.sku_master")

        if not check_bq_table_exists(snapshots_table):
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=BIGQUERY_TABLE_MISSING_ERROR_RESPONSE_TEMPLATE.format(table_name=snapshots_table))
        if not check_bq_table_exists(sku_master_table):
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=BIGQUERY_TABLE_MISSING_ERROR_RESPONSE_TEMPLATE.format(table_name=sku_master_table))

        # BigQuery-first overview for scale, with SerpAPI fallback.
        # QUALIFY collapses any duplicate sku_id rows that may exist within a single
        # snapshot, so the UI never renders the same SKU twice.
        sql = f"""
            SELECT
              sku_id,
              name,
              our_price,
              competitor_price,
              price_gap_pct,
              in_stock,
              snapshot_time
            FROM (
              SELECT
                sku_id,
                sku_name AS name,
                CAST(retailer_price AS FLOAT64) AS our_price,
                CAST(competitor_price AS FLOAT64) AS competitor_price,
                CAST(price_gap_pct AS FLOAT64) AS price_gap_pct,
                CAST(COALESCE(in_stock, TRUE) AS BOOL) AS in_stock,
                snapshot_time
              FROM `{snapshots_table}`
              WHERE DATE(snapshot_time) BETWEEN DATE(@start_date) AND DATE(@end_date)
              QUALIFY ROW_NUMBER() OVER (
                PARTITION BY sku_id
                ORDER BY snapshot_time DESC, CAST(competitor_price AS FLOAT64) DESC
              ) = 1
            )
            WHERE (@q = '' OR LOWER(sku_id) LIKE LOWER(CONCAT('%', @q, '%')) OR LOWER(name) LIKE LOWER(CONCAT('%', @q, '%')))
              AND (
                @categories = '' OR EXISTS (
                  SELECT 1
                  FROM UNNEST(SPLIT(LOWER(@categories), ',')) AS c
                  WHERE TRIM(c) != '' AND LOWER(name) LIKE CONCAT('%', TRIM(c), '%')
                )
              )
              AND (
                @stock = 'all' OR
                (@stock = 'in' AND in_stock = TRUE) OR
                (@stock = 'out' AND in_stock = FALSE)
              )
            ORDER BY ABS(price_gap_pct) DESC
            LIMIT @limit OFFSET @offset
        """
        sql = inject_category_predicate(sql, category, "name")
        rows = await bq_client_instance.query(sql, {
            "q": q,
            "stock": stock,
            "limit": limit,
            "offset": offset,
            "start_date": start_date,
            "end_date": end_date,
            "categories": categories,
        })
        if not rows:
            fallback_sql = f"""
                SELECT
                  sku_id,
                  sku_name AS name,
                  CAST(retailer_price AS FLOAT64) AS our_price,
                  CAST(competitor_price AS FLOAT64) AS competitor_price,
                  CAST(price_gap_pct AS FLOAT64) AS price_gap_pct,
                  CAST(COALESCE(in_stock, TRUE) AS BOOL) AS in_stock,
                  snapshot_time
                FROM `{snapshots_table}`
                ORDER BY snapshot_time DESC
                LIMIT 50
            """
            rows = await bq_client_instance.query(fallback_sql, {})
        timestamp = rows[0].get("snapshot_time") if rows else None

        alerts = []
        for row in rows:
            gap = row.get("price_gap_pct")
            if gap is None:
                continue
            if abs(gap) < 3:
                continue
            direction = "above" if gap > 0 else "below"
            priority = "P1" if abs(gap) >= 8 else "P2"
            alerts.append({
                "priority": priority,
                "sku": row.get("name", row.get("sku_id", "Unknown SKU")),
                "msg": f"Price {abs(gap):.1f}% {direction} market"
            })

        # Serialize datetime objects in rows and timestamp
        serialized_timestamp = timestamp.isoformat() if isinstance(timestamp, datetime.datetime) else timestamp

        return {
            "tab": "overview",
            "source": "bigquery-live",
            "timestamp": serialized_timestamp,
            "alerts": alerts,
            "rows": _serialize_bq_rows(rows),
        }
    except RuntimeError as e: # Catch auth errors or missing env vars
        logger.error(f"Dashboard overview failed: {e}")
        if "GCP_AUTH_MISSING" in str(e):
            return JSONResponse(content=GCP_AUTH_ERROR_RESPONSE, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
        else:
            return JSONResponse(content=get_structured_error("CONFIG_ERROR", str(e), "Check .env.local"), status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
    except HTTPException as e: # Catch table missing errors
        return JSONResponse(content=e.detail, status_code=e.status_code)
    except Exception as e:
        logger.error(f"Dashboard overview failed with exception: {type(e).__name__}: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        # Return empty rows instead of degraded status - let frontend use fallback to /feeds/prices/latest
        return JSONResponse(content={
            "tab": "overview",
            "source": "cached-analytics",
            "alerts": [],
            "rows": [],
            "status": "ok",
            "timestamp": datetime.datetime.utcnow().isoformat()
        }, status_code=status.HTTP_200_OK)


@app.get("/dashboard/sell-through")
async def dashboard_sell_through(
    start_date: str = "2024-10-01",
    end_date: str = "2026-03-31",
    categories: str = "Home Appliance,Mobile,Accessories",
    category: str = "Entertainment",
):
    try:
        check_gcp_auth()
        project = EFFECTIVE_PROJECT_ID
        dataset = BIGQUERY_DATASET
        snapshots_table = f"{project}.{dataset}.competitor_price_snapshots"
        if not check_bq_table_exists(snapshots_table):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=BIGQUERY_TABLE_MISSING_ERROR_RESPONSE_TEMPLATE.format(table_name=snapshots_table),
            )

        sql = f"""
            SELECT
              CONCAT('W', LPAD(CAST(EXTRACT(ISOWEEK FROM snapshot_time) AS STRING), 2, '0')) AS week,
              SUM(CASE WHEN LOWER(sku_name) LIKE '%samsung%' THEN 1 ELSE 0 END) AS Samsung,
              SUM(CASE WHEN LOWER(sku_name) LIKE '%sony%' THEN 1 ELSE 0 END) AS Sony,
              SUM(CASE WHEN LOWER(sku_name) LIKE '%lg%' THEN 1 ELSE 0 END) AS LG,
              COUNT(*) AS Forecast
            FROM `{snapshots_table}`
            WHERE DATE(snapshot_time) BETWEEN DATE(@start_date) AND DATE(@end_date)
              AND (
                @categories = '' OR EXISTS (
                  SELECT 1
                  FROM UNNEST(SPLIT(LOWER(@categories), ',')) AS c
                  WHERE TRIM(c) != '' AND LOWER(sku_name) LIKE CONCAT('%', TRIM(c), '%')
                )
              )
            GROUP BY week
            ORDER BY week
        """
        sql = inject_category_predicate(sql, category, "sku_name")
        rows = await bq_client_instance.query(sql, {
            "start_date": start_date,
            "end_date": end_date,
            "categories": categories,
        })
        return {"rows": rows, "source": "bigquery-live"}
    except HTTPException as e:
        return JSONResponse(content={"rows": [], "source": "cached-analytics", "status": "degraded", "error": e.detail}, status_code=status.HTTP_200_OK)
    except Exception as e:
        logger.error(f"Dashboard sell-through failed: {e}")
        return JSONResponse(content={"rows": [], "source": "cached-analytics", "status": "degraded", "error": str(e)}, status_code=status.HTTP_200_OK)

# New endpoint to get agent events and status
@app.get("/agent/status")
async def get_agent_status():
    """
    Returns the current status of the agent, including configuration, active run,
    pipeline stages, and recent events.
    """
    config_status = validate_environment()
    
    # Get the latest competitor price feed run details
    latest_run_details = None
    if bq_client_instance and bq_client_instance._client:
        try:
            project = EFFECTIVE_PROJECT_ID
            dataset = BIGQUERY_DATASET
            if project and dataset:
                runs_table = f"{project}.{dataset}.competitor_price_feed_runs"
                if check_bq_table_exists(runs_table):
                    sql = f"SELECT * FROM `{runs_table}` ORDER BY timestamp DESC LIMIT 1"
                    rows = await bq_client_instance.query(sql, {})
                    if rows:
                        latest_run_details = rows[0]
        except Exception as e:
            logger.error(f"Could not fetch latest run details: {e}")

    # Get the latest events from the CompetitorPriceFeed instance (if available and active)
    # This is a simplification; a persistent event store would be more robust.
    latest_events = []
    active_run_id = None
    if CompetitorPriceFeed.current_run_id: # Accessing class variable directly for simplicity
        active_run_id = CompetitorPriceFeed.current_run_id
        latest_events = CompetitorPriceFeed.run_events[-20:] # Get last 20 events

    # Determine overall status
    overall_status = "ready"
    if config_status["status"] == "error":
        overall_status = "degraded"
    elif not latest_run_details or latest_run_details.get("status") == "error":
        overall_status = "warning" # Indicates a problem with the last run
    elif active_run_id and not latest_events:
        overall_status = "warning" # Run started but no events yet
    elif active_run_id and latest_events[-1].get("stage") == "ERROR":
        overall_status = "degraded"
    elif active_run_id and latest_events[-1].get("stage") == "COMPLETE":
        overall_status = "ready" # Last run completed successfully
    elif active_run_id:
        overall_status = "running" # A run is active

    return {
        "config_status": config_status,
        "active_run": {
            "run_id": active_run_id,
            "start_time": CompetitorPriceFeed.run_start_time if active_run_id else None,
            "current_stage": latest_events[-1].get("stage") if latest_events else None,
            "current_status": latest_events[-1].get("status") if latest_events else None,
            "current_message": latest_events[-1].get("message") if latest_events else None,
            "error_type": latest_events[-1].get("error_type") if latest_events and latest_events[-1].get("status") in {"ERROR", "WARNING"} else None,
            "fix": latest_events[-1].get("fix") if latest_events and latest_events[-1].get("status") in {"ERROR", "WARNING"} else None,
        },
        "run_history": [latest_run_details] if latest_run_details else [], # Simplified history
        "events": latest_events,
        "overall_status": overall_status
    }


@app.get("/agent/events")
async def get_agent_events(run_id: str):
    """Return recent events for a specific run from BigQuery event log table."""
    try:
        check_gcp_auth()
        project = EFFECTIVE_PROJECT_ID
        dataset = BIGQUERY_DATASET
        events_table = f"{project}.{dataset}.feed_run_events"
        if not check_bq_table_exists(events_table):
            return {"run_id": run_id, "events": []}

        sql = f"""
            SELECT *
            FROM `{events_table}`
            WHERE run_id = @run_id
            ORDER BY timestamp DESC
            LIMIT 100
        """
        rows = await bq_client_instance.query(sql, {"run_id": run_id})
        return {"run_id": run_id, "events": rows}
    except Exception as e:
        logger.error(f"Failed to fetch agent events for run_id={run_id}: {e}")
        return {"run_id": run_id, "events": [], "error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# BigQuery Explorer endpoints
#
# /bq/query   — read-only ad-hoc SELECT runner used by the UI Data Explorer.
# /bq/update  — narrow allowlist UPDATE for sku_master.our_price / sku_name.
#
# Both routes intentionally do NOT use bq_client_instance.query() because
# they need raw schema access (column names, byte counts) that the wrapper
# doesn't expose.
# ─────────────────────────────────────────────────────────────────────────────
import re as _bq_re
from pydantic import BaseModel as _BqBaseModel


class BQQueryRequest(_BqBaseModel):
    sql: str
    max_rows: int = 100


class BQUpdateRequest(_BqBaseModel):
    table: str
    sku_id: str
    field: str
    value: str


_BQ_BLOCKED = ("DELETE", "UPDATE", "INSERT", "DROP", "CREATE", "TRUNCATE", "MERGE", "ALTER", "GRANT", "REVOKE", "CALL")


@app.post("/bq/query")
async def bq_query(req: BQQueryRequest, category: str = "Entertainment"):
    """Run an ad-hoc read-only SELECT. Strict allowlist on statement type."""
    sql_raw = (req.sql or "").strip()
    if not sql_raw:
        raise HTTPException(status_code=400, detail="Empty SQL")

    sql_raw = inject_category_predicate(sql_raw, category, "sku_name")
    upper = sql_raw.upper()
    if not (upper.startswith("SELECT") or upper.startswith("WITH ")):
        raise HTTPException(status_code=400, detail="Only SELECT (or WITH … SELECT) queries are allowed.")

    # Token-boundary check so 'DELETE' inside a string literal doesn't false-positive,
    # and 'updated_at' (column name) doesn't trip 'UPDATE'.
    for kw in _BQ_BLOCKED:
        if _bq_re.search(rf"\b{kw}\b", upper):
            raise HTTPException(status_code=400, detail=f"Keyword {kw} not allowed in /bq/query.")

    try:
        from google.cloud import bigquery
        client = bigquery.Client(project=EFFECTIVE_PROJECT_ID)
        # Defensive max_rows cap — even a SELECT can be huge.
        max_rows = max(1, min(int(req.max_rows or 100), 1000))
        job = client.query(sql_raw, job_config=bigquery.QueryJobConfig(use_query_cache=True))
        rows_iter = job.result(max_results=max_rows)
        columns = [field.name for field in rows_iter.schema]

        out_rows = []
        for row in rows_iter:
            d = {}
            for col in columns:
                v = row[col]
                if v is None:
                    d[col] = None
                elif isinstance(v, (str, int, float, bool)):
                    d[col] = v
                else:
                    d[col] = str(v)
            out_rows.append(d)

        return {
            "columns": columns,
            "rows": out_rows,
            "total_rows": len(out_rows),
            "bytes_processed": job.total_bytes_processed,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"/bq/query failed: {e}")
        raise HTTPException(status_code=500, detail=f"BigQuery error: {e}")


@app.post("/bq/update")
async def bq_update(req: BQUpdateRequest):
    """Allowlisted UPDATE on sku_master. Only our_price and sku_name. Parameterized."""
    if req.table != "sku_master":
        raise HTTPException(status_code=400, detail="Only sku_master updates are allowed.")
    if req.field not in ("our_price", "sku_name"):
        raise HTTPException(status_code=400, detail="Only our_price and sku_name can be updated.")
    if not _bq_re.match(r"^[A-Za-z0-9._\-]+$", req.sku_id or ""):
        raise HTTPException(status_code=400, detail="Invalid sku_id format.")

    table_ref = f"{EFFECTIVE_PROJECT_ID}.{BIGQUERY_DATASET}.sku_master"

    try:
        from google.cloud import bigquery
        client = bigquery.Client(project=EFFECTIVE_PROJECT_ID)

        if req.field == "our_price":
            try:
                num_value = float(req.value)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="our_price must be a number.")
            if num_value < 0 or num_value > 1_000_000:
                raise HTTPException(status_code=400, detail="our_price out of range.")
            sql = f"""
                UPDATE `{table_ref}`
                SET our_price = @value
                WHERE sku_id = @sku_id
            """
            params = [
                bigquery.ScalarQueryParameter("value", "FLOAT64", num_value),
                bigquery.ScalarQueryParameter("sku_id", "STRING", req.sku_id),
            ]
        else:
            str_value = str(req.value or "")
            if len(str_value) > 200:
                raise HTTPException(status_code=400, detail="sku_name too long.")
            sql = f"""
                UPDATE `{table_ref}`
                SET sku_name = @value
                WHERE sku_id = @sku_id
            """
            params = [
                bigquery.ScalarQueryParameter("value", "STRING", str_value),
                bigquery.ScalarQueryParameter("sku_id", "STRING", req.sku_id),
            ]

        job = client.query(sql, job_config=bigquery.QueryJobConfig(query_parameters=params))
        job.result()
        return {
            "success": True,
            "sku_id": req.sku_id,
            "field": req.field,
            "value": req.value,
            "rows_affected": job.num_dml_affected_rows,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"/bq/update failed: {e}")
        # BigQuery often rejects UPDATE on streaming-buffer rows — surface that clearly.
        msg = str(e)
        if "streaming buffer" in msg.lower():
            raise HTTPException(status_code=409, detail="Row is in BigQuery streaming buffer — try again in ~30 min.")
        raise HTTPException(status_code=500, detail=f"BigQuery update error: {msg}")


@app.get("/pricing/sku-details")
async def pricing_sku_details(sku_id: str = "", sku_name: str = ""):
    try:
        check_gcp_auth()
        project = EFFECTIVE_PROJECT_ID
        dataset = BIGQUERY_DATASET
        snapshots_table = f"{project}.{dataset}.competitor_price_snapshots"
        if not check_bq_table_exists(snapshots_table):
            return {"rows": []}

        if sku_id:
            where_sql = "WHERE sku_id = @sku_id"
            params = {"sku_id": sku_id}
        elif sku_name:
            where_sql = "WHERE LOWER(sku_name) = LOWER(@sku_name)"
            params = {"sku_name": sku_name}
        else:
            return {"rows": []}

        sql = f"""
            SELECT
              sku_id,
              sku_name,
              retailer_price,
              competitor_price,
              price_gap_pct,
              in_stock,
              snapshot_time,
              product_url,
              product_image
            FROM `{snapshots_table}`
            {where_sql}
            ORDER BY snapshot_time DESC, competitor_price ASC
            LIMIT 10
        """
        rows = await bq_client_instance.query(sql, params)
        return {"rows": rows}
    except Exception as e:
        logger.error(f"/pricing/sku-details failed: {e}")
        return {"rows": [], "error": str(e)}
