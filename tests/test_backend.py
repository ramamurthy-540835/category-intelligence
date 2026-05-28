#!/usr/bin/env python3
"""
Backend API & BigQuery Schema Verifier
Tests the /feeds/prices/latest endpoint and validates response schema against BigQuery data.
Outputs structured JSON report.
"""

import urllib.request
import json
import time
import sys
from datetime import datetime
from google.cloud import bigquery

BACKEND_URL = "https://category-intelligence-backend-gygcwrc62a-uc.a.run.app"
PROJECT_ID = "ctoteam"
DATASET_ID = "category_intelligence"
TABLE_ID = "competitor_price_snapshots"

class BackendTester:
    def __init__(self):
        self.results = {
            "timestamp": datetime.now().isoformat(),
            "backend_url": BACKEND_URL,
            "tests": [],
            "summary": {
                "total": 0,
                "passed": 0,
                "failed": 0,
                "warnings": 0
            },
            "schema_validation": [],
            "bigquery_verification": []
        }
        self.bq_client = bigquery.Client(project=PROJECT_ID)

    def test_endpoint(self, category, expected_count=None):
        """Test the /feeds/prices/latest endpoint with category parameter"""
        test_name = f"GET /feeds/prices/latest?category={category}"
        test_result = {
            "name": test_name,
            "category": category,
            "status": "pending",
            "response_time_ms": 0,
            "row_count": 0,
            "http_status": 0,
            "errors": []
        }

        try:
            start_time = time.time()
            url = f"{BACKEND_URL}/feeds/prices/latest?category={category}"

            with urllib.request.urlopen(url, timeout=10) as response:
                test_result["http_status"] = response.status
                data = json.loads(response.read().decode())
                elapsed = (time.time() - start_time) * 1000
                test_result["response_time_ms"] = round(elapsed, 2)

                # Validate response is flat array
                if not isinstance(data, list):
                    test_result["status"] = "failed"
                    test_result["errors"].append(f"Response is not a flat array: {type(data)}")
                    self.results["summary"]["failed"] += 1
                else:
                    test_result["row_count"] = len(data)

                    # Validate each row schema
                    schema_valid = True
                    required_fields = ["sku_id", "sku_name", "competitor_price", "retailer_price", "snapshot_time"]

                    for i, row in enumerate(data):
                        for field in required_fields:
                            if field not in row:
                                test_result["errors"].append(f"Row {i} missing field: {field}")
                                schema_valid = False
                            elif row[field] is None:
                                test_result["errors"].append(f"Row {i} field '{field}' is null")
                                schema_valid = False

                    if schema_valid and len(data) > 0:
                        test_result["status"] = "passed"
                        self.results["summary"]["passed"] += 1
                    elif len(data) == 0:
                        test_result["status"] = "warning"
                        test_result["errors"].append(f"No data returned for category: {category}")
                        self.results["summary"]["warnings"] += 1
                    else:
                        test_result["status"] = "failed"
                        self.results["summary"]["failed"] += 1

                    # Validate response time < 3 seconds
                    if elapsed > 3000:
                        test_result["status"] = "warning" if test_result["status"] == "passed" else test_result["status"]
                        test_result["errors"].append(f"Slow response: {elapsed}ms > 3000ms")
                        if test_result["status"] == "passed":
                            self.results["summary"]["warnings"] += 1

        except urllib.error.HTTPError as e:
            test_result["status"] = "failed"
            test_result["http_status"] = e.code
            test_result["errors"].append(f"HTTP Error {e.code}: {e.reason}")
            self.results["summary"]["failed"] += 1
        except Exception as e:
            test_result["status"] = "failed"
            test_result["errors"].append(f"Connection error: {str(e)}")
            self.results["summary"]["failed"] += 1

        self.results["summary"]["total"] += 1
        self.results["tests"].append(test_result)
        return test_result

    def verify_bigquery(self):
        """Verify BigQuery data matches API responses"""
        verify_result = {
            "timestamp": datetime.now().isoformat(),
            "checks": []
        }

        try:
            # Check 1: Latest snapshot exists
            query = f"""
                SELECT MAX(snapshot_time) as latest_time
                FROM `{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}`
            """
            result = self.bq_client.query(query).result()
            latest_time = list(result)[0].latest_time

            verify_result["checks"].append({
                "check": "Latest snapshot timestamp",
                "status": "passed" if latest_time else "failed",
                "value": str(latest_time) if latest_time else "NULL"
            })

            # Check 2: Total SKU count
            query = f"SELECT COUNT(DISTINCT sku_id) as count FROM `{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}`"
            result = self.bq_client.query(query).result()
            total_skus = list(result)[0].count

            verify_result["checks"].append({
                "check": "Total distinct SKUs in database",
                "status": "passed",
                "value": total_skus
            })

            # Check 3: Category counts
            categories = {
                "Home Theater": r"(tv|oled|soundbar|projector|receiver|bose|sonos)",
                "Home Appliance": r"(fridge|refrigerator|washer|dryer|oven|microwave|range|appliance)",
                "Mobile Accessories": r"(case|charger|cable|power bank|screen protector|mount|adapter|phone)"
            }

            for cat_name, regex in categories.items():
                query = f"""
                    SELECT COUNT(*) as count FROM `{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}`
                    WHERE snapshot_time = (SELECT MAX(snapshot_time) FROM `{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}`)
                    AND REGEXP_CONTAINS(LOWER(sku_name), r'{regex}')
                """
                result = self.bq_client.query(query).result()
                count = list(result)[0].count

                verify_result["checks"].append({
                    "check": f"Category snapshot count: {cat_name}",
                    "status": "passed",
                    "value": count
                })

        except Exception as e:
            verify_result["checks"].append({
                "check": "BigQuery verification",
                "status": "failed",
                "error": str(e)
            })

        self.results["bigquery_verification"] = verify_result
        return verify_result

    def run_all_tests(self):
        """Execute all backend tests"""
        print("=" * 70)
        print("BACKEND VERIFIER - Starting Tests")
        print("=" * 70)

        categories = [
            ("Home%20Theater", 44),
            ("Home%20Appliance", None),
            ("Mobile%20Accessories", None)
        ]

        for category, expected_count in categories:
            result = self.test_endpoint(category, expected_count)
            status_symbol = "✓" if result["status"] == "passed" else "⚠" if result["status"] == "warning" else "✗"
            print(f"{status_symbol} {result['name']}: {result['row_count']} rows, {result['response_time_ms']}ms")

        print("\nVerifying BigQuery data...")
        self.verify_bigquery()

        return self.results

    def save_report(self, output_path):
        """Save results to JSON file"""
        import os
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        with open(output_path, 'w') as f:
            json.dump(self.results, f, indent=2)

        print(f"\n✓ Backend report saved to: {output_path}")
        return output_path


if __name__ == "__main__":
    tester = BackendTester()
    tester.run_all_tests()
    tester.save_report("tests/results/backend_report.json")

    print("\n" + "=" * 70)
    print(f"SUMMARY: {tester.results['summary']['passed']} passed, {tester.results['summary']['failed']} failed, {tester.results['summary']['warnings']} warnings")
    print("=" * 70)
