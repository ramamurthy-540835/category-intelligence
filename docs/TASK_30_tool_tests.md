# TASK_30_tool_tests.md — Tool Test Suite Expansion

**Status:** ✅ DONE  
**Phase:** 6 — Tests  
**Prerequisite:** TASK_29 complete and validated  
**Assigned to:** Aider  
**Validated by:** Codex

---

## What to Build

Expand `backend/tests/test_tools.py` into a broader, deterministic test suite for critical tool behavior and governance-safe outputs, while keeping tests fast and unit-level.

---

## Files to Create / Edit (Aider scope — ONLY these)

```
backend/tests/test_tools.py
```

---

## Functional Requirements

1. Preserve existing passing tests:
- Keep current `GenZInterestTool` and `DemandIntentTool` tests intact unless minor cleanup is needed

2. Add PII masker tests:
- Add unit tests for `backend.core.pii.masker.PIIMasker`
- Validate:
  - email masking in text
  - phone masking in text
  - sensitive key masking (`customer_id`, `email`, `loyalty_score` as key-level sensitive)
  - non-sensitive field preservation (`revenue`, `sku_id`)
  - nested payload masking for dict/list/tuple
  - no in-place mutation of input payload

3. Add deterministic tool contract tests:
- For `GenZInterestTool`:
  - response includes required top-level keys
  - `privacy.pii_masked` is `True`
  - at least one recommendation item exists
- For `DemandIntentTool`:
  - `top_search_queries` non-empty
  - `share_of_search` present and numeric-like values
  - `category_search_trend` present

4. Test style:
- Use `pytest` (and `pytest.mark.asyncio` for async tests)
- No external network/GCP calls
- No flaky timing assertions
- Keep tests self-contained with fixed inputs

5. Typing and quality:
- Add type hints where useful in tests
- No `print` statements
- Keep test names descriptive and behavior-focused

---

## Non-Goals

- Do not modify tool implementation files
- Do not introduce integration tests or live BigQuery dependencies
- Do not modify `backend/tests/test_agents.py` in this task

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file backend/tests/test_tools.py
```

**Prompt to paste into Aider:**

```text
Implement TASK_30_tool_tests.md with minimal edits to backend/tests/test_tools.py only.

Requirements:
- Keep existing tests passing.
- Add focused PIIMasker unit tests (masking correctness, nested recursion, non-mutation).
- Add deterministic contract tests for GenZInterestTool and DemandIntentTool response shape.
- Keep tests offline and stable (no external service calls).
- Use pytest + asyncio markers where needed.
- No other file changes.
```

---

## Validation Steps

```bash
cd /home/appadmin/projects/Ram_Projects/Category_Analysis/backend
./../.venv/bin/ruff check tests/test_tools.py
./../.venv/bin/python -m mypy tests/test_tools.py --ignore-missing-imports
./../.venv/bin/python -m pytest tests/test_tools.py -v
```

---

## Definition of Done

- [ ] Existing tool tests still pass
- [ ] PIIMasker behavior is covered with deterministic unit tests
- [ ] Gen Z and Demand Intent tool contracts are validated
- [ ] Ruff, mypy, and pytest pass for `tests/test_tools.py`

---

*Task created: April 2026 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*
