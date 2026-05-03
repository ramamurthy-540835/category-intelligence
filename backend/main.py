import os
import logging
import asyncio
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request, Depends, status
from fastapi.responses import StreamingResponse, JSONResponse
from dotenv import load_dotenv
from google.auth import default, exceptions as google_auth_exceptions

from agents.integration_agent import IntegrationAgent
from schemas.api import ChatRequest, ActionRequest
from core.auth.rbac import require_permission
from data.external_feeds import CompetitorPriceFeed, EventStage # Import EventStage
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

# --- FastAPI App Instance ---
app = FastAPI(title="Category Intelligence Agent")
FEED_RUN_LOCK = asyncio.Lock()
ACTIVE_FEED_RUN_ID = None

# --- Environment Variable Validation and Logging ---
GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID")
GOOGLE_CLOUD_PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT")
BIGQUERY_DATASET = os.environ.get("BIGQUERY_DATASET")
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
    if not BIGQUERY_DATASET:
        errors.append(get_structured_error("BIGQUERY_DATASET_MISSING", "BIGQUERY_DATASET not set.", "Set BIGQUERY_DATASET in .env.local."))
    if not SKU_MASTER_TABLE_ENV:
        errors.append(get_structured_error("SKU_MASTER_TABLE_MISSING", "SKU_MASTER_TABLE not set.", "Set SKU_MASTER_TABLE in .env.local."))
    if not SERPAPI_KEY:
        errors.append(SERPAPI_KEY_MISSING_RESPONSE)
    if not VERTEX_MODEL or not VERTEX_AI_LOCATION:
        errors.append(VERTEX_AI_CONFIG_ERROR_RESPONSE)

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
        global ACTIVE_FEED_RUN_ID
        if FEED_RUN_LOCK.locked():
            return JSONResponse(content={
                "status": "running",
                "message": "Feed run already in progress.",
                "run_id": ACTIVE_FEED_RUN_ID,
                "requested_limit": limit
            }, status_code=status.HTTP_200_OK)

        # Validate environment config before starting feed
        config_status = validate_environment()
        if config_status["status"] == "error":
            return JSONResponse(content=config_status, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

        async with FEED_RUN_LOCK:
            feed = CompetitorPriceFeed()
            ACTIVE_FEED_RUN_ID = feed.current_run_id
            result = await feed.run(limit=limit)
            ACTIVE_FEED_RUN_ID = result.get("run_id")
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


@app.get("/feeds/prices/latest")
async def get_latest_competitor_prices():
    """
    Retrieves the latest snapshot of competitor prices from BigQuery.
    """
    try:
        check_gcp_auth()
        config_status = validate_environment()
        if config_status["status"] == "error":
            return JSONResponse(content=config_status, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
            
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

        config_status = validate_environment()
        if config_status["status"] == "error":
            return JSONResponse(content=config_status, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)

        project = EFFECTIVE_PROJECT_ID
        dataset = BIGQUERY_DATASET
        
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
        overall_status = "error"
    elif not latest_run_details or latest_run_details.get("status") == "error":
        overall_status = "warning" # Indicates a problem with the last run
    elif active_run_id and not latest_events:
        overall_status = "warning" # Run started but no events yet
    elif active_run_id and latest_events[-1].get("stage") == "ERROR":
        overall_status = "error"
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
            "error_type": latest_events[-1].get("error_type") if latest_events and latest_events[-1].get("status") == "ERROR" else None,
            "fix": latest_events[-1].get("fix") if latest_events and latest_events[-1].get("status") == "ERROR" else None,
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
