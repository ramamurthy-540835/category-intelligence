import json
import datetime
from typing import AsyncIterator, Dict, Any
from agents.intelligence_agent import IntelligenceAgent
from agents.sensing_agent import SensingAgent
from core.audit.logger import AuditLogger
from core.auth.rbac import has_permission

class IntegrationAgent:
    action_history = []

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

            supported_actions = {
                "reprice": "Reprice recommendation queued",
                "replenish": "Replenishment workflow queued",
                "draft_coop_email": "Co-op draft generated",
                "queue_campaign": "Campaign task queued",
            }
            if action_type not in supported_actions:
                raise ValueError(f"Unsupported action_type: {action_type}")

            sku_id = str(payload.get("sku_id", "unknown-sku"))
            sku_name = str(payload.get("name") or payload.get("sku_name") or sku_id)
            outcome = supported_actions[action_type]
            message = f"{outcome} for {sku_name} ({sku_id})."

            await self.audit_logger.log_agent_action(
                "action_session",
                user_id,
                user_role,
                "IntegrationAgent",
                f"Triggered {action_type}",
                message,
            )
            return {
                "status": "success",
                "action": action_type,
                "message": message,
                "sku_id": sku_id,
                "sku_name": sku_name,
                "action_record": {
                    "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                    "action": action_type,
                    "sku_id": sku_id,
                    "sku_name": sku_name,
                    "status": "queued",
                    "message": message,
                },
            }
        except Exception as e:
            await self.audit_logger.log_agent_action("action_session", user_id, user_role, "IntegrationAgent", f"Failed {action_type}", str(e))
            raise
        finally:
            pass
