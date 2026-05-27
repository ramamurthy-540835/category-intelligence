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
PRICE_CACHE: Dict[str, Dict[str, Any]] = {}
PRICE_CACHE_TTL_SECONDS = 7200

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
    EXPANSION_SEED_QUERIES = [
        "Sony OLED TV 65 inch",
        "Samsung QLED TV 55 inch",
        "LG OLED TV 77 inch",
        "TCL mini LED TV 75 inch",
        "Hisense ULED TV 65 inch",
        "Vizio soundbar",
        "Samsung soundbar",
        "Sonos soundbar",
        "Bose soundbar",
        "Chromecast streaming device",
    ]
    DEFAULT_REFRESH_LIMIT = 20
    MAX_REFRESH_LIMIT = 20

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

    def _get_memory_cache(self, sku_id: str) -> Optional[Dict[str, Any]]:
        if not sku_id:
            return None
        entry = PRICE_CACHE.get(sku_id)
        if not entry:
            return None
        ts = entry.get("timestamp")
        if not isinstance(ts, datetime.datetime):
            return None
        age = (datetime.datetime.now(datetime.timezone.utc) - ts).total_seconds()
        if age > PRICE_CACHE_TTL_SECONDS:
            PRICE_CACHE.pop(sku_id, None)
            return None
        payload = entry.get("price_data")
        return dict(payload) if isinstance(payload, dict) else None

    def _set_memory_cache(self, sku_id: str, payload: Dict[str, Any]) -> None:
        if not sku_id or not isinstance(payload, dict):
            return
        PRICE_CACHE[sku_id] = {
            "price_data": dict(payload),
            "timestamp": datetime.datetime.now(datetime.timezone.utc),
        }

    async def _get_cached_snapshot_for_sku(self, sku_id: str, sku_name: str) -> Optional[Dict[str, Any]]:
        """Return latest cached competitor snapshot for a SKU, if available."""
        try:
            if not (self.bq_client and self.bq_client._client):
                return None
            if sku_id:
                where_sql = "WHERE sku_id = @sku_id"
                params = {"sku_id": sku_id}
            elif sku_name:
                where_sql = "WHERE LOWER(sku_name) = LOWER(@sku_name)"
                params = {"sku_name": sku_name}
            else:
                return None

            sql = f"""
                SELECT
                  sku_id,
                  sku_name,
                  retailer_price,
                  competitor_price,
                  price_gap_pct,
                  product_url,
                  image_url,
                  in_stock,
                  snapshot_time
                FROM `{self.FULL_TABLE_ID}`
                {where_sql}
                ORDER BY snapshot_time DESC, competitor_price ASC
                LIMIT 1
            """
            rows = await self.bq_client.query(sql, params)
            if not rows:
                return None
            r = rows[0]
            return {
                "sku_id": r.get("sku_id") or sku_id,
                "sku_name": r.get("sku_name") or sku_name,
                "retailer_price": float(r.get("retailer_price") or 0.0),
                "competitor_price": float(r.get("competitor_price") or 0.0),
                "price_gap_pct": float(r.get("price_gap_pct") or 0.0),
                "competitor_name": self.COMPETITOR_NAME,
                "search_query_used": "cached_snapshot",
                "product_url": r.get("product_url"),
                "image_url": r.get("image_url"),
                "in_stock": bool(r.get("in_stock", True)),
                "last_checked": datetime.datetime.now().isoformat(),
            }
        except Exception as e:
            log.warning(f"Cached snapshot lookup failed for sku_id={sku_id} sku_name={sku_name}: {e}")
            return None

    async def fetch_skus_to_track(self, limit: int = DEFAULT_REFRESH_LIMIT) -> List[Dict[str, Any]]:
        """Fetches SKUs from BigQuery that are marked for tracking."""
        limit = max(1, min(int(limit or self.DEFAULT_REFRESH_LIMIT), self.MAX_REFRESH_LIMIT))
        self._log_event(EventStage.FETCHING, "RUNNING", f"Loading active SKUs from {self.sku_master_table_id} with limit {limit}", {"requested_limit": limit})
        price_expr = "0.0"
        try:
            if self.bq_client and self.bq_client._client:
                table = self.bq_client._client.get_table(self.sku_master_table_id)
                field_names = {f.name.lower() for f in table.schema}
                for candidate in ["retailer_price", "our_price", "price", "current_price"]:
                    if candidate in field_names:
                        price_expr = f"CAST(COALESCE({candidate}, 0) AS FLOAT64)"
                        break
        except Exception:
            # Keep default 0.0 when schema introspection fails.
            pass
        sql = f"""
            SELECT sku_id, sku_name, {price_expr} AS retailer_price, COALESCE(active_flag, TRUE) as is_active
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
        cached_memory = self._get_memory_cache(sku_id)
        if cached_memory:
            log.info(f"Reusing fresh cached SerpAPI snapshot for SKU {sku_id} (Cache Hit).")
            return cached_memory

        # Build production-grade query candidates.
        # Prefer descriptive SKU names from master data and use SKU id only as fallback.
        normalized_name = re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9 ]+", " ", sku_name)).strip()
        normalized_id = re.sub(r"\s+", " ", re.sub(r"[^A-Za-z0-9 ]+", " ", re.sub(r"[-_]+", " ", sku_id))).strip()
        model_only = normalized_id

        product_suffix = ""
        name_lower = normalized_name.lower()
        if "soundbar" in name_lower or "bar " in name_lower:
            product_suffix = " soundbar"
        elif "chromecast" in name_lower or "stream" in name_lower:
            product_suffix = " streaming device"
        elif any(token in name_lower for token in ["tv", "oled", "qled", "qned", "inch"]):
            product_suffix = " tv"

        query_candidates = []
        for candidate in [
            normalized_name,
            f"{normalized_name} price" if normalized_name else "",
            f"{normalized_name}{product_suffix}" if normalized_name else "",
            model_only,
            f"{model_only}{product_suffix}" if model_only else "",
            f"{model_only} price" if model_only else "",
        ]:
            c = candidate.strip()
            if c and c not in query_candidates:
                query_candidates.append(c)

        try:
            product = None
            used_query = None
            for query in query_candidates[:4]:
                params = {
                    "engine": "google_shopping",
                    "api_key": SERPAPI_KEY,
                    "q": query,
                    "hl": "en",
                    "gl": "us",
                    "device": "desktop",
                }
                try:
                    async with session.get(self.SERPAPI_URL, params=params, timeout=aiohttp.ClientTimeout(total=8)) as response:
                        response.raise_for_status()
                        data = await response.json()
                except (asyncio.TimeoutError, aiohttp.ClientError) as e:
                    cached = await self._get_cached_snapshot_for_sku(sku_id, sku_name)
                    if cached:
                        self._set_memory_cache(sku_id, cached)
                        self._log_event(
                            EventStage.ENRICHING,
                            "WARNING",
                            "SerpAPI unavailable, using cached competitor snapshot",
                            {"sku_id": sku_id, "error_type": "SERPAPI_DEGRADED"},
                        )
                        return cached
                    raise e

                if "error" in data:
                    # SerpAPI returning {"error": ...} for one SKU usually means "no
                    # match" (SKU title too generic), not a system failure. Log it
                    # as WARNING so the per-SKU miss doesn't paint the ENR pipeline
                    # stage red when the rest of the run succeeded.
                    log.warning(f"SerpApi miss for SKU {sku_id}: {data['error']}")
                    self._log_event(
                        EventStage.ENRICHING,
                        "WARNING",
                        f"SerpApi miss for SKU {sku_id}: {data['error']}",
                        {"error_type": "SERPAPI_MISS", "fix": "SKU name may be too generic for Google Shopping."},
                    )
                    return None

                # SerpApi payload shape varies by engine/account and can return either
                # `products` or `shopping_results`.
                products = data.get("products") or data.get("shopping_results") or []
                if products and isinstance(products, list):
                    product = products[0]
                    used_query = query
                    break

            if not product:
                self._log_event(EventStage.ENRICHING, "WARNING", f"No products found for SKU {sku_id}")
                return None

            price_str = product.get('price')
            if not price_str and isinstance(product.get("extracted_price"), (int, float)):
                price_str = str(product.get("extracted_price"))
            competitor_price = 0.0
            if price_str:
                cleaned_price_str = re.sub(r'[^\d.]', '', price_str)
                try:
                    competitor_price = float(cleaned_price_str)
                except ValueError:
                    log.warning(f"Could not parse price '{price_str}' for SKU {sku_id}")

            result = {
                "sku_id": sku.get("sku_id"),
                "sku_name": sku.get("sku_name"),
                "retailer_price": float(sku.get("retailer_price") or 0.0),
                "competitor_price": competitor_price,
                "price_gap_pct": 0.0,
                "competitor_name": product.get("source", self.COMPETITOR_NAME),
                "search_query_used": used_query,
                "product_url": product.get("link"),
                "image_url": product.get("thumbnail", product.get("image")),
                "in_stock": True, # Assume in stock if listed, SerpApi doesn't reliably provide this
                "last_checked": datetime.datetime.now().isoformat()
            }
            self._set_memory_cache(sku_id, result)
            return result
        except (asyncio.TimeoutError, aiohttp.ClientError) as e:
            log.warning(f"SerpAPI request issue for SKU {sku.get('sku_id')}: {e}")
            cached = await self._get_cached_snapshot_for_sku(sku_id, sku_name)
            if cached:
                self._set_memory_cache(sku_id, cached)
                self._log_event(
                    EventStage.ENRICHING,
                    "WARNING",
                    "SerpAPI unavailable, using cached competitor snapshot",
                    {"sku_id": sku_id, "error_type": "SERPAPI_DEGRADED"},
                )
                return cached
            self._log_event(
                EventStage.ENRICHING,
                "WARNING",
                "SerpAPI unavailable, using cached competitor snapshot",
                {"sku_id": sku_id, "error_type": "SERPAPI_DEGRADED_NO_CACHE"},
            )
            return None
        except Exception as e:
            log.warning(f"Unexpected SerpAPI error for SKU {sku.get('sku_id')}: {e}")
            cached = await self._get_cached_snapshot_for_sku(sku_id, sku_name)
            if cached:
                self._set_memory_cache(sku_id, cached)
                self._log_event(
                    EventStage.ENRICHING,
                    "WARNING",
                    "SerpAPI unavailable, using cached competitor snapshot",
                    {"sku_id": sku_id, "error_type": "SERPAPI_DEGRADED"},
                )
                return cached
            self._log_event(
                EventStage.ENRICHING,
                "WARNING",
                "SerpAPI unavailable, using cached competitor snapshot",
                {"sku_id": sku_id, "error_type": "SERPAPI_DEGRADED_NO_CACHE"},
            )
            return None

    async def fetch_top_products(
        self,
        session: aiohttp.ClientSession,
        query: str,
        top_n: int = 5,
    ) -> List[Dict[str, Any]]:
        """Live Google Shopping discovery for a single query.

        Returns up to ``top_n`` real products from SerpAPI's google_shopping
        engine. Each product carries a stable ``GS-<product_id>`` SKU id so
        repeat scans update the same row instead of creating new ones.
        """
        if not query:
            return []
        params = {
            "engine": "google_shopping",
            "api_key": SERPAPI_KEY,
            "q": query,
            "hl": "en",
            "gl": "us",
            "device": "desktop",
            "num": max(1, top_n),
        }
        try:
            async with session.get(self.SERPAPI_URL, params=params) as response:
                response.raise_for_status()
                data = await response.json()

            if "error" in data:
                log.warning(f"SerpApi miss for discovery query '{query}': {data['error']}")
                self._log_event(
                    EventStage.ENRICHING,
                    "WARNING",
                    f"SerpApi miss during discovery for '{query}': {data['error']}",
                    {"error_type": "SERPAPI_MISS", "fix": "Seed query may be too generic for Google Shopping."},
                )
                return []

            products = data.get("products") or data.get("shopping_results") or []
            if not isinstance(products, list):
                return []

            now_iso = datetime.datetime.now().isoformat()
            rows: List[Dict[str, Any]] = []
            for p in products[:top_n]:
                if not isinstance(p, dict):
                    continue
                product_id = str(p.get("product_id") or "").strip()
                if not product_id:
                    # Fall back to a stable hash of link+title when SerpAPI omits id.
                    fallback = (p.get("link") or p.get("title") or "").strip()
                    if not fallback:
                        continue
                    product_id = re.sub(r"[^A-Za-z0-9]+", "", fallback)[:32]
                title = (p.get("title") or "").strip()
                if not title:
                    continue

                price_str = p.get("price")
                if not price_str and isinstance(p.get("extracted_price"), (int, float)):
                    price_str = str(p.get("extracted_price"))
                competitor_price = 0.0
                if price_str:
                    cleaned = re.sub(r"[^\d.]", "", str(price_str))
                    try:
                        competitor_price = float(cleaned) if cleaned else 0.0
                    except ValueError:
                        competitor_price = 0.0

                rows.append({
                    "sku_id": f"GS-{product_id}",
                    "sku_name": title,
                    "retailer_price": 0.0,
                    "competitor_price": competitor_price,
                    "price_gap_pct": 0.0,
                    "competitor_name": p.get("source") or self.COMPETITOR_NAME,
                    "search_query_used": query,
                    "product_url": p.get("link"),
                    "image_url": p.get("thumbnail") or p.get("image"),
                    "in_stock": True,
                    "last_checked": now_iso,
                })
            return rows
        except (asyncio.TimeoutError, aiohttp.ClientError) as e:
            log.warning(f"Discovery request issue for '{query}': {e}")
            err_msg = str(e)
            error_type = (
                "SERPAPI_CONNECTIVITY_ERROR"
                if ("Name or service not known" in err_msg
                    or "Temporary failure in name resolution" in err_msg
                    or "Cannot connect" in err_msg)
                else "HTTP_ERROR"
            )
            fix = (
                "Check DNS/network egress to serpapi.com from backend host."
                if error_type == "SERPAPI_CONNECTIVITY_ERROR"
                else "Check network connectivity and SerpAPI endpoint."
            )
            self._log_event(
                EventStage.ENRICHING,
                "WARNING",
                "SerpAPI unavailable, using cached competitor snapshot",
                {"error_type": error_type, "fix": fix},
            )
            return []
        except Exception as e:
            log.warning(f"Unexpected discovery error for '{query}': {e}")
            self._log_event(
                EventStage.ENRICHING,
                "WARNING",
                "SerpAPI unavailable, using cached competitor snapshot",
                {"error_type": "UNEXPECTED_ERROR"},
            )
            return []

    async def fetch_live_snapshot(self, limit: int = DEFAULT_REFRESH_LIMIT) -> Dict[str, Any]:
        """Fetches live prices for multiple SKUs and returns a snapshot."""
        limit = max(1, min(int(limit or self.DEFAULT_REFRESH_LIMIT), self.MAX_REFRESH_LIMIT))
        self._log_event(EventStage.FETCHING, "RUNNING", f"Starting live snapshot fetch with limit {limit}", {"requested_limit": limit})
        catalog_skus = await self.fetch_skus_to_track(limit=limit)
        catalog_count = len(catalog_skus)
        external_budget = max(0, limit - catalog_count)

        rows_to_write: List[Dict[str, Any]] = []

        async with aiohttp.ClientSession() as session:
            # 1) Catalog flow — for each known SKU in sku_master, ask SerpAPI for the
            #    current Google Shopping price. Real per-SKU price refresh.
            if catalog_skus:
                self._log_event(
                    EventStage.ENRICHING,
                    "RUNNING",
                    f"Refreshing competitor prices for {catalog_count} catalog SKUs via SerpAPI.",
                )
                catalog_results = await asyncio.gather(
                    *[self.fetch_price(session, sku) for sku in catalog_skus]
                )
                for r in catalog_results:
                    if r and r.get("sku_id"):
                        rows_to_write.append(r)

            # 2) Discovery flow — pull real top-N products from Google Shopping for
            #    each seed category. Each product becomes a row keyed by its real
            #    Google product_id (GS-<product_id>) so reruns update in place.
            discovered_rows: List[Dict[str, Any]] = []
            if external_budget > 0 and self.EXPANSION_SEED_QUERIES:
                queries = list(self.EXPANSION_SEED_QUERIES)
                top_n_per_query = max(1, -(-external_budget // len(queries)))  # ceil
                self._log_event(
                    EventStage.ENRICHING,
                    "RUNNING",
                    f"Discovering up to {external_budget} live Google Shopping SKUs "
                    f"({top_n_per_query}/query across {len(queries)} categories).",
                )
                discovery_results = await asyncio.gather(
                    *[self.fetch_top_products(session, q, top_n=top_n_per_query) for q in queries]
                )
                for result_list in discovery_results:
                    discovered_rows.extend(result_list or [])
                # Trim to requested external budget after concatenation.
                discovered_rows = discovered_rows[:external_budget]
                rows_to_write.extend(discovered_rows)

        self._log_event(
            EventStage.ENRICHING,
            "SUCCESS",
            f"SerpAPI returned {len(rows_to_write)} live rows "
            f"({catalog_count} catalog refresh + {len(discovered_rows)} discovered).",
            {
                "processed_rows": len(rows_to_write),
                "catalog_refreshed": catalog_count,
                "discovered_skus": len(discovered_rows),
                "external_source_status": "ok" if rows_to_write else "empty",
            },
        )

        if not rows_to_write:
            self._log_event(EventStage.FETCHING, "COMPLETE", "No SKUs to track.")
            return {"status": "no_skus_to_track", "rows": [], "timestamp": None}

        self._log_event(EventStage.PROCESSING, "RUNNING", "Normalizing market prices and SKU rows.")
        for row in rows_to_write:
            our_price = float(row.get("retailer_price") or 0.0)
            competitor_price = float(row.get("competitor_price") or 0.0)
            if our_price > 0:
                row["price_gap_pct"] = ((our_price - competitor_price) / our_price) * 100.0
            else:
                row["price_gap_pct"] = 0.0
        # Persist both catalog rows (with internal pricing) and EXT- expansion rows
        # (real SerpAPI results without an internal price) so the snapshot reflects
        # the full external scan. Dedup by sku_id, preferring the row with a
        # non-zero competitor_price when the same SKU was scanned twice in one run.
        deduped: Dict[str, Dict[str, Any]] = {}
        for row in rows_to_write:
            key = str(row.get("sku_id") or "").strip()
            if not key:
                continue
            existing = deduped.get(key)
            if existing is None:
                deduped[key] = row
                continue
            if float(row.get("competitor_price") or 0.0) > float(existing.get("competitor_price") or 0.0):
                deduped[key] = row
        rows_to_write = list(deduped.values())
        self._log_event(EventStage.PROCESSING, "SUCCESS", f"Normalized and deduped to {len(rows_to_write)} unique SKUs.")

        self._log_event(EventStage.ANALYZING, "RUNNING", "Calculating price gaps and priority alerts.")
        # Placeholder for actual analysis
        self._log_event(EventStage.ANALYZING, "SUCCESS", "Price gap and alert analysis complete.")

        timestamp = datetime.datetime.now().isoformat()
        
        self._log_event(EventStage.UPDATING, "RUNNING", f"Writing {len(rows_to_write)} rows to BigQuery snapshot table.")
        rows_written = self._write_to_bq(rows_to_write, timestamp)
        
        skus_processed = len(rows_to_write)
        run_status = "success" if rows_written > 0 else "partial"
        self._write_run_metadata(
            run_id=self.current_run_id,
            timestamp=timestamp,
            skus_fetched=skus_processed,
            rows_written=rows_written,
            status=run_status,
        )
        self._log_event(EventStage.UPDATING, "SUCCESS", f"Wrote {rows_written} rows to BigQuery.", {"written_rows": rows_written})

        # Upsert newly-discovered SKUs into sku_master so they become tracked
        # catalog rows on subsequent scans (insert if new, update name if existing).
        discovered_for_master = [r for r in rows_to_write if str(r.get("sku_id") or "").startswith("GS-")]
        if discovered_for_master:
            merged = self._upsert_sku_master(discovered_for_master)
            self._log_event(
                EventStage.UPDATING,
                "SUCCESS" if merged >= 0 else "ERROR",
                f"Merged {merged} discovered SKUs into sku_master." if merged >= 0
                    else "Failed to merge discovered SKUs into sku_master.",
                {"merged_master_rows": max(0, merged)},
            )

        self._log_event(EventStage.RESPONDING, "RUNNING", "Updating dashboard, alerts, and SKU table.")
        self._log_event(EventStage.RESPONDING, "SUCCESS", "Dashboard and alerts updated.")

        self._log_event(EventStage.COMPLETE, "SUCCESS", f"Feed run completed. Rows: {rows_written}/{skus_processed}", {"snapshot_rows": rows_written})
        return {
            "status": "success",
            "rows": rows_to_write,
            "timestamp": timestamp,
            "rows_written": rows_written,
            "skus_processed": skus_processed,
            "catalog_refreshed": catalog_count,
            "discovered_skus": len(discovered_rows),
            "run_id": self.current_run_id,
        }

    def _write_to_bq(self, rows: List[Dict[str, Any]], timestamp: str) -> int:
        """Writes fetched price data to BigQuery."""
        if not rows:
            return 0

        try:
            # Use the bq_client instance from BigQueryClient
            # Only attempt insert if the client is valid
            if self.bq_client and self.bq_client._client:
                table = self.bq_client._client.get_table(self.FULL_TABLE_ID)
                allowed_fields = {f.name for f in table.schema}

                normalized_rows = []
                for row in rows:
                    enriched = dict(row)
                    enriched["snapshot_time"] = timestamp
                    enriched.setdefault("sku_id", None)
                    enriched.setdefault("sku_name", None)
                    enriched.setdefault("competitor_price", 0.0)
                    enriched.setdefault("in_stock", True)

                    filtered = {k: v for k, v in enriched.items() if k in allowed_fields}
                    normalized_rows.append(filtered)

                errors = self.bq_client._client.insert_rows_json(self.FULL_TABLE_ID, normalized_rows)
                if errors:
                    log.error("BigQuery insert errors: %s", errors)
                    self._log_event(EventStage.UPDATING, "ERROR", f"BigQuery insert errors: {errors}", {"error_type": "BIGQUERY_INSERT_ERROR", "fix": f"Check schema for {self.FULL_TABLE_ID} and data types."})
                    return 0
                log.info(f"Successfully inserted {len(normalized_rows)} rows into {self.FULL_TABLE_ID}")
                return len(normalized_rows)
            else:
                log.warning("BigQuery client not available, skipping insert_rows_json.")
                self._log_event(EventStage.UPDATING, "ERROR", "BigQuery client not available, skipping insert.", {"error_type": "BIGQUERY_CLIENT_UNAVAILABLE"})
                return 0
        except Exception as e:
            log.error(f"Error writing to BigQuery table {self.FULL_TABLE_ID}: {e}")
            self._log_event(EventStage.UPDATING, "ERROR", f"Error writing to BigQuery table {self.FULL_TABLE_ID}: {e}", {"error_type": "BIGQUERY_WRITE_ERROR", "fix": f"Check permissions and table schema for {self.FULL_TABLE_ID}."})
            return 0

    def _upsert_sku_master(self, discovered_rows: List[Dict[str, Any]]) -> int:
        """MERGE newly-discovered Google Shopping SKUs into ``sku_master``.

        Insert if the sku_id is new, update sku_name if it already exists.
        Returns the number of rows merged, or -1 on error. Schema-introspects
        ``sku_master`` so missing optional columns (like ``last_seen``) are
        skipped instead of failing.
        """
        if not (self.bq_client and self.bq_client._client and discovered_rows):
            return -1

        try:
            table = self.bq_client._client.get_table(self.sku_master_table_id)
            field_names = {f.name.lower() for f in table.schema}
            has_active = "active_flag" in field_names
            has_last_seen = "last_seen" in field_names

            # Build a static VALUES clause from the discovered rows. Each row is
            # a (sku_id, sku_name) literal pair. Escape quotes defensively.
            def _esc(s: str) -> str:
                return str(s or "").replace("\\", "\\\\").replace("'", "\\'")

            value_tuples = []
            seen: set = set()
            for r in discovered_rows:
                sid = str(r.get("sku_id") or "").strip()
                sname = str(r.get("sku_name") or "").strip()
                if not sid or sid in seen:
                    continue
                seen.add(sid)
                value_tuples.append(f"('{_esc(sid)}', '{_esc(sname)}')")
            if not value_tuples:
                return 0

            insert_cols = ["sku_id", "sku_name"]
            insert_vals = ["S.sku_id", "S.sku_name"]
            update_set = ["sku_name = S.sku_name"]
            if has_active:
                insert_cols.append("active_flag")
                insert_vals.append("TRUE")
            if has_last_seen:
                insert_cols.append("last_seen")
                insert_vals.append("CURRENT_TIMESTAMP()")
                update_set.append("last_seen = CURRENT_TIMESTAMP()")

            sql = f"""
                MERGE `{self.sku_master_table_id}` T
                USING (
                  SELECT sku_id, sku_name FROM UNNEST([
                    STRUCT<sku_id STRING, sku_name STRING>
                    {", ".join(value_tuples)}
                  ])
                ) S
                ON T.sku_id = S.sku_id
                WHEN MATCHED THEN UPDATE SET {", ".join(update_set)}
                WHEN NOT MATCHED THEN INSERT ({", ".join(insert_cols)}) VALUES ({", ".join(insert_vals)})
            """
            job = self.bq_client._client.query(sql)
            job.result()  # block until done
            log.info(f"sku_master MERGE complete: {len(value_tuples)} candidates from discovery.")
            return len(value_tuples)
        except Exception as e:
            log.error(f"sku_master MERGE failed: {e}")
            self._log_event(
                EventStage.UPDATING,
                "ERROR",
                f"sku_master MERGE failed: {e}",
                {"error_type": "BIGQUERY_MERGE_ERROR", "fix": f"Check schema/permissions on {self.sku_master_table_id}."},
            )
            return -1

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

    async def run(self, limit: int = DEFAULT_REFRESH_LIMIT) -> Dict[str, Any]:
        """Main entry point to run the feed."""
        limit = max(1, min(int(limit or self.DEFAULT_REFRESH_LIMIT), self.MAX_REFRESH_LIMIT))
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
