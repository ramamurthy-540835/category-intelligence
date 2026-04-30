import os
import asyncio
import json
from typing import AsyncIterator, List, Dict, Any
from backend.core.audit.logger import AuditLogger

class IntelligenceAgent:
    def __init__(self, tool_instances: List[Any], audit_logger: AuditLogger):
        self.tools = {t.name: t for t in tool_instances}
        self.audit_logger = audit_logger
        self.model_name = os.environ.get("VERTEX_MODEL", "gemini-3.1-pro-preview")

    async def stream_response(self, user_message: str, session_id: str, user_id: str, user_role: str) -> AsyncIterator[Dict[str, str]]:
        try:
            yield {"step": "think", "content": "Analyzing request..."}
            yield {"step": "act", "content": "Executing tools..."}
            
            # Mock parallel execution
            await asyncio.gather(*[asyncio.sleep(0.1) for _ in self.tools])
            
            yield {"step": "analyze", "content": "Processing results..."}
            yield {"step": "respond_chunk", "content": "Here is the analysis."}
            yield {"step": "done", "content": "Finished."}
            
            await self.audit_logger.log_agent_action(session_id, user_id, user_role, "IntelligenceAgent", "Executed tools", "Recommendation")
        except Exception as e:
            yield {"step": "error", "content": str(e)}
        finally:
            pass
