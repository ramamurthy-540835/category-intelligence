# Category Intelligence - Complete Testing Guide

## Executive Summary

A **professional, multi-layer test suite** has been created to validate your Category Intelligence deployment across:
- ✅ Backend API (Python verifier)
- ✅ Frontend Proxy (Node.js verifier)
- ✅ Database Connectivity (BigQuery validation)
- ✅ Performance Metrics
- ✅ Schema Compliance

All tests output **structured JSON reports** for audit trails and CI/CD integration.

---

## What Was Created

### Files Created in `tests/` Folder

| File | Purpose | Language | Size |
|------|---------|----------|------|
| `test_backend.py` | Backend API & BigQuery verifier | Python 3 | 8.5 KB |
| `test_frontend.js` | Frontend proxy & performance verifier | Node.js | 7.3 KB |
| `run_suite.sh` | Unified orchestrator | Bash | 6.2 KB |
| `test_scenarios.json` | Test definitions & compliance criteria | JSON | 6.7 KB |
| `README.md` | Detailed documentation | Markdown | 7.9 KB |

---

## Quick Start (5 minutes)

### Step 1: Navigate to Project

```bash
cd /home/appadmin/projects/Ram_Projects/category-intelligence
```

### Step 2: Run Test Suite

```bash
chmod +x tests/run_suite.sh
./tests/run_suite.sh
```

### Step 3: View Results

```bash
# View final compliance report
cat tests/results/final_compliance_report.json | jq '.'

# View just compliance status
cat tests/results/final_compliance_report.json | jq '.compliance_summary'

# View performance metrics
cat tests/results/final_compliance_report.json | jq '.test_phases.frontend.performance_metrics'
```

---

## Test Suite Architecture

```
┌─────────────────────────────────────────────────────────────┐
│         UNIFIED TEST ORCHESTRATOR (run_suite.sh)            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────────┐      ┌──────────────────────┐   │
│  │  Backend Tests       │      │  Frontend Tests      │   │
│  │ (test_backend.py)    │      │ (test_frontend.js)   │   │
│  │                      │      │                      │   │
│  │ • API Connectivity   │      │ • Proxy Routing      │   │
│  │ • Response Schema    │      │ • Flat Array Format  │   │
│  │ • Category Filtering │      │ • HTTP Headers       │   │
│  │ • Performance (<3s)  │      │ • Performance (<3s)  │   │
│  │ • BigQuery Data      │      │ • Error Handling     │   │
│  │ • Field Validation   │      │ • Response Fields    │   │
│  └──────────────────────┘      └──────────────────────┘   │
│           ↓                                ↓                │
│  backend_report.json              frontend_report.json     │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  REPORT AGGREGATOR (run_suite.sh phase 3)           │  │
│  │  ✓ Merge backend + frontend reports                 │  │
│  │  ✓ Calculate compliance status                      │  │
│  │  ✓ Generate key findings                            │  │
│  │  ✓ Output formatted terminal summary                │  │
│  └──────────────────────────────────────────────────────┘  │
│                         ↓                                   │
│            final_compliance_report.json                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## What Each Test Validates

### Backend Tests (Python)

**Test 1: Home Theater Category**
```
GET /feeds/prices/latest?category=Home%20Theater
Expected: 44 items, <3000ms response time
Validates: Schema, no nulls, required fields
```

**Test 2: Home Appliance Category**
```
GET /feeds/prices/latest?category=Home%20Appliance
Expected: Category-specific data
Validates: Category predicate applied correctly
```

**Test 3: Mobile Accessories Category**
```
GET /feeds/prices/latest?category=Mobile%20Accessories
Expected: Category-specific data
Validates: Category isolation working
```

**Test 4: BigQuery Verification**
```
Validates: 
✓ 456 total SKUs in database
✓ Latest snapshot timestamp valid
✓ Each category has distinct snapshot data
```

### Frontend Tests (Node.js)

**Test 1: Proxy Connectivity**
```
GET /api/feeds/prices/latest?category=Home%20Theater
Expected: HTTP 200, application/json, flat array
Validates: Proxy working, correct backend URL
```

**Test 2: Response Format**
```
Expected: [{ sku_id, sku_name, ... }] (flat array, NOT envelope)
Validates: The critical bug fix (no more {rows: [...]} wrapper)
```

**Test 3: Performance**
```
Expected: <3000ms response time
Validates: Cloud Run proxy performance acceptable
```

**Test 4: Error Handling**
```
GET /api/feeds/prices/latest?category=InvalidCategory
Expected: Empty array (graceful), HTTP 200
Validates: Error handling doesn't break UI
```

---

## Understanding Test Results

### Compliance Status

```json
{
  "compliance_summary": {
    "total_tests": 7,
    "passed": 7,
    "failed": 0,
    "warnings": 0,
    "compliance_status": "COMPLIANT"  // ✓ Ready for production
  }
}
```

### Status Legend

| Status | Meaning | Action |
|--------|---------|--------|
| ✓ PASSED | Test met all criteria | None needed |
| ⚠ WARNING | Test passed but minor issue found | Monitor, may need attention |
| ✗ FAILED | Test failed validation | **Must fix before deployment** |

### Key Findings

```json
{
  "key_findings": {
    "database_connectivity": true,      // ✓ BigQuery reachable
    "proxy_functionality": true,         // ✓ Frontend proxy working
    "response_time_acceptable": true,    // ✓ All <3000ms
    "schema_validation": true            // ✓ All fields present/valid
  }
}
```

---

## Sample Test Output

### Terminal Output

```
════════════════════════════════════════════════════════════════
CATEGORY INTELLIGENCE TEST SUITE
════════════════════════════════════════════════════════════════

