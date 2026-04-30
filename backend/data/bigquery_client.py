import os
from typing import List, Dict, Any
from google.cloud import bigquery

class BigQueryClient:
    def __init__(self):
        self.project_id = os.environ.get("GCP_PROJECT_ID", "unknown")
        self.dataset = os.environ.get("BIGQUERY_DATASET", "default")
        self._client = bigquery.Client(project=self.project_id)

    async def query(self, sql: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter(k, "STRING", v) if isinstance(v, str)
                else bigquery.ScalarQueryParameter(k, "INT64", v) if isinstance(v, int)
                else bigquery.ScalarQueryParameter(k, "FLOAT64", v) if isinstance(v, float)
                else bigquery.ScalarQueryParameter(k, "BOOL", v)
                for k, v in params.items()
            ]
        )
        job = self._client.query(sql, job_config=job_config)
        rows = list(job.result())
        return [dict(r.items()) for r in rows]

    async def query_current_status(self, limit: int = 1000) -> List[Dict[str, Any]]:
        sql = f"""
            SELECT *
            FROM `{self.project_id}.{self.dataset}.sku_store_day_status_current`
            LIMIT @limit
        """
        return await self.query(sql, {"limit": limit})

    async def insert_rows(self, table: str, rows: List[Dict[str, Any]]) -> None:
        self._client.insert_rows_json(table, rows)
