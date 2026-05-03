import os
import logging
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request, Depends, status
from fastapi.responses import StreamingResponse, JSONResponse
from dotenv import load_dotenv
from google.auth import default, exceptions as google_auth_exceptions

from agents.integration_agent import IntegrationAgent
from schemas.api import ChatRequest, ActionRequest
from core.auth.rbac import require_permission
from data.external_feeds import CompetitorPriceFeed
from data.bigquery_client import BigQueryClient, bq_client_instance # Import the global instance

# --- Environment Loading ---
# Load environment variables from repo-level .env.local (preferred) and backend-local fallback.
# This ensures that even if the script is run from backend/, the root .env.local is loaded.
BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent

# Load .env.local from the repository root first
env_path_root = REPO_ROOT / ".env.local"
if env_path_root.exists():
    load_dotenv(dotenv_path=env_path_root, override=True)
    print(f"Loaded environment variables from: {env_path_root}")

# Then load .env.local from the backend directory as a fallback or for local overrides
env_path_backend = BACKEND_DIR / ".env.local"
if env_path_backend.exists():
    load_dotenv(dotenv_path=env_path_backend, override=True)
    print(f"Loaded environment variables from: {env_path_backend}")

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO) # Basic config for logging
logger = logging.getLogger(__name__)

# --- Environment Variable Validation and Logging ---
GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID")
GOOGLE_CLOUD_PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT")
BIGQUERY_DATASET = os.environ.get("BIGQUERY_DATASET")
SKU_MASTER_TABLE_ENV = os.environ.get("SKU_MASTER_TABLE")
SERPAPI_KEY = os.environ.get("SERPAPI_KEY")

# Use GCP_PROJECT_ID if available, otherwise fall back to GOOGLE_CLOUD_PROJECT
EFFECTIVE_PROJECT_ID = GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT

logger.info(f"--- Environment Configuration ---")
logger.info(f"GOOGLE_CLOUD_PROJECT: {'Set' if GOOGLE_CLOUD_PROJECT else 'Not Set'}")
logger.info(f"GCP_PROJECT_ID: {'Set' if GCP_PROJECT_ID else 'Not Set'}")
logger.info(f"Effective Project ID: {EFFECTIVE_PROJECT_ID or 'Not Set'}")
logger.info(f"BIGQUERY_DATASET: {BIGQUERY_DATASET or 'Not Set'}")
logger.info(f"SKU_MASTER_TABLE: {SKU_MASTER_TABLE_ENV or 'Not Set'}")
logger.info(f"SERPAPI_KEY: {'Set' if SERPAPI_KEY else 'Not Set'}")
logger.info(f"-------------------------------")

# --- Authentication Check ---
# This check will run once when the FastAPI app starts.
# If bq_client_instance is None, it means GCP auth failed during its initialization.
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
    "fix": "Create table or update BIGQUERY_DATASET in .env.local"
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
        bq_client_instance._client.get_table(table_full_id)
        return True
    except Exception as e:
        logger.warning(f"Table {table_full_id} not found: {e}")
        return False

def get_structured_error(error_type: str, message: str, fix: str):
    return {
        "status": "error",
        "error_type": error_type,
        "message": message,
        "fix": fix
    }

# --- API Endpoints ---

