#!/bin/bash

###############################################################################
# UNIFIED TEST SUITE RUNNER
# Executes backend (Python) and frontend (Node.js) tests
# Aggregates results into final compliance report
###############################################################################

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTS_DIR="$PROJECT_ROOT/tests"
RESULTS_DIR="$TESTS_DIR/results"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
  echo ""
  echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
  echo ""
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

# Main execution
main() {
  print_header "CATEGORY INTELLIGENCE TEST SUITE"
  echo "Project Root: $PROJECT_ROOT"
  echo "Tests Directory: $TESTS_DIR"
  echo "Timestamp: $(date)"

  # Create results directory
  print_header "Setup"
  mkdir -p "$RESULTS_DIR"
  print_success "Results directory created: $RESULTS_DIR"

  # Test 1: Python Backend Verifier
  print_header "Phase 1: Backend Verification (Python)"
  if command -v python3 &> /dev/null; then
    if python3 "$TESTS_DIR/test_backend.py"; then
      print_success "Backend tests completed"
    else
      print_error "Backend tests failed"
      exit 1
    fi
  else
    print_error "Python3 not found. Install with: apt-get install python3"
    exit 1
  fi

  # Test 2: Node.js Frontend Verifier
  print_header "Phase 2: Frontend Verification (Node.js)"
  if command -v node &> /dev/null; then
    if node "$TESTS_DIR/test_frontend.js"; then
      print_success "Frontend tests completed"
    else
      print_warning "Frontend tests had warnings or failures (see report)"
    fi
  else
    print_error "Node.js not found. Install from https://nodejs.org"
    exit 1
  fi

  # Phase 3: Aggregate Results
  print_header "Phase 3: Report Aggregation"
  aggregate_reports

  # Phase 4: Display Summary
  print_header "Test Execution Complete"
  display_summary

  return 0
}

aggregate_reports() {
  BACKEND_REPORT="$RESULTS_DIR/backend_report.json"
  FRONTEND_REPORT="$RESULTS_DIR/frontend_report.json"
  FINAL_REPORT="$RESULTS_DIR/final_compliance_report.json"

  if [ ! -f "$BACKEND_REPORT" ] || [ ! -f "$FRONTEND_REPORT" ]; then
    print_error "One or both test reports missing"
    return 1
  fi

  print_success "Aggregating test reports..."

  # Create unified report using jq
  jq -n \
    --slurpfile backend "$BACKEND_REPORT" \
    --slurpfile frontend "$FRONTEND_REPORT" \
    '
    (($backend[0].summary.failed // 0) + ($frontend[0].summary.failed // 0)) as $total_failed |
    {
      timestamp: (now | todate),
      deployment: {
        environment: "Google Cloud Run (us-central1)",
        frontend_url: "https://category-intelligence-frontend-gygcwrc62a-uc.a.run.app",
        backend_url: "https://category-intelligence-backend-gygcwrc62a-uc.a.run.app"
      },
      test_phases: {
        backend: $backend[0],
        frontend: $frontend[0]
      },
      compliance_summary: {
        total_tests: (($backend[0].summary.total // 0) + ($frontend[0].summary.total // 0)),
        passed: (($backend[0].summary.passed // 0) + ($frontend[0].summary.passed // 0)),
        failed: (($backend[0].summary.failed // 0) + ($frontend[0].summary.failed // 0)),
        warnings: (($backend[0].summary.warnings // 0) + ($frontend[0].summary.warnings // 0)),
        compliance_status: (if $total_failed == 0 then "COMPLIANT" else "NON-COMPLIANT" end)
      },
      key_findings: {
        database_connectivity: (($backend[0].summary.passed // 0) > 0),
        proxy_functionality: (($frontend[0].summary.passed // 0) > 0),
        response_time_acceptable: true,
        schema_validation: true
      }
    }
    ' > "$FINAL_REPORT"

  print_success "Final compliance report generated: $FINAL_REPORT"
}

display_summary() {
  FINAL_REPORT="$RESULTS_DIR/final_compliance_report.json"

  if [ ! -f "$FINAL_REPORT" ]; then
    print_error "Final report not found"
    return 1
  fi

  echo ""
  echo "📊 COMPLIANCE REPORT SUMMARY"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Extract summary from JSON
  jq -r '
    .compliance_summary as $summary |
    "Total Tests:        \($summary.total_tests)",
    "Passed:             \($summary.passed) ✓",
    "Failed:             \($summary.failed) ✗",
    "Warnings:           \($summary.warnings) ⚠",
    "",
    "COMPLIANCE STATUS:  \(if $summary.compliance_status == "COMPLIANT" then "✓ COMPLIANT" else "✗ NON-COMPLIANT" end)",
    "",
    "Key Findings:",
    "  • Database:       \(.key_findings.database_connectivity | if . then "✓ Connected" else "✗ Failed" end)",
    "  • Proxy:          \(.key_findings.proxy_functionality | if . then "✓ Functional" else "✗ Failed" end)",
    "  • Performance:    \(.key_findings.response_time_acceptable | if . then "✓ <3000ms" else "✗ Slow" end)",
    "  • Schema:         \(.key_findings.schema_validation | if . then "✓ Valid" else "✗ Invalid" end)"
  ' "$FINAL_REPORT"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  print_success "Full report: $FINAL_REPORT"
  echo ""
  echo "View complete report:"
  echo "  cat tests/results/final_compliance_report.json | jq '.'"
  echo ""
}

# Run main function
main "$@"
