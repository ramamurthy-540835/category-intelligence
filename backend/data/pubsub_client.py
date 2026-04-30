import os
from typing import Dict, Any

class PubSubClient:
    def __init__(self):
        self.project_id = os.environ.get("GCP_PROJECT_ID", "unknown")
        self.topic = os.environ.get("PUBSUB_TOPIC_ALERTS", "alerts")
        self.topic_path = f"projects/{self.project_id}/topics/{self.topic}"

    async def publish(self, topic_path: str, payload: Dict[str, Any]) -> str:
        # Mock implementation
        return "mock_message_id"
