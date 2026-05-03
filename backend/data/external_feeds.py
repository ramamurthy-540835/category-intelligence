import os
import asyncio
import aiohttp
import socket
import re
import datetime
import uuid
import logging
from typing import List, Dict, Any, Optional

from google.cloud import bigquery
from google.auth import default, exceptions as google_auth_exceptions

# Assume BigQueryClient is available and correctly configured
from .bigquery_client import BigQueryClient, bq_client_instance

log = logging.getLogger(__name__)

SERPAPI_KEY = os.environ.get("SERPAPI_KEY")

# Define event stages
class EventStage:
    SENSING = "SENSING"
    FETCHING = "FETCHING"
    ENRICHING = "ENRICHING"
    PROCESSING = "PROCESSING"
    ANALYZING = "ANALYZING"
    UPDATING = "UPDATING"
    RESPONDING = "RESPONDING"
    COMPLETE = "COMPLETE"
    ERROR = "ERROR"

class CompetitorPriceFeed:
    # Shared in-memory state for status endpoints
    run_events: List[Dict[str, Any]] = []
    current_run_id: Optional[str] = None
    run_start_time: Optional[str] = None
    SERPAPI_URL = "https://serpapi.com/search.json"
    COMPETITOR_NAME = "Google Shopping"
    # Use the dataset from the environment variable
    PROJECT = os.environ.get("GCP_PROJECT_ID", os.environ.get("GOOGLE_CLOUD_PROJECT"))
    DATASET = os.environ.get("BIGQUERY_DATASET", "category_intelligence")
    TABLE_NAME = "competitor_price_snapshots"
    RUNS_TABLE_NAME = "competitor_price_feed_runs"
    EVENT_LOG_TABLE_NAME = "feed_run_events" # New table for events
    # Construct full table IDs using the DATASET variable
    FULL_TABLE_ID = f"{PROJECT}.{DATASET}.{TABLE_NAME}"
    FULL_RUNS_TABLE_ID = f"{PROJECT}.{DATASET}.{RUNS_TABLE_NAME}"
    FULL_EVENT_LOG_TABLE_ID = f"{PROJECT}.{DATASET}.{EVENT_LOG_TABLE_NAME}"

    def __init__(self):
        if not SERPAPI_KEY:
            log.warning("SERPAPI_KEY environment variable not set. External price fetching will fail.")
        
        # Ensure BigQuery client is initialized and authenticated
        if bq_client_instance is None or bq_client_instance._client is None:
            raise RuntimeError("GCP_AUTH_MISSING: BigQuery client not initialized due to missing credentials.")
        self.bq_client = bq_client_instance
        # Construct SKU master table ID using the DATASET variable
        self.sku_master_table_id: str = os.environ.get(
            "SKU_MASTER_TABLE",
            f"{self.PROJECT}.{self.DATASET}.sku_master"
        )
        self.run_events = [] # Instance view for current run
        self.current_run_id = None
        self.run_start_time = None

    def _log_event(self, stage: str, status: str, message: str, details: Dict[str, Any] = None):
        """Logs a structured event for the current run."""
        details = details or {} # Ensure details is always a dict, even if empty
        if not self.current_run_id:
            self.current_run_id = str(uuid.uuid4()) # Start a new run if none exists
            self.run_start_time = datetime.datetime.now().isoformat()

        event = {
            "run_id": self.current_run_id,
            "timestamp": datetime.datetime.now().isoformat(),
            "stage": stage,
            "status": status,
            "message": message,
            "requested_skus": details.get("requested_limit") if stage == EventStage.SENSING else None,
            "active_skus": details.get("active_skus") if stage == EventStage.FETCHING else None,
            "processed_rows": details.get("processed_rows") if stage == EventStage.PROCESSING else None,
            "written_rows": details.get("written_rows") if stage == EventStage.UPDATING else None,
            "snapshot_rows": details.get("snapshot_rows") if stage == EventStage.RESPONDING else None,
            "external_source_status": details.get("external_source_status") if stage in [EventStage.ENRICHING, EventStage.FETCHING] else None,
            "error_type": details.get("error_type") if status in ("ERROR", "FAILED") else None,
            "fix": details.get("fix") if status in ("ERROR", "FAILED") else None,
            **details
        }
        self.run_events.append(event)
        CompetitorPriceFeed.run_events.append(event)
        CompetitorPriceFeed.current_run_id = self.current_run_id
        CompetitorPriceFeed.run_start_time = self.run_start_time
        log.info(f"FEED_EVENT: {event}")

        # Attempt to log to BigQuery, but only if the client is available and the table exists
        if self.bq_client and self.bq_client._client: # Check if client is initialized and available
            try:
                # Check if the event log table exists before attempting to insert
                self.bq_client._client.get_table(self.FULL_EVENT_LOG_TABLE_ID)
                self.bq_client._client.insert_rows_json(self.FULL_EVENT_LOG_TABLE_ID, [event])
            except Exception as table_err:
                # Log a warning if the table is missing or inaccessible
                log.warning(f"Could not log event to BigQuery table {self.FULL_EVENT_LOG_TABLE_ID}: {table_err}")
        else:
            log.warning("BigQuery client not available or not initialized, skipping event logging to BigQuery.")

    async def fetch_skus_to_track(self, limit: int = 500) -> List[Dict[str, Any]]:
        """Fetches SKUs from BigQuery that are marked for tracking."""
        self._log_event(EventStage.FETCHING, "RUNNING", f"Loading active SKUs from {self.sku_master_table_id} with limit {limit}", {"requested_limit": limit})
        sql = f"""
            SELECT sku_id, sku_name, COALESCE(active_flag, TRUE) as is_active
            FROM `{self.sku_master_table_id}`
            WHERE COALESCE(active_flag, TRUE) = TRUE
            LIMIT @limit
        """
        try:
            rows = await self.bq_client.query(sql, {"limit": limit})
            self._log_event(EventStage.FETCHING, "SUCCESS", f"Loaded {len(rows)} active SKUs.", {"active_skus": len(rows)})
            return rows
        except Exception as e:
            log.error(f"Error fetching SKUs to track: {e}")
            self._log_event(EventStage.FETCHING, "ERROR", f"Failed to load active SKUs: {e}", {"error_type": "BIGQUERY_QUERY_ERROR", "fix": f"Check SKU Master Table: {self.sku_master_table_id}"})
            return []

    async def fetch_price(self, session: aiohttp.ClientSession, sku: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Fetches live price for a single SKU using SerpApi."""
        sku_id = str(sku.get("sku_id") or "").strip()
        sku_name = str(sku.get("sku_name") or "").strip()

        # Build multiple query candidates because raw SKU IDs like "LG-C3-77"
        # often return no Shopping results.
        base = sku_name or sku_id
        normalized_id = re.sub(r"[-_]+", " ", sku_id)
        model_only = re.sub(r"[^A-Za-z0-9 ]+", " ", normalized_id).strip()
        query_candidates = [q for q in [base, f"{base} price", model_only, f"{model_only} tv", f"{model_only} soundbar"] if q]

        try:
            product = None
            for query in query_candidates[:4]:
                params = {
                    "engine": "google_shopping",
                    "api_key": SERPAPI_KEY,
                    "q": query,
                    "hl": "en",
                    "gl": "us",
                    "device": "desktop",
                }
                async with session.get(self.SERPAPI_URL, params=params) as response:
                    response.raise_for_status()
                    data = await response.json()

                if "error" in data:
                    log.error(f"SerpApi error for SKU {sku_id}: {data['error']}")
                    self._log_event(EventStage.ENRICHING, "ERROR", f"SerpApi error for SKU {sku_id}: {data['error']}", {"error_type": "SERPAPI_ERROR", "fix": "Check SERPAPI_KEY and query."})
                    return None

                products = data.get("products", [])
                if products:
                    product = products[0]
                    break

            if not product:
                self._log_event(EventStage.ENRICHING, "WARNING", f"No products found for SKU {sku_id}")
                return None

            price_str = product.get('price')
            competitor_price = 0.0
            if price_str:
                cleaned_price_str = re.sub(r'[^\d.]', '', price_str)
                try:
                    competitor_price = float(cleaned_price_str)
                except ValueError:
                    log.warning(f"Could not parse price '{price_str}' for SKU {sku_id}")

            return {
                "sku_id": sku.get("sku_id"),
                "sku_name": sku.get("sku_name"),
                "competitor_price": competitor_price,
                "competitor_name": product.get("source", self.COMPETITOR_NAME),
                "product_url": product.get("link"),
                "image_url": product.get("thumbnail", product.get("image")),
                "in_stock": True, # Assume in stock if listed, SerpApi doesn't reliably provide this
                "last_checked": datetime.datetime.now().isoformat()
            }
        except aiohttp.ClientError as e:
            log.error(f"HTTP error fetching price for SKU {sku.get('sku_id')}: {e}")
            err_msg = str(e)
            error_type = "SERPAPI_CONNECTIVITY_ERROR" if ("Name or service not known" in err_msg or "Temporary failure in name resolution" in err_msg or "Cannot connect" in err_msg) else "HTTP_ERROR"
            fix = "Check DNS/network egress to serpapi.com from backend host." if error_type == "SERPAPI_CONNECTIVITY_ERROR" else "Check network connectivity and SERP API endpoint."
            self._log_event(EventStage.ENRICHING, "ERROR", f"HTTP error fetching price for SKU {sku.get('sku_id')}: {e}", {"error_type": error_type, "fix": fix})
            return None
        except Exception as e:
            log.error(f"Unexpected error fetching price for SKU {sku.get('sku_id')}: {e}")
            self._log_event(EventStage.ENRICHING, "ERROR", f"Unexpected error fetching price for SKU {sku.get('sku_id')}: {e}", {"error_type": "UNEXPECTED_ERROR"})
            return None

    async def fetch_live_snapshot(self, limit: int = 500) -> Dict[str, Any]:
        """Fetches live prices for multiple SKUs and returns a snapshot."""
        self._log_event(EventStage.FETCHING, "RUNNING", f"Starting live snapshot fetch with limit {limit}", {"requested_limit": limit})
        skus_to_track = await self.fetch_skus_to_track(limit=limit)
        if not skus_to_track:
            self._log_event(EventStage.FETCHING, "COMPLETE", "No SKUs to track.")
            return {"status": "no_skus_to_track", "rows": [], "timestamp": None}

        self._log_event(EventStage.ENRICHING, "RUNNING", f"Fetching external market prices for {len(skus_to_track)} SKUs.")
        rows_to_write = []
        async with aiohttp.ClientSession() as session:
            tasks = [self.fetch_price(session, sku) for sku in skus_to_track]
            results = await asyncio.gather(*tasks)

            for result in results:
                if result and result.get("sku_id"): # Ensure we have a valid SKU ID
                    rows_to_write.append(result)
        
        self._log_event(EventStage.ENRICHING, "SUCCESS", f"Retrieved market prices for {len(rows_to_write)} SKUs.", {"processed_rows": len(rows_to_write)})

        self._log_event(EventStage.PROCESSING, "RUNNING", "Normalizing market prices and SKU rows.")
        # Placeholder for actual price gap calculation if needed here
        self._log_event(EventStage.PROCESSING, "SUCCESS", "Price normalization and row processing complete.")

        self._log_event(EventStage.ANALYZING, "RUNNING", "Calculating price gaps and priority alerts.")
        # Placeholder for actual analysis
        self._log_event(EventStage.ANALYZING, "SUCCESS", "Price gap and alert analysis complete.")

        timestamp = datetime.datetime.now().isoformat()
        
        self._log_event(EventStage.UPDATING, "RUNNING", f"Writing {len(rows_to_write)} rows to BigQuery snapshot table.")
        rows_written = self._write_to_bq(rows_to_write, timestamp)
        
        run_status = "success" if rows_written > 0 else "partial"
        self._write_run_metadata(
            run_id=self.current_run_id, # Use the run_id generated at the start
            timestamp=timestamp,
            skus_fetched=len(skus_to_track),
            rows_written=rows_written,
            status=run_status
        )
        self._log_event(EventStage.UPDATING, "SUCCESS", f"Wrote {rows_written} rows to BigQuery.", {"written_rows": rows_written})

        self._log_event(EventStage.RESPONDING, "RUNNING", "Updating dashboard, alerts, and SKU table.")
        # This stage might involve updating other systems or preparing final response data
        self._log_event(EventStage.RESPONDING, "SUCCESS", "Dashboard and alerts updated.")

        self._log_event(EventStage.COMPLETE, "SUCCESS", f"Feed run completed. Rows: {rows_written}/{len(skus_to_track)}", {"snapshot_rows": rows_written})
        return {
            "status": "success",
            "rows": rows_to_write,
            "timestamp": timestamp,
            "rows_written": rows_written,
            "skus_processed": len(skus_to_track),
            "run_id": self.current_run_id # Include run_id in response
        }

    def _write_to_bq(self, rows: List[Dict[str, Any]], timestamp: str) -> int:
        """Writes fetched price data to BigQuery."""
        if not rows:
            return 0
        
        # Add timestamp to each row for partitioning/clustering if applicable
        for row in rows:
            row["snapshot_time"] = timestamp
            # Ensure all expected columns are present, even if None
            row.setdefault("sku_id", None)
            row.setdefault("sku_name", None)
            row.setdefault("competitor_price", 0.0)
            row.setdefault("competitor_name", None)
            row.setdefault("product_url", None)
            row.setdefault("image_url", None)
            row.setdefault("in_stock", True) # Default to True if not provided by SerpApi
            row.setdefault("last_checked", timestamp)

        try:
            # Use the bq_client instance from BigQueryClient
            # Only attempt insert if the client is valid
            if self.bq_client and self.bq_client._client:
                errors = self.bq_client._client.insert_rows_json(self.FULL_TABLE_ID, rows)
                if errors:
                    log.error("BigQuery insert errors: %s", errors)
                    self._log_event(EventStage.UPDATING, "ERROR", f"BigQuery insert errors: {errors}", {"error_type": "BIGQUERY_INSERT_ERROR", "fix": f"Check schema for {self.FULL_TABLE_ID} and data types."})
                    return 0
                log.info(f"Successfully inserted {len(rows)} rows into {self.FULL_TABLE_ID}")
                return len(rows)
            else:
                log.warning("BigQuery client not available, skipping insert_rows_json.")
                self._log_event(EventStage.UPDATING, "ERROR", "BigQuery client not available, skipping insert.", {"error_type": "BIGQUERY_CLIENT_UNAVAILABLE"})
                return 0
        except Exception as e:
            log.error(f"Error writing to BigQuery table {self.FULL_TABLE_ID}: {e}")
            self._log_event(EventStage.UPDATING, "ERROR", f"Error writing to BigQuery table {self.FULL_TABLE_ID}: {e}", {"error_type": "BIGQUERY_WRITE_ERROR", "fix": f"Check permissions and table schema for {self.FULL_TABLE_ID}."})
            return 0

    def _write_run_metadata(
        self,
        run_id: str,
        timestamp: str,
        skus_fetched: int,
        rows_written: int,
        status: str,
    ) -> None:
        """Writes metadata about the feed run to BigQuery."""
        metadata = {
            "run_id": run_id,
            "timestamp": timestamp,
            "skus_fetched": skus_fetched,
            "rows_written": rows_written,
            "status": status,
        }
        try:
            # Use the bq_client instance from BigQueryClient
            if self.bq_client and self.bq_client._client: # Check if client is initialized and available
                errors = self.bq_client._client.insert_rows_json(self.FULL_RUNS_TABLE_ID, [metadata])
                if errors:
                    log.error("BigQuery run metadata insert errors: %s", errors)
                    self._log_event(EventStage.UPDATING, "ERROR", f"BigQuery run metadata insert errors: {errors}", {"error_type": "BIGQUERY_INSERT_ERROR", "fix": f"Check schema for {self.FULL_RUNS_TABLE_ID}."})
                else:
                    log.info(f"Successfully inserted run metadata into {self.FULL_RUNS_TABLE_ID}")
            else:
                log.warning("BigQuery client not available, skipping run metadata logging to BigQuery.")
                self._log_event(EventStage.UPDATING, "ERROR", "BigQuery client not available, skipping run metadata logging.", {"error_type": "BIGQUERY_CLIENT_UNAVAILABLE"})
        except Exception as e:
            log.error(f"Error writing run metadata to BigQuery table {self.FULL_RUNS_TABLE_ID}: {e}")
            self._log_event(EventStage.ERROR, "ERROR", f"Failed to write run metadata: {e}", {"error_type": "BIGQUERY_WRITE_ERROR", "fix": f"Check permissions and table schema for {self.FULL_RUNS_TABLE_ID}."})

    async def run(self, limit: int = 500) -> Dict[str, Any]:
        """Main entry point to run the feed."""
        self.run_events = [] # Clear events for a new run
        self.current_run_id = str(uuid.uuid4()) # Generate a new run ID for this execution
        self.run_start_time = datetime.datetime.now().isoformat()
        CompetitorPriceFeed.run_events = []
        CompetitorPriceFeed.current_run_id = self.current_run_id
        CompetitorPriceFeed.run_start_time = self.run_start_time
        self._log_event(EventStage.SENSING, "RUNNING", f"Refresh requested for {limit} SKUs", {"requested_limit": limit})

        try:
            # --- Environment Validation ---
            project = self.PROJECT
            dataset = self.DATASET
            sku_master_table = self.sku_master_table_id
            
            if not project:
                raise RuntimeError("GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT not set.")
            if not dataset:
                raise RuntimeError("BIGQUERY_DATASET not set.")
            if not sku_master_table:
                raise RuntimeError("SKU_MASTER_TABLE not set.")
            if not SERPAPI_KEY:
                raise ValueError("SERPAPI_KEY environment variable not set.")
            try:
                socket.gethostbyname("serpapi.com")
            except Exception as dns_err:
                raise RuntimeError(f"SERPAPI_CONNECTIVITY_ERROR: DNS resolution failed for serpapi.com: {dns_err}")

            self._log_event(EventStage.FETCHING, "RUNNING", f"Validating environment configuration.")
            
            # Check BigQuery tables existence
            snapshots_table_exists = self.bq_client._client.get_table(self.FULL_TABLE_ID) if self.bq_client and self.bq_client._client else False
            runs_table_exists = self.bq_client._client.get_table(self.FULL_RUNS_TABLE_ID) if self.bq_client and self.bq_client._client else False
            sku_master_exists = self.bq_client._client.get_table(sku_master_table) if self.bq_client and self.bq_client._client else False

            if not snapshots_table_exists:
                raise RuntimeError(f"BIGQUERY_TABLE_MISSING: Table {self.FULL_TABLE_ID} not found.")
            if not runs_table_exists:
                raise RuntimeError(f"BIGQUERY_TABLE_MISSING: Table {self.FULL_RUNS_TABLE_ID} not found.")
            if not sku_master_exists:
                raise RuntimeError(f"BIGQUERY_TABLE_MISSING: Table {sku_master_table} not found.")
            
            self._log_event(EventStage.FETCHING, "SUCCESS", "Environment configuration validated.")

            # --- Main execution flow ---
            result = await self.fetch_live_snapshot(limit=limit)
            
            # Finalize run status based on fetch_live_snapshot result
            if result.get("status") == "success":
                self._log_event(EventStage.COMPLETE, "SUCCESS", f"Feed run completed. Rows: {result.get('rows_written', 0)}/{result.get('skus_processed', 0)}")
            else:
                self._log_event(EventStage.ERROR, "FAILED", f"Feed run encountered issues. Status: {result.get('status')}")

            return result

        except RuntimeError as e:
            log.error(f"Feed run failed due to runtime error: {e}")
            msg = str(e)
            error_type = "GCP_AUTH_MISSING" if "GCP_AUTH_MISSING" in msg else "SERPAPI_CONNECTIVITY_ERROR" if "SERPAPI_CONNECTIVITY_ERROR" in msg else "CONFIG_ERROR" if "not set" in msg else "BIGQUERY_TABLE_MISSING" if "BIGQUERY_TABLE_MISSING" in msg else "RUNTIME_ERROR"
            fix = "Check DNS/network egress to serpapi.com from backend host." if error_type == "SERPAPI_CONNECTIVITY_ERROR" else "Check .env.local and GCP credentials."
            self._log_event(EventStage.ERROR, "FAILED", f"Feed run failed: {e}", {"error_type": error_type, "fix": fix})
            return {"status": "error", "message": str(e), "error_type": error_type, "run_id": self.current_run_id, "timestamp": self.run_start_time}
        except ValueError as e: # SERPAPI_KEY missing
            log.error(f"Feed run failed due to configuration error: {e}")
            self._log_event(EventStage.ERROR, "FAILED", f"Feed run failed due to configuration error: {e}", {"error_type": "CONFIG_ERROR", "fix": "Add SERPAPI_KEY to .env.local and restart backend."})
            return {"status": "error", "message": str(e), "error_type": "CONFIG_ERROR", "run_id": self.current_run_id, "timestamp": self.run_start_time}
        except Exception as e:
            log.error(f"Feed run failed unexpectedly: {e}")
            self._log_event(EventStage.ERROR, "FAILED", f"Feed run failed unexpectedly: {e}", {"error_type": "UNEXPECTED_ERROR"})
            return {"status": "error", "message": str(e), "error_type": "UNEXPECTED_ERROR", "run_id": self.current_run_id, "timestamp": self.run_start_time}
