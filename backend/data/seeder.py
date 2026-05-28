import os
import asyncio
import logging
from datetime import datetime
from typing import Optional
from google.cloud import bigquery

logger = logging.getLogger(__name__)

class BigQuerySeeder:
    """Idempotent database seeder for BigQuery category intelligence dataset."""

    # Real-world product catalog spanning three categories
    SKU_MASTER_DATA = [
        # Home Theater
        {"sku_id": "LG-C3-55", "sku_name": "LG C3 OLED 55\" TV", "retailer_price": 1499.99, "cost": 1100.00, "category": "Home Theater", "active_flag": True},
        {"sku_id": "SONY-X90L-75", "sku_name": "Sony X90L 75\" LED TV", "retailer_price": 1899.99, "cost": 1400.00, "category": "Home Theater", "active_flag": True},
        {"sku_id": "HISENSE-U8K-65", "sku_name": "Hisense U8K 65\" Mini-LED", "retailer_price": 899.99, "cost": 650.00, "category": "Home Theater", "active_flag": True},
        {"sku_id": "BOSE-SB1000", "sku_name": "Bose Smart Soundbar 900", "retailer_price": 499.99, "cost": 350.00, "category": "Home Theater", "active_flag": True},
        {"sku_id": "SONOS-ARC", "sku_name": "Sonos Arc Soundbar", "retailer_price": 799.00, "cost": 550.00, "category": "Home Theater", "active_flag": True},

        # Home Appliance
        {"sku_id": "SAMSUNG-RF29", "sku_name": "Samsung French Door Refrigerator", "retailer_price": 2199.99, "cost": 1650.00, "category": "Home Appliance", "active_flag": True},
        {"sku_id": "LG-WM4000", "sku_name": "LG Front Load Smart Washer", "retailer_price": 899.99, "cost": 680.00, "category": "Home Appliance", "active_flag": True},
        {"sku_id": "DYSON-V15", "sku_name": "Dyson V15 Detect Cordless Vacuum", "retailer_price": 749.99, "cost": 500.00, "category": "Home Appliance", "active_flag": True},
        {"sku_id": "INSTAVIEW-LG", "sku_name": "LG Instaview French Door Refrigerator", "retailer_price": 2799.99, "cost": 2100.00, "category": "Home Appliance", "active_flag": True},
        {"sku_id": "SAMSUNG-DRYER", "sku_name": "Samsung Smart Dryer", "retailer_price": 1299.99, "cost": 950.00, "category": "Home Appliance", "active_flag": True},

        # Mobile Accessories
        {"sku_id": "ANKER-737", "sku_name": "Anker PowerCore 24K Power Bank", "retailer_price": 149.99, "cost": 90.00, "category": "Mobile Accessories", "active_flag": True},
        {"sku_id": "APPLE-MG-15", "sku_name": "Apple MagSafe Charger 15W", "retailer_price": 39.00, "cost": 22.00, "category": "Mobile Accessories", "active_flag": True},
        {"sku_id": "OTTER-DEF-15", "sku_name": "OtterBox Defender iPhone 15 Case", "retailer_price": 59.99, "cost": 28.00, "category": "Mobile Accessories", "active_flag": True},
        {"sku_id": "BELKIN-USB-C", "sku_name": "Belkin USB-C Fast Charging Cable", "retailer_price": 19.99, "cost": 10.00, "category": "Mobile Accessories", "active_flag": True},
        {"sku_id": "SPIGEN-CASE", "sku_name": "Spigen Tough Armor Case", "retailer_price": 14.99, "cost": 7.00, "category": "Mobile Accessories", "active_flag": True},
    ]

    def __init__(self, project_id: str, dataset_id: str):
        self.project_id = project_id
        self.dataset_id = dataset_id
        self.client = bigquery.Client(project=project_id)
        self.sku_master_table = f"{project_id}.{dataset_id}.sku_master"
        self.competitor_snapshots_table = f"{project_id}.{dataset_id}.competitor_price_snapshots"

    async def seed_database(self) -> dict:
        """
        Idempotent database seeder. Checks if tables are empty and populates them
        with real-world product data if needed.
        """
        try:
            logger.info(f"Starting database seeder for {self.project_id}.{self.dataset_id}")

            # Check if sku_master is empty
            sku_count = await self._count_rows(self.sku_master_table)
            if sku_count > 0:
                logger.info(f"sku_master already populated with {sku_count} rows. Skipping seed.")
                return {"status": "success", "message": "Database already seeded", "skipped": True}

            # Seed sku_master table
            logger.info("Seeding sku_master table...")
            await self._seed_sku_master()

            # Seed competitor_price_snapshots table
            logger.info("Seeding competitor_price_snapshots table...")
            await self._seed_competitor_snapshots()

            logger.info("Database seeding completed successfully!")
            return {
                "status": "success",
                "message": "BigQuery dataset successfully populated with real SKU segments!",
                "skus_seeded": len(self.SKU_MASTER_DATA),
                "snapshots_seeded": len(self.SKU_MASTER_DATA)
            }
        except Exception as e:
            logger.error(f"Database seeding failed: {e}")
            return {"status": "error", "message": str(e)}

    async def _count_rows(self, table_id: str) -> int:
        """Count rows in a BigQuery table."""
        try:
            query = f"SELECT COUNT(*) as cnt FROM `{table_id}`"
            result = self.client.query(query).result()
            row = list(result)[0]
            return row.cnt
        except Exception as e:
            logger.warning(f"Could not count rows in {table_id}: {e}")
            return 0

    async def _seed_sku_master(self):
        """Seed the sku_master table with product catalog."""
        rows = []
        now = datetime.utcnow().isoformat() + "Z"

        for sku in self.SKU_MASTER_DATA:
            rows.append({
                "sku_id": sku["sku_id"],
                "sku_name": sku["sku_name"],
                "retailer_price": sku["retailer_price"],
                "our_price": sku["retailer_price"],
                "cost": sku["cost"],
                "category": sku["category"],
                "active_flag": sku["active_flag"],
                "created_at": now,
                "last_checked": now
            })

        try:
            errors = self.client.insert_rows_json(self.sku_master_table, rows)
            if errors:
                logger.error(f"Errors inserting into sku_master: {errors}")
                raise Exception(f"BigQuery insert errors: {errors}")
            logger.info(f"Successfully seeded {len(rows)} SKUs into sku_master")
        except Exception as e:
            logger.error(f"Failed to seed sku_master: {e}")
            raise

    async def _seed_competitor_snapshots(self):
        """Seed the competitor_price_snapshots table with realistic pricing data."""
        rows = []
        now = datetime.utcnow().isoformat() + "Z"

        for sku in self.SKU_MASTER_DATA:
            # Generate realistic competitor price (typically within ±10% of our price)
            our_price = sku["retailer_price"]
            gap_pct = 5 if sku["category"] == "Home Theater" else -3  # Home Theater slightly higher, accessories slightly lower
            competitor_price = our_price * (1 + gap_pct / 100)

            rows.append({
                "sku_id": sku["sku_id"],
                "sku_name": sku["sku_name"],
                "retailer_price": our_price,
                "competitor_price": round(competitor_price, 2),
                "price_gap_pct": round(gap_pct, 1),
                "in_stock": True,
                "product_url": f"https://example.com/{sku['sku_id'].lower()}",
                "image_url": f"https://example.com/images/{sku['sku_id'].lower()}.jpg",
                "snapshot_time": now,
                "last_checked": now
            })

        try:
            errors = self.client.insert_rows_json(self.competitor_snapshots_table, rows)
            if errors:
                logger.error(f"Errors inserting into competitor_price_snapshots: {errors}")
                raise Exception(f"BigQuery insert errors: {errors}")
            logger.info(f"Successfully seeded {len(rows)} price snapshots into competitor_price_snapshots")
        except Exception as e:
            logger.error(f"Failed to seed competitor_price_snapshots: {e}")
            raise
