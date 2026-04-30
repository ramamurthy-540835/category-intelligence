import os
import logging
import asyncio
import aiohttp
import re
from datetime import datetime
import uuid
from typing import List, Dict, Any, Optional

from google.cloud import bigquery

log = logging.getLogger(__name__)

class CompetitorPriceFeed:
  SERPAPI_URL = "https://serpapi.com/search.json"
  COMPETITOR_NAME = "Google Shopping"
  BQ_TABLE_NAME = "competitor_price_snapshots"
  BQ_RUNS_TABLE_NAME = "competitor_price_feed_runs"

  def __init__(self):
    self.api_key: Optional[str] = os.environ.get('SERPAPI_KEY')
    if not self.api_key:
      raise ValueError("SERPAPI_KEY environment variable not set.")

    self.project_id: str = os.environ.get('GCP_PROJECT_ID', 'ctoteam')
    self.dataset_id: str = os.environ.get('BIGQUERY_DATASET', 'category_intelligence')
    self.full_table_id: str = f"{self.project_id}.{self.dataset_id}.{self.BQ_TABLE_NAME}"
    self.runs_table_id: str = f"{self.project_id}.{self.dataset_id}.{self.BQ_RUNS_TABLE_NAME}"
    self.bq_client: bigquery.Client = bigquery.Client(project=self.project_id)
    self.sku_master_table_id: str = os.environ.get(
      "SKU_MASTER_TABLE",
      f"{self.project_id}.{self.dataset_id}.sku_master"
    )

  def fetch_skus_to_track(self, limit: int = 500) -> List[Dict[str, Any]]:
    sql = f"""
      SELECT
        CAST(sku_id AS STRING) AS sku_id,
        CAST(COALESCE(sku_name, sku_id) AS STRING) AS name,
        CAST(COALESCE(our_price, 0) AS FLOAT64) AS our_price
      FROM `{self.sku_master_table_id}`
      WHERE COALESCE(active_flag, TRUE) = TRUE
      LIMIT @limit
    """
    job = self.bq_client.query(
      sql,
      job_config=bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("limit", "INT64", limit)]
      ),
    )
    rows = list(job.result())
    return [dict(r.items()) for r in rows]

  async def fetch_price(self, session: aiohttp.ClientSession, sku: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    params: Dict[str, str] = {
      'engine': 'google_shopping',
      'q': sku['name'],
      'api_key': self.api_key
    }
    try:
      async with session.get(self.SERPAPI_URL, params=params) as response:
        if response.status != 200:
          log.error("SerpAPI request failed for %s: %s", sku['sku_id'], response.status)
          return None

        json_data: Dict[str, Any] = await response.json()
        shopping_results: Optional[List[Dict[str, Any]]] = json_data.get('shopping_results')
        if not shopping_results or not shopping_results[0].get('price'):
          return None

        price_str: str = shopping_results[0]['price']
        cleaned_price_str: str = re.sub(r'[^\d.]', '', price_str)
        competitor_price: float = float(cleaned_price_str)

        return {
          'sku_id': sku['sku_id'],
          'sku_name': sku['name'],
          'competitor': self.COMPETITOR_NAME,
          'competitor_price': competitor_price,
          'in_stock': True,
          'retailer_price': sku['our_price']
        }
    except Exception as e:
      log.error("Price fetch failed for %s: %s", sku['sku_id'], e)
      return None

  async def fetch_live_snapshot(self, limit: int = 500) -> Dict[str, Any]:
    start_time = datetime.utcnow().isoformat()
    skus = self.fetch_skus_to_track(limit=limit)
    async with aiohttp.ClientSession() as session:
      tasks = [self.fetch_price(session, sku) for sku in skus]
      results = await asyncio.gather(*tasks)

    rows: List[Dict[str, Any]] = []
    for row in [r for r in results if r]:
      our_price = row['retailer_price']
      competitor_price = row['competitor_price']
      price_gap_pct = ((our_price - competitor_price) / our_price) * 100 if our_price else None
      row['price_gap_pct'] = price_gap_pct
      row['snapshot_time'] = start_time
      row['url'] = ""
      rows.append(row)

    return {"timestamp": start_time, "rows": rows, "skus_fetched": len(skus)}

  async def run(self, limit: int = 500) -> Dict[str, Any]:
    run_id = str(uuid.uuid4())
    snapshot = await self.fetch_live_snapshot(limit=limit)
    rows_written = self._write_to_bq(snapshot["rows"])
    self._write_run_metadata(
      run_id=run_id,
      timestamp=snapshot["timestamp"],
      skus_fetched=snapshot.get("skus_fetched", 0),
      rows_written=rows_written,
      status="success" if rows_written > 0 else "partial"
    )
    return {
      'run_id': run_id,
      'skus_fetched': snapshot.get("skus_fetched", 0),
      'rows_written': rows_written,
      'timestamp': snapshot["timestamp"]
    }

  def _write_to_bq(self, rows: List[Dict[str, Any]]) -> int:
    if not rows:
      return 0
    try:
      errors = self.bq_client.insert_rows_json(self.full_table_id, rows)
      if errors:
        log.error("BigQuery insert errors: %s", errors)
        return 0
      return len(rows)
    except Exception as e:
      log.error("Failed writing to BigQuery: %s", e)
      return 0

  def _write_run_metadata(
    self,
    run_id: str,
    timestamp: str,
    skus_fetched: int,
    rows_written: int,
    status: str,
  ) -> None:
    try:
      self.bq_client.insert_rows_json(
        self.runs_table_id,
        [{
          "run_id": run_id,
          "timestamp": timestamp,
          "skus_fetched": skus_fetched,
          "rows_written": rows_written,
          "status": status,
        }],
      )
    except Exception as e:
      log.error("Failed writing run metadata: %s", e)
