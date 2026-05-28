# Category Intelligence - Test Suite Documentation

## Overview

This is a comprehensive, professional test suite for validating the Category Intelligence application across backend (Python), frontend (Node.js), and database layers. The suite generates structured JSON compliance reports suitable for deployment verification and audit trails.

## Directory Structure

```
tests/
├── test_backend.py              # Python backend & BigQuery verifier
├── test_frontend.js             # Node.js frontend proxy verifier
├── run_suite.sh                 # Unified test orchestrator
├── test_scenarios.json          # Test case definitions & compliance criteria
├── README.md                    # This file
└── results/                     # Generated test reports
    ├── backend_report.json      # Backend test results
    ├── frontend_report.json     # Frontend test results
    └── final_compliance_report.json  # Aggregated final report
```

## Quick Start

### Prerequisites

```bash
# Python 3.7+
python3 --version

# Node.js 14+
node --version

# Google Cloud SDK (for BigQuery access)
gcloud auth login
gcloud config set project ctoteam

# jq (for JSON processing in bash)
apt-get install jq
```

### Running the Test Suite

```bash
# 1. Navigate to project root
cd /home/appadmin/projects/Ram_Projects/category-intelligence

# 2. Make runner executable
chmod +x tests/run_suite.sh

# 3. Execute full test suite
./tests/run_suite.sh

# 4. View final compliance report
cat tests/results/final_compliance_report.json | jq '.'
```

## Test Components

### 1. Backend Verifier (`test_backend.py`)

**Purpose:** Validates backend API endpoints and BigQuery schema consistency

**Tests Performed:**
- ✓ Backend endpoint connectivity (`/feeds/prices/latest`)
- ✓ Response schema validation (required fields, no nulls)
- ✓ Category filtering (Home Theater, Home Appliance, Mobile Accessories)
- ✓ Response time performance (<3000ms)
- ✓ BigQuery data consistency
- ✓ Category-specific SKU counts

**Output:** `tests/results/backend_report.json`

**Run Independently:**
```bash
python3 tests/test_backend.py
```

### 2. Frontend Verifier (`test_frontend.js`)

**Purpose:** Validates Next.js frontend proxy and API response format

**Tests Performed:**
- ✓ Frontend proxy connectivity
- ✓ HTTP status code validation (200 OK)
- ✓ Content-Type verification (`application/json`)
- ✓ **Flat array response structure** (critical fix validation)
- ✓ Response schema validation
- ✓ Performance testing (<3000ms)
- ✓ Error handling with invalid categories

**Output:** `tests/results/frontend_report.json`

**Run Independently:**
```bash
node tests/test_frontend.js
```

### 3. Test Orchestrator (`run_suite.sh`)

**Purpose:** Executes backend and frontend tests sequentially and aggregates results

**Workflow:**
1. Create results directory
2. Run backend tests (Python)
3. Run frontend tests (Node.js)
4. Aggregate both reports into final compliance report
5. Display formatted summary table

**Output:** `tests/results/final_compliance_report.json`

## Test Scenarios

All test cases are defined in `test_scenarios.json` with:
- Unique test IDs (BE-001, FE-001, INT-001, etc.)
- Expected responses and validation criteria
- Compliance requirements
- Success/failure thresholds

### Example Test Scenario

```json
{
  "id": "BE-001",
  "name": "Home Theater Category - Pricing Endpoint",
  "endpoint": "/feeds/prices/latest",
  "expected_status": 200,
  "expected_min_rows": 44,
  "validation": {
    "required_fields": ["sku_id", "sku_name", "competitor_price", ...],
    "max_response_time_ms": 3000,
    "no_null_fields": true
  }
}
```

## Output Reports

### Backend Report (`backend_report.json`)

```json
{
  "timestamp": "2026-05-28T...",
  "backend_url": "https://...",
  "tests": [
    {
      "name": "GET /feeds/prices/latest?category=Home Theater",
      "status": "passed",
      "row_count": 44,
      "response_time_ms": 245.5,
      "errors": []
    }
  ],
  "summary": {
    "total": 3,
    "passed": 3,
    "failed": 0,
    "warnings": 0
  },
  "bigquery_verification": { ... }
}
```

