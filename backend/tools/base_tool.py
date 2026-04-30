from abc import ABC, abstractmethod
from typing import Dict, Any
from data.bigquery_client import BigQueryClient

class BaseTool(ABC):
    name: str
    description: str
    schema: Dict[str, Any]

    def __init__(self):
        self.bq = BigQueryClient()

    @abstractmethod
    async def run(self, params: Dict[str, Any]) -> Dict[str, Any]:
        pass