@app.get("/health")
async def health():
    try:
        check_gcp_auth() # Check auth for health endpoint too
        # Also check if essential tables exist
        project = EFFECTIVE_PROJECT_ID
        dataset = BIGQUERY_DATASET
        if not project or not dataset:
            return JSONResponse(content=get_structured_error("CONFIG_ERROR", "GCP Project ID or BIGQUERY_DATASET not set.", "Check .env.local"), status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

        competitor_price_snapshots_table = f"{project}.{dataset}.competitor_price_snapshots"
        competitor_price_feed_runs_table = f"{project}.{dataset}.competitor_price_feed_runs"
        sku_master_table = os.environ.get("SKU_MASTER_TABLE", f"{project}.{dataset}.sku_master")

        if not check_bq_table_exists(competitor_price_snapshots_table):
            return JSONResponse(content=BIGQUERY_TABLE_MISSING_ERROR_RESPONSE_TEMPLATE.format(table_name=competitor_price_snapshots_table), status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
        if not check_bq_table_exists(competitor_price_feed_runs_table):
            return JSONResponse(content=BIGQUERY_TABLE_MISSING_ERROR_RESPONSE_TEMPLATE.format(table_name=competitor_price_feed_runs_table), status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
        if not check_bq_table_exists(sku_master_table):
            return JSONResponse(content=BIGQUERY_TABLE_MISSING_ERROR_RESPONSE_TEMPLATE.format(table_name=sku_master_table), status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

        return {"status": "ok", "project": EFFECTIVE_PROJECT_ID, "dataset": BIGQUERY_DATASET}
    except HTTPException as e:
        return JSONResponse(content=e.detail, status_code=e.status_code)
    except RuntimeError as e: # Catch auth errors from bq_client_instance
        logger.error(f"Health check failed due to auth error: {e}")
        return JSONResponse(content=GCP_AUTH_ERROR_RESPONSE, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JSONResponse(content=get_structured_error("UNKNOWN_ERROR", f"An unexpected error occurred: {e}", "Check logs"), status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)


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
async def sensing_cycle():
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
async def run_competitor_price_feed(limit: int = 500):
    """
    Triggers a run of the competitor price feed to fetch and store prices.
    """
    try:
        check_gcp_auth()
        feed = CompetitorPriceFeed()
        result = await feed.run(limit=limit)
        result["requested_limit"] = limit
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


@app.get("/feeds/prices/status")
async def get_competitor_price_feed_status():
    try:
        check_gcp_auth()
        project = EFFECTIVE_PROJECT_ID
        dataset = BIGQUERY_DATASET
        if not project or not dataset:
            raise RuntimeError("GCP Project ID or BIGQUERY_DATASET not set.")

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
        return {
            "status": "ok",
            "latest_run": rows[0],
            "active_skus": source_rows[0].get("active_skus", 0) if source_rows else 0,
            "latest_snapshot_rows": snap_rows[0].get("latest_snapshot_rows", 0) if snap_rows else 0,
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


@app.get("/feeds/prices/latest")
async def get_latest_competitor_prices():
    """
    Retrieves the latest snapshot of competitor prices from BigQuery.
    """
    try:
        check_gcp_auth()
        feed = CompetitorPriceFeed() # This might also raise auth errors if SERPAPI_KEY is missing
        
        # SQL to get the latest timestamp and then all rows for that timestamp
        sql = f"""
            SELECT *
            FROM `{feed.full_table_id}`
            WHERE snapshot_time = (SELECT MAX(snapshot_time) FROM `{feed.full_table_id}`)
            ORDER BY sku_id
        """
        
        latest_prices = await bq_client_instance.query(sql, {})
        
        if not latest_prices:
            return JSONResponse(content={"message": "No latest price data found."}, status_code=status.HTTP_404_NOT_FOUND)
            
        return JSONResponse(content=latest_prices, status_code=status.HTTP_200_OK)
    except RuntimeError as e: # Catch our specific auth error
        logger.error(f"Failed to retrieve latest prices due to auth error: {e}")
        return JSONResponse(content=GCP_AUTH_ERROR_RESPONSE, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
    except ValueError as e: # Catch ValueError from CompetitorPriceFeed init if SERPAPI_KEY is missing
        logger.error(f"Configuration error for price feed: {e}")
        return JSONResponse(content=get_structured_error("CONFIG_ERROR", str(e), "Ensure SERPAPI_KEY is set."), status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    except HTTPException as e: # Catch table missing errors
        return JSONResponse(content=e.detail, status_code=e.status_code)
    except Exception as e:
        logger.error(f"Failed to retrieve latest competitor prices: {e}")
        return JSONResponse(content=get_structured_error("FEED_ERROR", f"Failed to retrieve latest competitor prices: {e}", "Check feed logs"), status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@app.get("/dashboard/{tab}")
async def dashboard(
    tab: str,
    q: str = "",
    stock: str = "all",
    limit: int = 200,
    offset: int = 0,
):
    allowed_tabs = {"overview", "inventory", "dc-stock", "promos", "competitive", "vendor"}
    if tab not in allowed_tabs:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tab not found")

    try:
        check_gcp_auth() # Ensure auth before proceeding
        
        if tab != "overview":
            return {"tab": tab, "data": []}

        project = EFFECTIVE_PROJECT_ID
        dataset = BIGQUERY_DATASET
        if not project or not dataset:
            raise RuntimeError("GCP Project ID or BIGQUERY_DATASET not set.")

        snapshots_table = f"{project}.{dataset}.competitor_price_snapshots"
        sku_master_table = os.environ.get("SKU_MASTER_TABLE", f"{project}.{dataset}.sku_master")

        if not check_bq_table_exists(snapshots_table):
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=BIGQUERY_TABLE_MISSING_ERROR_RESPONSE_TEMPLATE.format(table_name=snapshots_table))
        if not check_bq_table_exists(sku_master_table):
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=BIGQUERY_TABLE_MISSING_ERROR_RESPONSE_TEMPLATE.format(table_name=sku_master_table))

        # BigQuery-first overview for scale, with SerpAPI fallback.
        sql = f"""
            SELECT
              sku_id,
              sku_name AS name,
              CAST(retailer_price AS FLOAT64) AS our_price,
              CAST(competitor_price AS FLOAT64) AS competitor_price,
              CAST(price_gap_pct AS FLOAT64) AS price_gap_pct,
              CAST(COALESCE(in_stock, TRUE) AS BOOL) AS in_stock,
              snapshot_time
            FROM `{snapshots_table}`
            WHERE snapshot_time = (
              SELECT MAX(snapshot_time)
              FROM `{snapshots_table}`
            )
              AND (@q = '' OR LOWER(sku_id) LIKE LOWER(CONCAT('%', @q, '%')) OR LOWER(sku_name) LIKE LOWER(CONCAT('%', @q, '%')))
              AND (
                @stock = 'all' OR
                (@stock = 'in' AND COALESCE(in_stock, TRUE) = TRUE) OR
                (@stock = 'out' AND COALESCE(in_stock, TRUE) = FALSE)
              )
            ORDER BY ABS(price_gap_pct) DESC
            LIMIT @limit OFFSET @offset
        """
        rows = await bq_client_instance.query(sql, {"q": q, "stock": stock, "limit": limit, "offset": offset})
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

        return {
            "tab": "overview",
            "source": "bigquery-live",
            "timestamp": timestamp,
            "alerts": alerts,
            "rows": rows,
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
        logger.error(f"Dashboard overview failed: {e}")
        # Fallback to SerpAPI if BigQuery fails (but not if auth is missing)
        try:
            feed = CompetitorPriceFeed()
            snapshot = await feed.fetch_live_snapshot()
            rows = snapshot.get("rows", [])
            alerts = []
            for row in rows:
                gap = row.get("price_gap_pct")
                if gap is None or abs(gap) < 3:
                    continue
                direction = "above" if gap > 0 else "below"
                priority = "P1" if abs(gap) >= 8 else "P2"
                alerts.append({
                    "priority": priority,
                    "sku": row.get("name", row.get("sku_id", "Unknown SKU")),
                    "msg": f"Price {abs(gap):.1f}% {direction} market"
                })
            return {
                "tab": "overview",
                "source": "live-serpapi",
                "timestamp": snapshot.get("timestamp"),
                "alerts": alerts,
                "rows": rows,
            }
        except Exception as fallback_error:
            logger.error(f"Overview fallback failed: {fallback_error}")
            return JSONResponse(content={
                "tab": "overview",
                "source": "fallback",
                "alerts": [],
                "rows": [],
                "error": "Live feed unavailable. Check GCP authentication and SERPAPI connectivity."
            }, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

