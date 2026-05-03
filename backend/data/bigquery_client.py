import os
from typing import List, Dict, Any
from google.cloud import bigquery
from google.auth import default, exceptions as google_auth_exceptions

class BigQueryClient:
    def __init__(self):
        self.project_id = os.environ.get("GCP_PROJECT_ID")
        self.dataset = os.environ.get("BIGQUERY_DATASET", "category_intelligence") # Corrected dataset name
        self._client = None
        self._check_auth()

    def _check_auth(self):
        try:
            credentials, project = default()
            if not project:
                project = self.project_id
            if not project:
                raise google_auth_exceptions.DefaultCredentialsError("GCP Project ID is not set.")
            self.project_id = project
            self._client = bigquery.Client(project=self.project_id, credentials=credentials)
            os.environ["GCP_PROJECT_ID"] = self.project_id # Ensure it's set for other modules
            print(f"GCP Authentication successful. Project: {self.project_id}")
        except google_auth_exceptions.DefaultCredentialsError as e:
            print(f"GCP_AUTH_MISSING: Application Default Credentials not found. Error: {e}")
            self._client = None # Explicitly set to None to indicate failure
            raise e # Re-raise to be caught by the caller

    async def query(self, sql: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        if self._client is None:
            raise RuntimeError("GCP_AUTH_MISSING: BigQuery client not initialized due to missing credentials.")

        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter(k, "STRING", v) if isinstance(v, str)
                else bigquery.ScalarQueryParameter(k, "INT64", v) if isinstance(v, int)
                else bigquery.ScalarQueryParameter(k, "FLOAT64", v) if isinstance(v, float)
                else bigquery.ScalarQueryParameter(k, "BOOL", v)
                for k, v in params.items()
            ]
        )
        try:
            job = self._client.query(sql, job_config=job_config)
            rows = list(job.result())
            return [dict(r.items()) for r in rows]
        except Exception as e:
            print(f"BigQuery query failed: {e}")
            raise e

    async def query_current_status(self, limit: int = 1000) -> List[Dict[str, Any]]:
        if self._client is None:
            raise RuntimeError("GCP_AUTH_MISSING: BigQuery client not initialized due to missing credentials.")
        sql = f"""
            SELECT *
            FROM `{self.project_id}.{self.dataset}.sku_store_day_status_current`
            LIMIT @limit
        """
        return await self.query(sql, {"limit": limit})

    async def insert_rows(self, table: str, rows: List[Dict[str, Any]]) -> None:
        if self._client is None:
            raise RuntimeError("GCP_AUTH_MISSING: BigQuery client not initialized due to missing credentials.")
        try:
            self._client.insert_rows_json(table, rows)
        except Exception as e:
            print(f"BigQuery insert_rows failed: {e}")
            raise e

# Global instance to check auth on startup
try:
    bq_client_instance = BigQueryClient()
except google_auth_exceptions.DefaultCredentialsError:
    bq_client_instance = None # Indicate auth failure globally
except Exception as e:
    print(f"Unexpected error initializing BigQueryClient: {e}")
    bq_client_instance = None
