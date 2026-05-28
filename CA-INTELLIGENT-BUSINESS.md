# Category Intelligence - Enterprise Business Documentation

**Version:** 1.0  
**Last Updated:** 2026-05-28  
**Audience:** Business Stakeholders, Operations Teams, Executive Leadership

---

## Executive Summary

**Category Intelligence** is an AI-powered analytics platform that provides real-time pricing intelligence, competitive analysis, and automated business optimization across product categories (Home Theater, Mobile Accessories, Home Appliance).

The system automatically monitors competitor pricing, identifies pricing gaps, detects inventory risks, and recommends pricing and promotional actions—enabling data-driven decision-making at scale.

---

## Key Business Metrics & Abbreviations

### Revenue & Profitability
| Abbreviation | Full Name | Business Meaning |
|---|---|---|
| **REV** | Revenue | Total sales value across category |
| **MARGIN** | Profit Margin | Percentage profit after costs |
| **ROAS** | Return on Ad Spend | Revenue generated per $1 spent on advertising |
| **DoS** | Days of Supply | How many days of inventory remain before stockout |
| **GAP %** | Price Gap Percentage | How much our price differs from competitors (+ = premium, - = discount) |

### Operational Metrics
| Abbreviation | Full Name | Business Meaning |
|---|---|---|
| **SKU** | Stock Keeping Unit | Individual product variant (e.g., Sony BRAVIA 8 II 65") |
| **FCST** | Forecast | Predicted sales volume for planning |
| **Q4** | Fourth Quarter | Oct-Dec fiscal period (peak season) |
| **YOY** | Year-Over-Year | Performance vs same period last year |
| **DoS** | Days of Supply | Inventory health metric (14-30 days typical, <9 days = risk) |

### AI & Analytics Terms
| Abbreviation | Full Name | Business Meaning |
|---|---|---|
| **SSE** | Server-Sent Events | Real-time data streaming from backend to frontend |
| **BigQuery** | Google BigQuery | Enterprise data warehouse storing all pricing history |
| **SerpAPI** | SerpAPI | External service that fetches live competitor pricing from Amazon, eBay, Walmart, etc. |
| **API** | Application Programming Interface | Bridge allowing frontend to communicate with backend |
| **JSON** | JavaScript Object Notation | Standard data format for all API responses |

### System Components
| Abbreviation | Full Name | Purpose |
|---|---|---|
| **GCP** | Google Cloud Platform | Cloud infrastructure hosting all services |
| **Cloud Run** | Google Cloud Run | Serverless container service (frontend & backend deployed here) |
| **Docker** | Docker Container | Packaged application with all dependencies |
| **Node.js** | Node.js Runtime | JavaScript runtime for frontend (Next.js) |
| **Python** | Python | Backend language for API and data processing |
| **Next.js** | Next.js Framework | React-based web framework for frontend |

---

## System Architecture Overview

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CATEGORY INTELLIGENCE                          │
│                    (Deployed on Google Cloud Run)                   │
└─────────────────────────────────────────────────────────────────────┘
                               │
                ┌──────────────┼──────────────┐
                ▼              ▼              ▼
        ┌────────────┐  ┌────────────┐  ┌────────────┐
        │  FRONTEND  │  │  BACKEND   │  │ BIGQUERY   │
        │ (Next.js)  │  │  (Python)  │  │ (Database) │
        │ Cloud Run  │  │ Cloud Run  │  │   Storage  │
        └────────────┘  └────────────┘  └────────────┘
             │                │                │
        ┌────┴────┐      ┌────┴────┐    ┌─────┴────┐
        │ Chat UI │      │ API      │    │ SKU      │
        │ Tables  │      │ Pricing  │    │ Master   │
        │ Charts  │      │ Database │    │ + Prices │
        └─────────┘      │ Proxy    │    └──────────┘
                         └──────────┘
                              │
                         ┌────┴────┐
                         ▼         ▼
                    ┌────────┐ ┌────────┐
                    │ SerpAPI│ │ Vertex │
                    │(Live   │ │  AI    │
                    │ Prices)│ │(Agent) │
                    └────────┘ └────────┘
```

---

## Business Use Cases

### Use Case 1: Live Pricing Intelligence
**User Goal:** Identify pricing gaps vs Amazon/competitors  
**System Response:**
- Displays all SKUs with current price gap %
- Shows stock status (In/Out)
- Color-coded flags (Price Review, Monitor, Expedite Order, etc.)
- Real-time data from BigQuery cache

**Business Value:**
- Instantly spot underperforming products
- Make data-driven pricing decisions
- React quickly to competitive moves

### Use Case 2: Agentic AI Questions
**User Goal:** Get AI-powered insights ("Why is LG C3 underperforming?")  
**System Response:**
- AI agent analyzes multiple data sources in real-time
- Executes multi-step reasoning pipeline (Think → Act → Analyze → Respond)
- Returns structured diagnostic insights with root causes
- Click to expand for full deep-dive analytics

**Business Value:**
- No manual analysis needed
- Fast root-cause identification
- Actionable recommendations (pricing, promo, clearance)

### Use Case 3: Analytical Workflows
**User Goal:** Run predefined analysis flows (Category Overview, Health Check, etc.)  
**System Response:**
- Displays KPI tiles (Revenue, Margin %, Inventory Health, Forecast Accuracy)
- Shows multi-agent execution pipeline
- Real-time event streaming (Sensing → Fetching → Enriching → Processing → Analyzing → Responding)
- BigQuery verification with schema validation

**Business Value:**
- Consistent analysis across all categories
- Real-time visibility into data quality
- Automated monitoring and alerts

---

## Validation & Testing Guide

### Step 1: Pre-Deployment Validation

#### 1.1 Verify Environment Variables
```bash
# Check that Cloud Run services have proper configuration
gcloud run services describe category-intelligence-backend --region=us-central1
gcloud run services describe category-intelligence-frontend --region=us-central1

# Verify key environment variables are set:
# Backend:
#   - GCP_PROJECT_ID = ctoteam
#   - BIGQUERY_DATASET = category_intelligence
#   - VERTEX_MODEL = gemini-2.5-flash
#   - SERPAPI_KEY = (secret, verified)
#
# Frontend:
#   - NEXT_PUBLIC_BACKEND_URL = https://category-intelligence-backend-*.a.run.app
```

**Expected Outcome:** ✓ All environment variables displayed without errors

---

### Step 2: Backend API Validation

#### 2.1 Test Pricing Endpoint
```bash
# Test Home Theater category (primary test case)
curl -s "https://category-intelligence-backend-*.a.run.app/feeds/prices/latest?category=Home%20Theater" | jq 'length'

# Expected: 44 (number of SKUs in dataset)
# Status: HTTP 200 OK
```

#### 2.2 Test Other Categories
```bash
# Mobile Accessories
curl -s "https://category-intelligence-backend-*.a.run.app/feeds/prices/latest?category=Mobile%20Accessories" | jq 'length'
# Expected: 11

# Home Appliance
curl -s "https://category-intelligence-backend-*.a.run.app/feeds/prices/latest?category=Home%20Appliance" | jq 'length'
# Expected: 0 (no data in dataset, but query succeeds)
```

#### 2.3 Test Data Quality
```bash
# Verify schema
curl -s "https://category-intelligence-backend-*.a.run.app/feeds/prices/latest?category=Home%20Theater" | jq '.[0] | keys'

# Expected fields:
#   - sku_id
#   - sku_name
#   - competitor_price
#   - retailer_price
#   - snapshot_time
#   - price_gap_pct
```

**Success Criteria:**
- ✓ HTTP 200 response
- ✓ Correct row counts per category
- ✓ All required fields present
- ✓ No null values in required fields
- ✓ Response time < 3 seconds

---

### Step 3: Frontend Proxy Validation

#### 3.1 Test Frontend API Endpoint
```bash
# Frontend should proxy requests to backend
curl -s "https://category-intelligence-frontend-*.a.run.app/api/feeds/prices/latest?category=Home%20Theater" | jq 'length'

# Expected: 44 (same as backend)
# Status: HTTP 200 OK
```

#### 3.2 Verify Response Format
```bash
# Response must be flat array, NOT envelope object
curl -s "https://category-intelligence-frontend-*.a.run.app/api/feeds/prices/latest?category=Home%20Theater" | jq 'type'

# Expected: "array" (not "object")
```

**Success Criteria:**
- ✓ Frontend receives and forwards data correctly
- ✓ Response is flat array (critical fix)
- ✓ No extra wrapper objects
- ✓ Response time < 2 seconds

---

### Step 4: Database Validation

#### 4.1 Verify BigQuery Connectivity
```bash
# Authenticate with GCP
gcloud auth login
gcloud config set project ctoteam

# Query BigQuery directly
bq query "SELECT COUNT(DISTINCT sku_id) FROM \`ctoteam.category_intelligence.competitor_price_snapshots\`"

# Expected: 556 total unique SKUs
```

#### 4.2 Check Latest Snapshot
```bash
bq query "SELECT MAX(snapshot_time) FROM \`ctoteam.category_intelligence.competitor_price_snapshots\`"

# Expected: Recent timestamp (within last 24 hours)
```

**Success Criteria:**
- ✓ BigQuery credentials active
- ✓ 500+ SKUs in database
- ✓ Latest snapshot recent (not stale)
- ✓ All required columns present

---

### Step 5: Automated Test Suite

#### 5.1 Run Full Compliance Test
```bash
# Navigate to project root
cd /home/appadmin/projects/Ram_Projects/category-intelligence

# Run unified test suite
chmod +x tests/run_suite.sh
./tests/run_suite.sh
```

#### 5.2 Interpret Test Results
```bash
# View detailed compliance report
cat tests/results/final_compliance_report.json | jq '.'

# Check compliance status
cat tests/results/final_compliance_report.json | jq '.compliance_summary.compliance_status'

# Expected: "COMPLIANT"
```

**Test Categories:**

| Test Phase | Tests | Pass Criteria |
|---|---|---|
| **Backend** | 3 tests | Home Theater (44), Mobile (11), Home App (0) |
| **Frontend** | 4 tests | Proxy works, flat array, performance <3s, error handling |
| **BigQuery** | 4 checks | Connectivity, schema, 556 SKUs, valid timestamps |

**Expected Output:**
```
Total Tests:        7
Passed:             5
Failed:             0
Warnings:           2 (for categories with no data)
COMPLIANCE STATUS:  ✓ COMPLIANT
```

---

### Step 6: Manual Browser Testing

#### 6.1 Access Live Portal
```
Frontend URL: https://category-intelligence-frontend-*.a.run.app
```

#### 6.2 Test Pricing Intelligence View
1. **Expected Display:**
   - "44 SKUs" displayed in Live Pricing Intelligence modal
   - Price gaps visible (+ for premium, - for discount)
   - Stock status (In/Out) shown
   - Action flags (Price Review, Expedite Order, etc.)

2. **Validation Steps:**
   - [ ] Scroll through pricing table
   - [ ] Verify at least 3 SKUs display correctly
   - [ ] Check price gap % calculations
   - [ ] Click on SKU to see details

#### 6.3 Test Agentic AI Questions
1. **Select Demo Flow:**
   - Click "Analytical Workflows" center card
   - Choose "Diagnose LG C3" from dropdown

2. **Ask AI Question:**
   - Type: "Why is LG C3 underperforming?"
   - Click Send
   - Expected: AI agent responds with root-cause analysis

3. **Validation:**
   - [ ] Response appears without "Network response was not ok" error
   - [ ] Agent shows thinking/analyzing progress
   - [ ] Final response includes Intelligence Flow, Root Cause, Data Signals
   - [ ] Click response to open flyout with full diagnostic details

#### 6.4 Test Click-to-Flyout Feature
1. **Trigger Flyout:**
   - After AI responds, hover over agent message
   - See "Click to expand ↗" indicator
   - Click anywhere on the response

2. **Validate Flyout:**
   - [ ] Panel slides in from right side
   - [ ] Full diagnostic content visible
   - [ ] Status badge shows (Complete, Error, etc.)
   - [ ] Active question displayed at top
   - [ ] Close button or overlay click closes flyout

---

## Performance Benchmarks

### Response Time Targets

| Endpoint | Expected | Target | Status |
|---|---|---|---|
| Backend `/feeds/prices/latest` | <3000ms | <1000ms | ✓ |
| Frontend `/api/feeds/prices/latest` | <3000ms | <1500ms | ✓ |
| BigQuery data query | <5000ms | <2000ms | ✓ |
| AI Agent response (full pipeline) | 30-60s | <120s | ✓ |

### Load & Scalability

| Metric | Capacity | Notes |
|---|---|---|
| Concurrent Users | 100+ | Cloud Run auto-scales |
| SKUs per Category | 44-556 | Real product data |
| Historical Snapshots | 1000s | BigQuery unlimited storage |
| API Rate Limit | 1000 req/min | Per service |

---

## Troubleshooting & Common Issues

### Issue 1: "0 SKUs" Displayed in Browser
**Symptoms:** Live Pricing Intelligence shows "0 SKUs" despite backend returning data  
**Root Cause:** Browser cache, service not fully restarted, or old JavaScript bundle  
**Resolution:**
1. Hard refresh browser: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
2. Clear browser cache completely
3. Wait 2-3 minutes for Cloud Run service to fully restart
4. Verify backend is running: `curl https://category-intelligence-backend-*.a.run.app/feeds/prices/latest?category=Home%20Theater`

### Issue 2: "Network response was not ok" Error
**Symptoms:** AI chat returns network error when asking questions  
**Root Cause:** Frontend using wrong backend URL or backend unreachable  
**Resolution:**
1. Verify `NEXT_PUBLIC_BACKEND_URL` env var: `gcloud run services describe category-intelligence-frontend --region=us-central1`
2. Should point to: `https://category-intelligence-backend-gygcwrc62a-uc.a.run.app` (not local IP)
3. Rebuild frontend: `gcloud builds submit --config=cloudbuild.yaml --project=ctoteam`

### Issue 3: No Data for Some Categories
**Symptoms:** Home Appliance returns 0 SKUs  
**Root Cause:** No data in BigQuery for that category  
**Resolution:**
1. This is expected if category has no data
2. Verify query works: Check backend logs for SQL execution
3. Seed sample data if needed: Backend includes seeding script

### Issue 4: Slow Response Times (>3 seconds)
**Symptoms:** API takes 5+ seconds to respond  
**Root Cause:** Cloud Run service cold start, BigQuery slow query, or network latency  
**Resolution:**
1. Cloud Run needs warm-up: First request may be slow (cold start)
2. Verify BigQuery table has indices
3. Check GCP Monitoring dashboard for resource usage
4. Consider increasing Cloud Run memory from 1-2GB

---

## Data Privacy & Security

### Data Classification
- **SKU Data:** Internal product catalog (non-sensitive)
- **Pricing Data:** Competitive market data (derived from public sources)
- **Snapshots:** Historical pricing records (BigQuery encrypted at rest)

### Access Control
- **Frontend:** Public accessible (no authentication required)
- **Backend:** Internal only (VPC Service Controls)
- **BigQuery:** Service account authentication required
- **SerpAPI:** External API with rate limiting (100 calls/month soft limit)

### Compliance
- ✓ GDPR compliant (no PII stored)
- ✓ Data retention: 90-day rolling window for snapshots
- ✓ Audit logs: Cloud Logging captures all API calls
- ✓ Encryption: In-transit (HTTPS), at-rest (BigQuery encryption)

---

## Deployment Checklist

Before deploying to production, verify:

- [ ] All environment variables set correctly
- [ ] Backend API returns correct data (curl test passed)
- [ ] Frontend proxy forwards requests correctly
- [ ] BigQuery connectivity verified
- [ ] Test suite shows COMPLIANT status
- [ ] Manual browser testing completed successfully
- [ ] Response times within acceptable range (<3s)
- [ ] No error messages in Cloud Logging
- [ ] SerpAPI key active and not rate-limited
- [ ] Cloud Run services have correct memory/CPU allocation

---

## Support & Escalation

### For Business Questions
Contact: Category Intelligence Product Team  
Response Time: 1 business day

### For Technical Issues
1. Check Cloud Logging: `gcloud logging read "resource.type=cloud_run_revision"`
2. Review test results: `cat tests/results/final_compliance_report.json | jq '.'`
3. Run diagnostic curl commands above
4. Contact: Engineering Team

### For Performance Issues
1. Check GCP Monitoring dashboard
2. Verify Cloud Run resource allocation
3. Review BigQuery execution plans
4. Contact: DevOps/Infrastructure Team

---

## Glossary of Business Terms

| Term | Definition |
|---|---|
| **Pricing Gap** | Difference between our price and competitor price (expressed as %) |
| **Stockout Risk** | Probability of running out of inventory within forecast window |
| **Forecast Accuracy** | % of actual sales matching predicted sales |
| **Co-op Budget** | Marketing funds provided by vendors (must be spent by deadline) |
| **ROAS** | Revenue generated for each $1 spent on advertising campaigns |
| **Sell-Through Rate** | % of inventory sold in period (higher = better demand) |
| **Days of Supply** | How many days of inventory remain at current sales rate |
| **SKU Rationalization** | Process of adding/dropping products from catalog |

---

## Version History

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-05-28 | Initial enterprise documentation with validation steps, abbreviations, use cases |

---

**Document Owner:** Category Intelligence Team  
**Last Review:** 2026-05-28  
**Next Review:** 2026-06-28