### Frontend Report (`frontend_report.json`)

```json
{
  "timestamp": "2026-05-28T...",
  "frontend_url": "https://...",
  "tests": [
    {
      "name": "GET /api/feeds/prices/latest?category=Home Theater",
      "status": "passed",
      "row_count": 44,
      "response_time_ms": 189.3,
      "errors": []
    }
  ],
  "summary": {
    "total": 4,
    "passed": 4,
    "failed": 0,
    "warnings": 0
  }
}
```

### Final Compliance Report (`final_compliance_report.json`)

```json
{
  "timestamp": "2026-05-28T...",
  "deployment": {
    "environment": "Google Cloud Run (us-central1)",
    "frontend_url": "https://category-intelligence-frontend-...",
    "backend_url": "https://category-intelligence-backend-..."
  },
  "compliance_summary": {
    "total_tests": 7,
    "passed": 7,
    "failed": 0,
    "warnings": 0,
    "compliance_status": "COMPLIANT"
  },
  "key_findings": {
    "database_connectivity": true,
    "proxy_functionality": true,
    "response_time_acceptable": true,
    "schema_validation": true
  }
}
```

## Interpreting Results

### Success Criteria

✓ **COMPLIANT** when:
- All critical tests pass
- No failed tests
- Response times < 3000ms
- Schema validation passes
- Database connectivity verified

### Test Status Meanings

- **✓ PASSED**: Test completed successfully, all validations met
- **⚠ WARNING**: Test completed but found non-critical issue (e.g., slow response but < 3s)
- **✗ FAILED**: Test failed validation, issue requires attention

## Common Issues & Troubleshooting

### "TypeError: fetch failed"
**Cause:** Frontend proxy using wrong backend URL
**Solution:** Verify `NEXT_PUBLIC_BACKEND_URL` environment variable in Cloud Run

### "0 rows returned for category"
**Cause:** Category predicate not applied to snapshot filtering
**Solution:** Check backend SQL uses `build_category_predicate()`

### "Response is not a flat array"
**Cause:** Backend returning envelope object instead of array
**Solution:** Verify endpoint returns `JSONResponse(content=data)` not `JSONResponse(content={"rows": data})`

### "Request timeout"
**Cause:** Cloud Run service unresponsive
**Solution:** Check service status in GCP Console, verify network connectivity

## Advanced Usage

### Run Only Backend Tests

```bash
python3 tests/test_backend.py
```

### Run Only Frontend Tests

```bash
node tests/test_frontend.js
```

### View Detailed Backend Report

```bash
cat tests/results/backend_report.json | jq '.tests[] | {name, status, response_time_ms, errors}'
```

### Check Compliance Status

```bash
cat tests/results/final_compliance_report.json | jq '.compliance_summary.compliance_status'
```

### Extract Performance Metrics

```bash
cat tests/results/final_compliance_report.json | jq '.test_phases.frontend.performance_metrics'
```

## Integration with CI/CD

Add to your CI/CD pipeline:

```yaml
# Example: Cloud Build step
- name: 'gcr.io/cloud-builders/docker'
  args: ['run', '--rm', '-v', '/workspace:/app', 'node:20', 'bash', '/app/tests/run_suite.sh']
```

Exit codes:
- `0` = All tests passed (COMPLIANT)
- `1` = One or more tests failed (NON-COMPLIANT)

## Maintenance

### Adding New Tests

1. Add test scenario to `test_scenarios.json`
2. Add test function to `test_backend.py` or `test_frontend.js`
3. Run `./tests/run_suite.sh`
4. Verify results in JSON report

### Updating Endpoints

If backend/frontend URLs change:
- Update `BACKEND_URL` in `test_backend.py`
- Update `FRONTEND_URL` in `test_frontend.js`
- Update `deployment.backend_url` in `test_scenarios.json`

## Support

For issues or questions:
1. Review test output in `tests/results/`
2. Run individual test script with error details
3. Check application logs in Cloud Run console
4. Verify environment variables and network connectivity

---

**Test Suite Version:** 1.0  
**Last Updated:** 2026-05-28  
**Maintainer:** Category Intelligence Team