[Phase 1: Backend Verification (Python)]
✓ GET /feeds/prices/latest?category=Home%20Theater: 44 rows, 245ms
✓ GET /feeds/prices/latest?category=Home%20Appliance: 0 rows, 189ms
✓ GET /feeds/prices/latest?category=Mobile%20Accessories: 11 rows, 201ms

[Phase 2: Frontend Verification (Node.js)]
✓ GET /api/feeds/prices/latest?category=Home%20Theater: 44 rows, 156ms
✓ GET /api/feeds/prices/latest?category=Home%20Appliance: 0 rows, 142ms
✓ GET /api/feeds/prices/latest?category=Mobile%20Accessories: 11 rows, 178ms
✓ Error Handling: Invalid Category: passed

[Phase 3: Report Aggregation]
✓ Final compliance report generated: tests/results/final_compliance_report.json

════════════════════════════════════════════════════════════════
SUMMARY: 7 passed, 0 failed, 0 warnings
COMPLIANCE STATUS: ✓ COMPLIANT
════════════════════════════════════════════════════════════════
```

### JSON Report Output

```bash
$ cat tests/results/final_compliance_report.json | jq '.'
```

Returns comprehensive report with:
- All test results (backend + frontend)
- Performance metrics
- BigQuery verification
- Compliance summary
- Key findings

---

## Integration with Your Workflow

### Run Locally Before Deployment

```bash
# Before pushing to main branch
./tests/run_suite.sh

# If COMPLIANT, safe to merge
# If FAILED, fix issues before merging
```

### CI/CD Integration

Add to your build pipeline:

```yaml
# Cloud Build example
steps:
  - name: 'node:20'
    entrypoint: 'bash'
    args:
      - '-c'
      - |
        cd /workspace
        chmod +x tests/run_suite.sh
        ./tests/run_suite.sh
        
        # Fail build if not compliant
        COMPLIANCE=$(cat tests/results/final_compliance_report.json | jq -r '.compliance_summary.compliance_status')
        if [ "$COMPLIANCE" != "COMPLIANT" ]; then
          echo "❌ Deployment not compliant!"
          exit 1
        fi
```

---

## Troubleshooting Tests

### "Python3 not found"
```bash
apt-get update
apt-get install python3
```

### "Node not found"
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt-get install nodejs
```

### "jq not found"
```bash
apt-get install jq
```

### "gcloud: command not found" (for BigQuery tests)
```bash
curl https://sdk.cloud.google.com | bash
gcloud auth login
gcloud config set project ctoteam
```

### Tests Returning 0 Results

Check:
1. Backend is running: `curl https://category-intelligence-backend-gygcwrc62a-uc.a.run.app/feeds/prices/latest`
2. Frontend is running: `curl https://category-intelligence-frontend-gygcwrc62a-uc.a.run.app/api/feeds/prices/latest`
3. Category predicate is applied: Check backend SQL
4. Data exists in BigQuery: `bq query "SELECT COUNT(*) FROM \`ctoteam.category_intelligence.competitor_price_snapshots\`"`

---

## Manual Testing (Without Script)

### Individual Backend Test

```bash
python3 tests/test_backend.py
```

### Individual Frontend Test

```bash
node tests/test_frontend.js
```

### Quick Curl Tests

```bash
# Backend endpoint
curl -s "https://category-intelligence-backend-gygcwrc62a-uc.a.run.app/feeds/prices/latest?category=Home%20Theater" | jq 'length'

# Frontend proxy
curl -s "https://category-intelligence-frontend-gygcwrc62a-uc.a.run.app/api/feeds/prices/latest?category=Home%20Theater" | jq 'length'

# Check if response is flat array
curl -s "https://category-intelligence-frontend-gygcwrc62a-uc.a.run.app/api/feeds/prices/latest?category=Home%20Theater" | jq 'type'
# Should output: "array" (not "object")
```

---

## Performance Benchmarks

| Endpoint | Expected Time | Target | Status |
|----------|---------------|--------|--------|
| Backend /feeds/prices/latest | <3000ms | <1000ms | ✓ |
| Frontend /api/feeds/prices/latest | <3000ms | <1500ms | ✓ |
| BigQuery query | <5000ms | <2000ms | ✓ |

---

## Files Generated by Tests

```
tests/results/
├── backend_report.json          # Detailed backend test results
├── frontend_report.json         # Detailed frontend test results
└── final_compliance_report.json # Aggregated final report (this is what you need)
```

Use `final_compliance_report.json` for:
- ✓ Deployment approval
- ✓ Audit trails
- ✓ Performance documentation
- ✓ Compliance verification
- ✓ CI/CD gate checks

---

## Next Steps

1. **Run the test suite:** `./tests/run_suite.sh`
2. **Review the report:** `cat tests/results/final_compliance_report.json | jq '.'`
3. **Check compliance status:** Should be `COMPLIANT` ✓
4. **If COMPLIANT:** Ready to deploy / merge to main
5. **If NOT COMPLIANT:** Check detailed reports for issues

---

## Support & Documentation

- 📖 **Detailed docs:** See `tests/README.md`
- 📝 **Test scenarios:** See `tests/test_scenarios.json`
- 🔍 **Backend tests:** See `tests/test_backend.py`
- 🎯 **Frontend tests:** See `tests/test_frontend.js`
- 🚀 **Orchestrator:** See `tests/run_suite.sh`

---

**Test Suite Version:** 1.0  
**Status:** Ready for production  
**Last Updated:** 2026-05-28
