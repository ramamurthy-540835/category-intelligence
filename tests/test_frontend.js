#!/usr/bin/env node
/**
 * Frontend API Proxy Verifier
 * Tests the Next.js /api/feeds/prices/latest proxy endpoint
 * Validates flat array response structure and performance
 * Outputs structured JSON report
 */

const fs = require('fs');
const path = require('path');

const FRONTEND_URL = "https://category-intelligence-frontend-gygcwrc62a-uc.a.run.app";

class FrontendTester {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      frontend_url: FRONTEND_URL,
      tests: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        warnings: 0
      },
      performance_metrics: [],
      schema_validation: []
    };
  }

  async testProxyEndpoint(category) {
    const testName = `GET /api/feeds/prices/latest?category=${category}`;
    const testResult = {
      name: testName,
      category: category,
      status: "pending",
      response_time_ms: 0,
      http_status: 0,
      row_count: 0,
      errors: []
    };

    try {
      const startTime = Date.now();
      const url = `${FRONTEND_URL}/api/feeds/prices/latest?category=${encodeURIComponent(category)}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });

      const elapsed = Date.now() - startTime;
      testResult.response_time_ms = elapsed;

      // Validate HTTP status
      testResult.http_status = response.status;
      if (response.status !== 200) {
        testResult.status = "failed";
        testResult.errors.push(`HTTP ${response.status} (expected 200)`);
        this.results.summary.failed++;
      } else {
        // Validate Content-Type
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          testResult.status = "failed";
          testResult.errors.push(`Content-Type: ${contentType} (expected application/json)`);
          this.results.summary.failed++;
        } else {
          // Parse and validate response
          const data = await response.json();

          // CRITICAL: Validate flat array structure
          if (!Array.isArray(data)) {
            testResult.status = "failed";
            testResult.errors.push(`Response is not a flat array: ${typeof data}`);
            this.results.summary.failed++;
          } else {
            testResult.row_count = data.length;

            // Validate schema for each row
            let schemaValid = true;
            const requiredFields = ["sku_id", "sku_name", "competitor_price", "retailer_price", "snapshot_time"];

            for (let i = 0; i < data.length; i++) {
              const row = data[i];
              for (const field of requiredFields) {
                if (!(field in row)) {
                  testResult.errors.push(`Row ${i} missing field: ${field}`);
                  schemaValid = false;
                } else if (row[field] === null || row[field] === undefined) {
                  testResult.errors.push(`Row ${i} field '${field}' is null/undefined`);
                  schemaValid = false;
                }
              }
            }

            // Validate performance
            let performanceOk = true;
            if (elapsed > 3000) {
              testResult.errors.push(`Slow response: ${elapsed}ms > 3000ms (target: <3s)`);
              performanceOk = false;
            }

            // Set final status
            if (schemaValid && performanceOk && data.length > 0) {
              testResult.status = "passed";
              this.results.summary.passed++;
            } else if (data.length === 0) {
              testResult.status = "warning";
              testResult.errors.push(`No data returned for category: ${category}`);
              this.results.summary.warnings++;
            } else {
              testResult.status = schemaValid && !performanceOk ? "warning" : "failed";
              if (testResult.status === "warning") {
                this.results.summary.warnings++;
              } else {
                this.results.summary.failed++;
              }
            }
          }
        }
      }

    } catch (error) {
      testResult.status = "failed";
      testResult.errors.push(`Connection error: ${error.message}`);
      this.results.summary.failed++;
    }

    this.results.summary.total++;
    this.results.tests.push(testResult);

    // Log performance metric
    this.results.performance_metrics.push({
      endpoint: testResult.name,
      response_time_ms: testResult.response_time_ms,
      status: testResult.status
    });

    return testResult;
  }

  async testErrorHandling() {
    /**
     * Test graceful error handling with invalid category
     */
    const testResult = {
      name: "Error Handling: Invalid Category",
      category: "InvalidCategory123",
      status: "pending",
      response_time_ms: 0,
      http_status: 0,
      row_count: 0,
      errors: []
    };

    try {
      const startTime = Date.now();
      const url = `${FRONTEND_URL}/api/feeds/prices/latest?category=InvalidCategory123`;

      const response = await fetch(url);
      const elapsed = Date.now() - startTime;
      testResult.response_time_ms = elapsed;
      testResult.http_status = response.status;

      const data = await response.json();

      // Should gracefully return empty array, not error
      if (Array.isArray(data)) {
        testResult.status = "passed";
        this.results.summary.passed++;
      } else {
        testResult.status = "failed";
        testResult.errors.push("Invalid category did not return array");
        this.results.summary.failed++;
      }

    } catch (error) {
      testResult.status = "failed";
      testResult.errors.push(`Error handling test failed: ${error.message}`);
      this.results.summary.failed++;
    }

    this.results.summary.total++;
    this.results.tests.push(testResult);
    return testResult;
  }

  async runAllTests() {
    console.log("=" .repeat(70));
    console.log("FRONTEND PROXY VERIFIER - Starting Tests");
    console.log("=" .repeat(70));

    const categories = [
      "Home Theater",
      "Home Appliance",
      "Mobile Accessories"
    ];

    for (const category of categories) {
      const result = await this.testProxyEndpoint(category);
      const statusSymbol = result.status === "passed" ? "✓" : result.status === "warning" ? "⚠" : "✗";
      console.log(`${statusSymbol} ${result.name}: ${result.row_count} rows, ${result.response_time_ms}ms`);
    }

    console.log("\nTesting error handling...");
    await this.testErrorHandling();

    return this.results;
  }

  saveReport(outputPath) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(this.results, null, 2));
    console.log(`\n✓ Frontend report saved to: ${outputPath}`);
    return outputPath;
  }
}

// Main execution
(async () => {
  const tester = new FrontendTester();
  await tester.runAllTests();
  tester.saveReport("tests/results/frontend_report.json");

  console.log("\n" + "=" .repeat(70));
  console.log(`SUMMARY: ${tester.results.summary.passed} passed, ${tester.results.summary.failed} failed, ${tester.results.summary.warnings} warnings`);
  console.log("=" .repeat(70));

  process.exit(tester.results.summary.failed > 0 ? 1 : 0);
})();
