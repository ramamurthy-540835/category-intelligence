import os
import logging
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import StreamingResponse
from backend.agents.integration_agent import IntegrationAgent
from backend.schemas.api import ChatRequest, ActionRequest
from backend.core.auth.rbac import require_permission

app = FastAPI(title="Category Intelligence Agent")
logger = logging.getLogger(__name__)

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

@app.get("/dashboard/{tab}")
async def dashboard(tab: str):
    allowed_tabs = {"overview", "inventory", "dc-stock", "promos", "competitive", "vendor"}
    if tab not in allowed_tabs:
        raise HTTPException(status_code=404, detail="Tab not found")
    return {"tab": tab, "data": []}
