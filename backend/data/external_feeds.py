import os
import logging
import asyncio
import aiohttp
import re
from datetime import datetime
from typing import List, Dict, Any, Optional

from google.cloud import bigquery

log = logging.getLogger(__name__)

# Configuration for SKUs to track
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
  """
  Fetches competitor prices from SerpAPI and stores them in BigQuery.
  """
  SERPAPI_URL = "https://serpapi.com/search.json"
  COMPETITOR_NAME = "Google Shopping"
  BQ_TABLE_NAME = "competitor_price_snapshots"

  def __init__(self):
    self.api_key: Optional[str] = os.environ.get('SERPAPI_KEY')
    if not self.api_key:
        log.error("SERPAPI_KEY environment variable not set.")
        raise ValueError("SERPAPI_KEY environment variable not set.")

    self.project_id: str = os.environ.get('GCP_PROJECT_ID', 'ctoteam')
    self.dataset_id: str = os.environ.get('BIGQUERY_DATASET', 'category_intelligence')
    self.full_table_id: str = f"{self.project_id}.{self.dataset_id}.{self.BQ_TABLE_NAME}"
    self.bq_client: bigquery.Client = bigquery.Client(project=self.project_id)

  async def fetch_price(self, session: aiohttp.ClientSession, sku: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Fetches the price for a single SKU from SerpAPI.
    """
    params: Dict[str, str] = {
        'engine': 'google_shopping',
        'q': sku['name'],
        'api_key': self.api_key
    }
    try:
      async with session.get(self.SERPAPI_URL, params=params) as response:
        if response.status != 200:
          log.error(f"SerpAPI request failed for {sku['sku_id']}: Status {response.status}, Response: {await response.text()}")
          return None
        
        json_data: Dict[str, Any] = await response.json()
        
        shopping_results: Optional[List[Dict[str, Any]]] = json_data.get('shopping_results')
        if not shopping_results or not shopping_results[0].get('price'):
          log.warning(f"No shopping results or price found for {sku['sku_id']} ({sku['name']})")
          return None
        
        price_str: str = shopping_results[0]['price']
        # Clean price string (e.g., "$1,299.99" -> "1299.99")
        cleaned_price_str: str = re.sub(r'[^\d.]', '', price_str)
        
        try:
          competitor_price: float = float(cleaned_price_str)
        except ValueError:
          log.error(f"Could not parse price '{price_str}' for {sku['sku_id']}")
          return None

        return {
            'sku_id': sku['sku_id'],
            'competitor': self.COMPETITOR_NAME,
            'competitor_price': competitor_price,
            'in_stock': True, # SerpAPI usually only returns in-stock items in shopping results
            'our_price': sku['our_price']
        }
    except aiohttp.ClientError as e:
      log.error(f"HTTP client error fetching price for {sku['sku_id']}: {e}")
      return None
    except Exception as e:
      log.error(f"Unexpected error fetching price for {sku['sku_id']}: {e}")
      return None

  async def run(self) -> Dict[str, Any]:
    """
    Fetches prices for all tracked SKUs, calculates price gaps, and writes to BigQuery.
    """
    log.info("Starting competitor price feed run.")
    start_time = datetime.utcnow()
    
    fetched_prices: List[Dict[str, Any]] = []
    async with aiohttp.ClientSession() as session:
      tasks = [self.fetch_price(session, sku) for sku in SKUS_TO_TRACK]
      results = await asyncio.gather(*tasks)
      
      for res in results:
        if res:
          fetched_prices.append(res)
    
    rows_to_insert: List[Dict[str, Any]] = []
    for price_data in fetched_prices:
      our_price = price_data['our_price']
      competitor_price = price_data['competitor_price']
      
      price_gap_pct: Optional[float] = None
      if our_price is not None and our_price != 0:
        price_gap_pct = ((our_price - competitor_price) / our_price) * 100
      
      rows_to_insert.append({
          'timestamp': start_time.isoformat(),
          'sku_id': price_data['sku_id'],
          'competitor': price_data['competitor'],
          'competitor_price': competitor_price,
          'our_price': our_price,
          'price_gap_pct': price_gap_pct,
          'in_stock': price_data['in_stock']
      })
    
    rows_written = self._write_to_bq(rows_to_insert)
    
    log.info(f"Competitor price feed run completed. Fetched {len(SKUS_TO_TRACK)} SKUs, wrote {rows_written} rows.")
    return {
        'skus_fetched': len(SKUS_TO_TRACK),
        'rows_written': rows_written,
        'timestamp': start_time.isoformat()
    }

  def _write_to_bq(self, rows: List[Dict[str, Any]]) -> int:
    """
    Writes a list of rows to the BigQuery table.
    """
    if not rows:
      log.info("No rows to write to BigQuery.")
      return 0

    try:
      errors = self.bq_client.insert_rows_json(self.full_table_id, rows)
      if errors:
        log.error(f"Errors occurred while inserting rows into BigQuery: {errors}")
        return 0
      log.info(f"Successfully wrote {len(rows)} rows to BigQuery table {self.full_table_id}")
      return len(rows)
    except Exception as e:
      log.error(f"Failed to write rows to BigQuery table {self.full_table_id}: {e}")
      return 0
import os
import logging
import asyncio
import aiohttp
import re
from datetime import datetime
from typing import List, Dict, Any, Optional

from google.cloud import bigquery

log = logging.getLogger(__name__)

# Configuration for SKUs to track
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
  """
  Fetches competitor prices from SerpAPI and stores them in BigQuery.
  """
  SERPAPI_URL = "https://serpapi.com/search.json"
  COMPETITOR_NAME = "Google Shopping"
  BQ_TABLE_NAME = "competitor_price_snapshots"

  def __init__(self):
    self.api_key: Optional[str] = os.environ.get('SERPAPI_KEY')
    if not self.api_key:
        log.error("SERPAPI_KEY environment variable not set.")
        raise ValueError("SERPAPI_KEY environment variable not set.")

    self.project_id: str = os.environ.get('GCP_PROJECT_ID', 'ctoteam')
    self.dataset_id: str = os.environ.get('BIGQUERY_DATASET', 'category_intelligence')
    self.full_table_id: str = f"{self.project_id}.{self.dataset_id}.{self.BQ_TABLE_NAME}"
    self.bq_client: bigquery.Client = bigquery.Client(project=self.project_id)

  async def fetch_price(self, session: aiohttp.ClientSession, sku: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Fetches the price for a single SKU from SerpAPI.
    """
    params: Dict[str, str] = {
        'engine': 'google_shopping',
        'q': sku['name'],
        'api_key': self.api_key
    }
    try:
      async with session.get(self.SERPAPI_URL, params=params) as response:
        if response.status != 200:
          log.error(f"SerpAPI request failed for {sku['sku_id']}: Status {response.status}, Response: {await response.text()}")
          return None
        
        json_data: Dict[str, Any] = await response.json()
        
        shopping_results: Optional[List[Dict[str, Any]]] = json_data.get('shopping_results')
        if not shopping_results or not shopping_results[0].get('price'):
          log.warning(f"No shopping results or price found for {sku['sku_id']} ({sku['name']})")
          return None
        
        price_str: str = shopping_results[0]['price']
        # Clean price string (e.g., "$1,299.99" -> "1299.99")
        cleaned_price_str: str = re.sub(r'[^\d.]', '', price_str)
        
        try:
          competitor_price: float = float(cleaned_price_str)
        except ValueError:
          log.error(f"Could not parse price '{price_str}' for {sku['sku_id']}")
          return None

        return {
            'sku_id': sku['sku_id'],
            'competitor': self.COMPETITOR_NAME,
            'competitor_price': competitor_price,
            'in_stock': True, # SerpAPI usually only returns in-stock items in shopping results
            'our_price': sku['our_price']
        }
    except aiohttp.ClientError as e:
      log.error(f"HTTP client error fetching price for {sku['sku_id']}: {e}")
      return None
    except Exception as e:
      log.error(f"Unexpected error fetching price for {sku['sku_id']}: {e}")
      return None

  async def run(self) -> Dict[str, Any]:
    """
    Fetches prices for all tracked SKUs, calculates price gaps, and writes to BigQuery.
    """
    log.info("Starting competitor price feed run.")
    start_time = datetime.utcnow()
    
    fetched_prices: List[Dict[str, Any]] = []
    async with aiohttp.ClientSession() as session:
      tasks = [self.fetch_price(session, sku) for sku in SKUS_TO_TRACK]
      results = await asyncio.gather(*tasks)
      
      for res in results:
        if res:
          fetched_prices.append(res)
    
    rows_to_insert: List[Dict[str, Any]] = []
    for price_data in fetched_prices:
      our_price = price_data['our_price']
      competitor_price = price_data['competitor_price']
      
      price_gap_pct: Optional[float] = None
      if our_price is not None and our_price != 0:
        price_gap_pct = ((our_price - competitor_price) / our_price) * 100
      
      rows_to_insert.append({
          'timestamp': start_time.isoformat(),
          'sku_id': price_data['sku_id'],
          'competitor': price_data['competitor'],
          'competitor_price': competitor_price,
          'our_price': our_price,
          'price_gap_pct': price_gap_pct,
          'in_stock': price_data['in_stock']
      })
    
    rows_written = self._write_to_bq(rows_to_insert)
    
    log.info(f"Competitor price feed run completed. Fetched {len(SKUS_TO_TRACK)} SKUs, wrote {rows_written} rows.")
    return {
        'skus_fetched': len(SKUS_TO_TRACK),
        'rows_written': rows_written,
        'timestamp': start_time.isoformat()
    }

  def _write_to_bq(self, rows: List[Dict[str, Any]]) -> int:
    """
    Writes a list of rows to the BigQuery table.
    """
    if not rows:
      log.info("No rows to write to BigQuery.")
      return 0

    try:
      errors = self.bq_client.insert_rows_json(self.full_table_id, rows)
      if errors:
        log.error(f"Errors occurred while inserting rows into BigQuery: {errors}")
        return 0
      log.info(f"Successfully wrote {len(rows)} rows to BigQuery table {self.full_table_id}")
      return len(rows)
    except Exception as e:
      log.error(f"Failed to write rows to BigQuery table {self.full_table_id}: {e}")
      return 0
