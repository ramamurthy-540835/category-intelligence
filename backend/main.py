import os
import logging
from fastapi import FastAPI, HTTPException, Request, Depends, status
from fastapi.responses import StreamingResponse, JSONResponse
from agents.integration_agent import IntegrationAgent
from schemas.api import ChatRequest, ActionRequest
from core.auth.rbac import require_permission
from data.external_feeds import CompetitorPriceFeed
from data.bigquery_client import BigQueryClient

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
async def run_competitor_price_feed():
    """
    Triggers a run of the competitor price feed to fetch and store prices.
    """
    try:
        feed = CompetitorPriceFeed()
        result = await feed.run()
        return JSONResponse(content=result, status_code=status.HTTP_200_OK)
    except ValueError as e:
        logger.error(f"Configuration error for price feed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to run competitor price feed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to run competitor price feed")

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
            WHERE timestamp = (SELECT MAX(timestamp) FROM `{feed_config.full_table_id}`)
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
async def dashboard(tab: str):
    allowed_tabs = {"overview", "inventory", "dc-stock", "promos", "competitive", "vendor"}
    if tab not in allowed_tabs:
        raise HTTPException(status_code=404, detail="Tab not found")
    return {"tab": tab, "data": []}
