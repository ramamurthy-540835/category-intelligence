import os
import logging
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request, Depends, status
from fastapi.responses import StreamingResponse, JSONResponse
from dotenv import load_dotenv
from agents.integration_agent import IntegrationAgent
from schemas.api import ChatRequest, ActionRequest
from core.auth.rbac import require_permission
from data.external_feeds import CompetitorPriceFeed
from data.bigquery_client import BigQueryClient

# Load environment variables from repo-level .env.local (preferred) and backend-local fallback.
BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent
load_dotenv(REPO_ROOT / ".env.local", override=False)
load_dotenv(BACKEND_DIR / ".env.local", override=False)

app = FastAPI(title="Category Intelligence Agent")
logger = logging.getLogger(__name__)

# Initialize BigQueryClient for general BigQuery queries
bq_client = BigQueryClient()

@app.get("/health")
async def health():
    return {"status": "ok", "project": os.environ.get("GCP_PROJECT_ID", "unknown")}

@app.post("/agent/chat")
async def agent_chat(request: ChatRequest):
    agent = IntegrationAgent()
    return StreamingResponse(
        agent.run_chat(request.message, request.session_id, request.user_id, request.user_role),
        media_type="text/event-stream"
    )

@app.post("/agent/sensing-cycle")
async def sensing_cycle():
    agent = IntegrationAgent()
    try:
        result = await agent.run_sensing_cycle()
        return result
    except Exception as e:
        logger.error(f"Sensing cycle failed: {e}")
        raise HTTPException(status_code=500, detail="Sensing cycle failed")

@app.post("/agent/action")
async def agent_action(request: ActionRequest):
    agent = IntegrationAgent()
    try:
        result = await agent.trigger_action(request.action_type, request.payload, request.user_id, request.user_role)
        return result
    except PermissionError:
        raise HTTPException(status_code=403, detail="Forbidden")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Action failed: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/feeds/prices")
async def run_competitor_price_feed(limit: int = 500):
    """
    Triggers a run of the competitor price feed to fetch and store prices.
    """
    try:
        feed = CompetitorPriceFeed()
        result = await feed.run(limit=limit)
        result["requested_limit"] = limit
        return JSONResponse(content=result, status_code=status.HTTP_200_OK)
    except ValueError as e:
        logger.error(f"Configuration error for price feed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to run competitor price feed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to run competitor price feed")

@app.get("/feeds/prices/status")
async def get_competitor_price_feed_status():
    try:
        project = os.environ.get("GCP_PROJECT_ID", "ctoteam")
        dataset = os.environ.get("BIGQUERY_DATASET", "category_intelligence")
        sql = f"""
            SELECT run_id, timestamp, skus_fetched, rows_written, status
            FROM `{project}.{dataset}.competitor_price_feed_runs`
            ORDER BY timestamp DESC
            LIMIT 1
        """
        rows = await bq_client.query(sql, {})
        source_sql = f"SELECT COUNT(*) AS active_skus FROM `{project}.{dataset}.sku_master` WHERE COALESCE(active_flag, TRUE)=TRUE"
        snapshot_sql = f"""
            SELECT COUNT(*) AS latest_snapshot_rows
            FROM `{project}.{dataset}.competitor_price_snapshots`
            WHERE snapshot_time = (
              SELECT MAX(snapshot_time)
              FROM `{project}.{dataset}.competitor_price_snapshots`
            )
        """
        source_rows = await bq_client.query(source_sql, {})
        snap_rows = await bq_client.query(snapshot_sql, {})
        if not rows:
            return {
                "status": "no_runs",
                "requested_limit": None,
                "active_skus": source_rows[0].get("active_skus", 0) if source_rows else 0,
                "latest_snapshot_rows": snap_rows[0].get("latest_snapshot_rows", 0) if snap_rows else 0,
            }
        return {
            "status": "ok",
            "latest_run": rows[0],
            "requested_limit": None,
            "active_skus": source_rows[0].get("active_skus", 0) if source_rows else 0,
            "latest_snapshot_rows": snap_rows[0].get("latest_snapshot_rows", 0) if snap_rows else 0,
        }
    except Exception as e:
        logger.error(f"Failed to retrieve feed status: {e}")
        return {"status": "error", "detail": str(e)}

@app.get("/feeds/prices/latest")
async def get_latest_competitor_prices():
    """
    Retrieves the latest snapshot of competitor prices from BigQuery.
    """
    try:
        # Instantiate CompetitorPriceFeed to get the full_table_id for the query
        feed_config = CompetitorPriceFeed()
        
        # SQL to get the latest timestamp and then all rows for that timestamp
        sql = f"""
            SELECT *
            FROM `{feed_config.full_table_id}`
            WHERE snapshot_time = (SELECT MAX(snapshot_time) FROM `{feed_config.full_table_id}`)
            ORDER BY sku_id
        """
        
        latest_prices = await bq_client.query(sql, {})
        
        if not latest_prices:
            return JSONResponse(content={"message": "No latest price data found."}, status_code=status.HTTP_404_NOT_FOUND)
            
        return JSONResponse(content=latest_prices, status_code=status.HTTP_200_OK)
    except ValueError as e: # Catch ValueError from CompetitorPriceFeed init if SERPAPI_KEY is missing
        logger.error(f"Configuration error for price feed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to retrieve latest competitor prices: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to retrieve latest competitor prices")

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
        raise HTTPException(status_code=404, detail="Tab not found")
    if tab != "overview":
        return {"tab": tab, "data": []}

    # BigQuery-first overview for scale, with SerpAPI fallback.
    try:
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
        rows = await bq_client.query(sql, {"q": q, "stock": stock, "limit": limit, "offset": offset})
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
    except Exception as e:
        logger.error(f"Overview BigQuery fetch failed: {e}")
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
            return {
                "tab": "overview",
                "source": "fallback",
                "alerts": [],
                "rows": [],
                "error": "Live feed unavailable. Check BigQuery/SERPAPI connectivity."
            }
