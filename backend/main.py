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

# Load environment variables from repo-level .env.local (preferred) and backend-local fallback.
BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent
load_dotenv(REPO_ROOT / ".env.local", override=False)
load_dotenv(BACKEND_DIR / ".env.local", override=False)

app = FastAPI(title="Category Intelligence Agent")
logger = logging.getLogger(__name__)

# --- Authentication Check ---
# This check will run once when the FastAPI app starts.
# If bq_client_instance is None, it means GCP auth failed during its initialization.
GCP_AUTH_ERROR_RESPONSE = {
    "status": "error",
    "error_type": "GCP_AUTH_MISSING",
    "message": "GCP Application Default Credentials not found.",
    "fix": "Run: gcloud auth application-default login"
}

def check_gcp_auth():
    if bq_client_instance is None or bq_client_instance._client is None:
        logger.error("GCP_AUTH_MISSING: API endpoints will return an error.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=GCP_AUTH_ERROR_RESPONSE
        )
    return True

# --- API Endpoints ---

@app.get("/health")
async def health():
    try:
        check_gcp_auth() # Check auth for health endpoint too
        return {"status": "ok", "project": os.environ.get("GCP_PROJECT_ID", "unknown")}
    except HTTPException as e:
        return JSONResponse(content=e.detail, status_code=e.status_code)


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
        return JSONResponse(content={"status": "error", "message": str(e)}, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)


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
        return JSONResponse(content={"status": "error", "message": str(e)}, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)


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
        return JSONResponse(content={"status": "error", "message": str(e)}, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)


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
        return JSONResponse(content={"status": "error", "message": str(e)}, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    except Exception as e:
        logger.error(f"Failed to run competitor price feed: {e}")
        return JSONResponse(content={"status": "error", "message": str(e)}, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)


@app.get("/feeds/prices/status")
async def get_competitor_price_feed_status():
    try:
        check_gcp_auth()
        project = os.environ.get("GCP_PROJECT_ID", "ctoteam")
        dataset = os.environ.get("BIGQUERY_DATASET", "category_intelligence") # Corrected dataset name
        
        # Check if bq_client_instance is valid before proceeding
        if bq_client_instance is None or bq_client_instance._client is None:
             raise RuntimeError("GCP_AUTH_MISSING: BigQuery client not available.")

        sql = f"""
            SELECT run_id, timestamp, skus_fetched, rows_written, status
            FROM `{project}.{dataset}.competitor_price_feed_runs`
            ORDER BY timestamp DESC
            LIMIT 1
        """
        rows = await bq_client_instance.query(sql, {})
        source_sql = f"SELECT COUNT(*) AS active_skus FROM `{project}.{dataset}.sku_master` WHERE COALESCE(active_flag, TRUE)=TRUE"
        snapshot_sql = f"""
            SELECT COUNT(*) AS latest_snapshot_rows
            FROM `{project}.{dataset}.competitor_price_snapshots`
            WHERE snapshot_time = (
              SELECT MAX(snapshot_time)
              FROM `{project}.{dataset}.competitor_price_snapshots`
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
    except RuntimeError as e: # Catch our specific auth error
        logger.error(f"Failed to retrieve feed status due to auth error: {e}")
        return JSONResponse(content=GCP_AUTH_ERROR_RESPONSE, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
    except Exception as e:
        logger.error(f"Failed to retrieve feed status: {e}")
        return JSONResponse(content={"status": "error", "message": str(e)}, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)


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
        return JSONResponse(content={"status": "error", "message": str(e)}, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
    except Exception as e:
        logger.error(f"Failed to retrieve latest competitor prices: {e}")
        return JSONResponse(content={"status": "error", "message": str(e)}, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)


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
            FROM `{os.environ.get("GCP_PROJECT_ID", "ctoteam")}.{os.environ.get("BIGQUERY_DATASET", "category_intelligence")}.competitor_price_snapshots`
            WHERE snapshot_time = (
              SELECT MAX(snapshot_time)
              FROM `{os.environ.get("GCP_PROJECT_ID", "ctoteam")}.{os.environ.get("BIGQUERY_DATASET", "category_intelligence")}.competitor_price_snapshots`
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
    except RuntimeError as e: # Catch our specific auth error
        logger.error(f"Dashboard overview failed due to auth error: {e}")
        return JSONResponse(content=GCP_AUTH_ERROR_RESPONSE, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
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

