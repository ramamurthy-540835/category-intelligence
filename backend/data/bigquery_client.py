import os
from typing import List, Dict, Any

class BigQueryClient:
    def __init__(self):
        self.project_id = os.environ.get("GCP_PROJECT_ID", "unknown")
        self.dataset = os.environ.get("BIGQUERY_DATASET", "default")

    async def query(self, sql: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        # Mock implementation
        return []

    async def query_current_status(self, limit: int = 1000) -> List[Dict[str, Any]]:
        # Mock implementation
        return []

    async def insert_rows(self, table: str, rows: List[Dict[str, Any]]) -> None:
        # Mock implementation
        pass
