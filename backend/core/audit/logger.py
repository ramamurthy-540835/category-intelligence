import os
import sys
import logging
from typing import Dict, Any
from google.cloud import bigquery
from data.bigquery_client import BigQueryClient

logger = logging.getLogger(__name__)

class AuditLogger:
    def __init__(self):
        self.project_id = os.environ.get("GCP_PROJECT_ID", "unknown")
        self.dataset = os.environ.get("BIGQUERY_DATASET", "category_intelligence")
        self.table = f"{self.project_id}.{self.dataset}.agent_action_log"
        self.bq = BigQueryClient()
        self._ensure_audit_table()

    def _ensure_audit_table(self) -> None:
        """Create the audit table if it does not already exist."""
        try:
            if not self.bq or not self.bq._client:
                logger.warning("AuditLogger: BigQuery client unavailable; cannot ensure audit table.")
                return

            # Fast path: table exists.
            try:
                self.bq._client.get_table(self.table)
                return
            except Exception:
                pass

            schema = [
                bigquery.SchemaField("event_type", "STRING"),
                bigquery.SchemaField("tool_name", "STRING"),
                bigquery.SchemaField("inputs", "STRING"),
                bigquery.SchemaField("output_summary", "STRING"),
                bigquery.SchemaField("user_id", "STRING"),
                bigquery.SchemaField("session_id", "STRING"),
                bigquery.SchemaField("user_role", "STRING"),
                bigquery.SchemaField("agent_name", "STRING"),
                bigquery.SchemaField("tool_calls_summary", "STRING"),
                bigquery.SchemaField("recommendation_text", "STRING"),
                bigquery.SchemaField("total_scanned", "INT64"),
                bigquery.SchemaField("alerts_emitted", "INT64"),
                bigquery.SchemaField("alerts_by_priority", "STRING"),
                bigquery.SchemaField("created_at", "TIMESTAMP"),
            ]
            table = bigquery.Table(self.table, schema=schema)
            self.bq._client.create_table(table)
            logger.info(f"AuditLogger: created missing table {self.table}")
        except Exception as e:
            logger.warning(f"AuditLogger: failed to ensure audit table {self.table}: {e}")

    async def log_tool_call(self, tool_name: str, inputs: Dict[str, Any], output_summary: str, user_id: str, session_id: str) -> None:
        try:
            row = {
                "event_type": "tool_call",
                "tool_name": tool_name,
                "inputs": str(inputs),
                "output_summary": output_summary,
                "user_id": user_id,
                "session_id": session_id
            }
            await self.bq.insert_rows(self.table, [row])
        except Exception as e:
            sys.stderr.write(f"AuditLogger error: {e}\n")

    async def log_agent_action(self, session_id: str, user_id: str, user_role: str, agent_name: str, tool_calls_summary: str, recommendation_text: str) -> None:
        try:
            row = {
                "event_type": "agent_action",
                "session_id": session_id,
                "user_id": user_id,
                "user_role": user_role,
                "agent_name": agent_name,
                "tool_calls_summary": tool_calls_summary,
                "recommendation_text": recommendation_text
            }
            await self.bq.insert_rows(self.table, [row])
        except Exception as e:
            sys.stderr.write(f"AuditLogger error: {e}\n")

    async def log_sensing_run(self, total_scanned: int, alerts_emitted: int, alerts_by_priority: Dict[str, int]) -> None:
        try:
            row = {
                "event_type": "sensing_run",
                "total_scanned": total_scanned,
                "alerts_emitted": alerts_emitted,
                "alerts_by_priority": str(alerts_by_priority)
            }
            await self.bq.insert_rows(self.table, [row])
        except Exception as e:
            sys.stderr.write(f"AuditLogger error: {e}\n")
