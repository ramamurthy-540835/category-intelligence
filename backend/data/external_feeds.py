import os
import logging
import asyncio
import aiohttp
import re
from datetime import datetime
from typing import List, Dict, Any, Optional

from google.cloud import bigquery

log = logging.getLogger(__name__)

SKUS_TO_TRACK: List[Dict[str, Any]] = [
  {'sku_id': 'LG-C3-55',        'name': 'LG C3 OLED 55 inch TV',    'our_price': 1299.99},
  {'sku_id': 'LG-C3-65',        'name': 'LG C3 OLED 65 inch TV',    'our_price': 1799.99},
  {'sku_id': 'SAMSUNG-QN85C-65','name': 'Samsung QN85C 65 inch TV', 'our_price': 1499.99},
  {'sku_id': 'SONY-X90L-75',    'name': 'Sony X90L 75 inch TV',     'our_price': 1999.99},
  {'sku_id': 'TCL-QM8-65',      'name': 'TCL QM8 65 inch TV',       'our_price': 799.99},
  {'sku_id': 'HISENSE-U8K-65',  'name': 'Hisense U8K 65 inch TV',   'our_price': 699.99},
  {'sku_id': 'BOSE-SB900',      'name': 'Bose Soundbar 900',        'our_price': 899.99},
]

class CompetitorPriceFeed:
  SERPAPI_URL = "https://serpapi.com/search.json"
  COMPETITOR_NAME = "Google Shopping"
  BQ_TABLE_NAME = "competitor_price_snapshots"

  def __init__(self):
    self.api_key: Optional[str] = os.environ.get('SERPAPI_KEY')
    if not self.api_key:
      raise ValueError("SERPAPI_KEY environment variable not set.")

    self.project_id: str = os.environ.get('GCP_PROJECT_ID', 'ctoteam')
    self.dataset_id: str = os.environ.get('BIGQUERY_DATASET', 'category_intelligence')
    self.full_table_id: str = f"{self.project_id}.{self.dataset_id}.{self.BQ_TABLE_NAME}"
    self.bq_client: bigquery.Client = bigquery.Client(project=self.project_id)

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
          'name': sku['name'],
          'competitor': self.COMPETITOR_NAME,
          'competitor_price': competitor_price,
          'in_stock': True,
          'our_price': sku['our_price']
        }
    except Exception as e:
      log.error("Price fetch failed for %s: %s", sku['sku_id'], e)
      return None

  async def fetch_live_snapshot(self) -> Dict[str, Any]:
    start_time = datetime.utcnow().isoformat()
    async with aiohttp.ClientSession() as session:
      tasks = [self.fetch_price(session, sku) for sku in SKUS_TO_TRACK]
      results = await asyncio.gather(*tasks)

    rows: List[Dict[str, Any]] = []
    for row in [r for r in results if r]:
      our_price = row['our_price']
      competitor_price = row['competitor_price']
      price_gap_pct = ((our_price - competitor_price) / our_price) * 100 if our_price else None
      row['price_gap_pct'] = price_gap_pct
      row['timestamp'] = start_time
      rows.append(row)

    return {"timestamp": start_time, "rows": rows}

  async def run(self) -> Dict[str, Any]:
    snapshot = await self.fetch_live_snapshot()
    rows_written = self._write_to_bq(snapshot["rows"])
    return {
      'skus_fetched': len(SKUS_TO_TRACK),
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
