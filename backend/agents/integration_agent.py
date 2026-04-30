import json
from typing import AsyncIterator, Dict, Any
from backend.agents.intelligence_agent import IntelligenceAgent
from backend.agents.sensing_agent import SensingAgent
from backend.core.audit.logger import AuditLogger
from backend.core.auth.rbac import has_permission

class IntegrationAgent:
    def __init__(self):
        self.audit_logger = AuditLogger()
        self.intelligence_agent = IntelligenceAgent([], self.audit_logger)
        self.sensing_agent = SensingAgent()

    async def run_chat(self, user_message: str, session_id: str, user_id: str, user_role: str) -> AsyncIterator[str]:
        try:
            async for event in self.intelligence_agent.stream_response(user_message, session_id, user_id, user_role):
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            pass

    async def run_sensing_cycle(self) -> Dict[str, Any]:
        try:
            result = await self.sensing_agent.evaluate_and_publish()
            await self.audit_logger.log_sensing_run(result["total_scanned"], result["alerts_emitted"], result["alerts_by_priority"])
            return result
        finally:
            pass

    async def trigger_action(self, action_type: str, payload: Dict[str, Any], user_id: str, user_role: str) -> Dict[str, Any]:
        try:
            if not has_permission(user_role, "trigger_action"):
                raise PermissionError("Permission denied")
                
            await self.audit_logger.log_agent_action("action_session", user_id, user_role, "IntegrationAgent", f"Triggered {action_type}", "Action executed")
            return {"status": "success", "action": action_type}
        except Exception as e:
            await self.audit_logger.log_agent_action("action_session", user_id, user_role, "IntegrationAgent", f"Failed {action_type}", str(e))
            raise
        finally:
            pass
