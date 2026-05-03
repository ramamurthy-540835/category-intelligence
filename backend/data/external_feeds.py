import os
import asyncio
import aiohttp
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

class CompetitorPriceFeed:
    SERPAPI_URL = "https://serpapi.com/search.json"
    COMPETITOR_NAME = "Google Shopping"
    # Use the dataset from the environment variable
    PROJECT = os.environ.get("GCP_PROJECT_ID", os.environ.get("GOOGLE_CLOUD_PROJECT"))
    DATASET = os.environ.get("BIGQUERY_DATASET", "category_intelligence")
    TABLE_NAME = "competitor_price_snapshots"
    RUNS_TABLE_NAME = "competitor_price_feed_runs"
    # Construct full table IDs using the DATASET variable
    FULL_TABLE_ID = f"{PROJECT}.{DATASET}.{TABLE_NAME}"
    FULL_RUNS_TABLE_ID = f"{PROJECT}.{DATASET}.{RUNS_TABLE_NAME}"

    def __init__(self):
        if not SERPAPI_KEY:
            raise ValueError("SERPAPI_KEY environment variable not set.")
        
        # Ensure BigQuery client is initialized and authenticated
        if bq_client_instance is None or bq_client_instance._client is None:
            raise RuntimeError("GCP_AUTH_MISSING: BigQuery client not initialized due to missing credentials.")
        self.bq_client = bq_client_instance
        # Construct SKU master table ID using the DATASET variable
        self.sku_master_table_id: str = os.environ.get(
            "SKU_MASTER_TABLE",
            f"{self.PROJECT}.{self.DATASET}.sku_master"
        )

    async def fetch_skus_to_track(self, limit: int = 500) -> List[Dict[str, Any]]:
        """Fetches SKUs from BigQuery that are marked for tracking."""
        sql = f"""
            SELECT sku_id, sku_name, COALESCE(active_flag, TRUE) as is_active
            FROM `{self.sku_master_table_id}`
            WHERE COALESCE(active_flag, TRUE) = TRUE
            LIMIT @limit
        """
        try:
            rows = await self.bq_client.query(sql, {"limit": limit})
            return rows
        except Exception as e:
            log.error(f"Error fetching SKUs to track: {e}")
            return []

    async def fetch_price(self, session: aiohttp.ClientSession, sku: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Fetches live price for a single SKU using SerpApi."""
        params = {
            "engine": "google_shopping",
            "api_key": SERPAPI_KEY,
            "q": f"{sku.get('sku_name', sku.get('sku_id'))}", # Query for the SKU name or ID
            "hl": "en",
            "gl": "us",
            "device": "desktop",
        }
        try:
            async with session.get(self.SERPAPI_URL, params=params) as response:
                response.raise_for_status()
                data = await response.json()

                if "error" in data:
                    log.error(f"SerpApi error for SKU {sku.get('sku_id')}: {data['error']}")
                    return None

                products = data.get("products", [])
                if not products:
                    return None

                # Find the most relevant product (e.g., first one)
                product = products[0]
                price_str = product.get('price')
                competitor_price = 0.0
                if price_str:
                    cleaned_price_str = re.sub(r'[^\d.]', '', price_str)
                    try:
                        competitor_price = float(cleaned_price_str)
                    except ValueError:
                        log.warning(f"Could not parse price '{price_str}' for SKU {sku.get('sku_id')}")

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
            return None
        except Exception as e:
            log.error(f"Unexpected error fetching price for SKU {sku.get('sku_id')}: {e}")
            return None

    async def fetch_live_snapshot(self, limit: int = 500) -> Dict[str, Any]:
        """Fetches live prices for multiple SKUs and returns a snapshot."""
        skus_to_track = await self.fetch_skus_to_track(limit=limit)
        if not skus_to_track:
            return {"status": "no_skus_to_track", "rows": [], "timestamp": None}

        rows_to_write = []
        async with aiohttp.ClientSession() as session:
            tasks = [self.fetch_price(session, sku) for sku in skus_to_track]
            results = await asyncio.gather(*tasks)

            for result in results:
                if result and result.get("sku_id"): # Ensure we have a valid SKU ID
                    rows_to_write.append(result)

        timestamp = datetime.datetime.now().isoformat()
        
        # Write to BigQuery
        rows_written = self._write_to_bq(rows_to_write, timestamp)
        self._write_run_metadata(
            run_id=str(uuid.uuid4()),
            timestamp=timestamp,
            skus_fetched=len(skus_to_track),
            rows_written=rows_written,
            status="success" if rows_written > 0 else "partial"
        )

        return {
            "status": "success",
            "rows": rows_to_write,
            "timestamp": timestamp,
            "rows_written": rows_written,
            "skus_processed": len(skus_to_track)
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
            errors = self.bq_client._client.insert_rows_json(self.FULL_TABLE_ID, rows)
            if errors:
                log.error("BigQuery insert errors: %s", errors)
                return 0
            log.info(f"Successfully inserted {len(rows)} rows into {self.FULL_TABLE_ID}")
            return len(rows)
        except Exception as e:
            log.error(f"Error writing to BigQuery table {self.FULL_TABLE_ID}: {e}")
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
            errors = self.bq_client._client.insert_rows_json(self.FULL_RUNS_TABLE_ID, [metadata])
            if errors:
                log.error("BigQuery run metadata insert errors: %s", errors)
            else:
                log.info(f"Successfully inserted run metadata into {self.FULL_RUNS_TABLE_ID}")
        except Exception as e:
            log.error(f"Error writing run metadata to BigQuery table {self.FULL_RUNS_TABLE_ID}: {e}")

    async def run(self, limit: int = 500) -> Dict[str, Any]:
        """Main entry point to run the feed."""
        try:
            # Check for GCP auth here as well, though __init__ should catch it
            if bq_client_instance is None or bq_client_instance._client is None:
                raise RuntimeError("GCP_AUTH_MISSING: BigQuery client not available.")
            
            # Check if SERPAPI_KEY is set before proceeding
            if not SERPAPI_KEY:
                raise ValueError("SERPAPI_KEY environment variable not set.")

            return await self.fetch_live_snapshot(limit=limit)
        except RuntimeError as e:
            log.error(f"Feed run failed due to auth error: {e}")
            return {"status": "error", "message": str(e), "error_type": "GCP_AUTH_MISSING"}
        except ValueError as e: # SERPAPI_KEY missing
            log.error(f"Feed run failed due to configuration error: {e}")
            return {"status": "error", "message": str(e), "error_type": "CONFIG_ERROR"}
        except Exception as e:
            log.error(f"Feed run failed unexpectedly: {e}")
            return {"status": "error", "message": str(e)}
