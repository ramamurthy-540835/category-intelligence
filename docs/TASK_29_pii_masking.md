# TASK_29_pii_masking.md — PII Masking Core Utility

**Status:** ✅ DONE  
**Phase:** 5 — Governance  
**Prerequisite:** TASK_28 complete and validated  
**Assigned to:** Aider  
**Validated by:** Codex

---

## What to Build

Implement a production-safe PII masking utility in `backend/core/pii/masker.py` that redacts sensitive loyalty/customer data before any payload reaches agent reasoning/output layers.

---

## Files to Create / Edit (Aider scope — ONLY these)

```
backend/core/pii/masker.py
```

---

## Functional Requirements

1. Create typed masker utility:
- Implement `PIIMasker` class with deterministic redaction behavior
- Full type hints on all methods
- No `Any` where concrete types are feasible

2. Required methods:
- `mask_text(text: str) -> str`
- `mask_value(value: object) -> object`
- `mask_payload(payload: dict[str, object]) -> dict[str, object]`

3. Redaction rules (minimum):
- Mask email-like strings
- Mask phone-like strings
- Mask customer/loyalty identifiers (keys and values containing tokens like `customer`, `loyalty`, `member`, `email`, `phone`, `name`, `id`)
- Preserve non-sensitive numeric/analytic fields
- Use placeholder token `[REDACTED]`

4. Recursive handling:
- `mask_value` must support nested dict/list/tuple structures safely
- Never mutate caller-owned objects in place; return masked copies

5. Safety/robustness:
- Methods must be non-raising for malformed inputs; fall back safely
- Structured logging via `logging` module for masking failures (no `print`)
- Keep logic local (no external API calls in this task)

6. Governance alignment:
- Default behavior should bias toward redaction when uncertain
- Utility should be importable by agents/tools without extra runtime setup

---

## Non-Goals

- Do not wire middleware or route integration in this task
- Do not modify agent/tool files yet
- Do not add GCP DLP client calls in this unit task

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file backend/core/pii/masker.py
```

**Prompt to paste into Aider:**

```text
Implement TASK_29_pii_masking.md with minimal changes in backend/core/pii/masker.py only.

Requirements:
- Create PIIMasker class with methods mask_text, mask_value, mask_payload.
- Redact common PII patterns (email, phone, loyalty/customer identifiers) using [REDACTED].
- Support recursive masking for nested dict/list/tuple without mutating inputs.
- Use Python logging for error paths; avoid print statements.
- Keep methods defensive and non-raising.
- Full type hints, minimal/surgical implementation.
- No other file changes.
```

---

## Validation Steps

```bash
cd /home/appadmin/projects/Ram_Projects/Category_Analysis/backend
./../.venv/bin/ruff check core/pii/masker.py
./../.venv/bin/python -m mypy core/pii/masker.py --ignore-missing-imports
python3 -m compileall core/pii/masker.py
```

---

## Definition of Done

- [x] `PIIMasker` implemented with typed masking methods
- [x] PII-like fields/values are redacted with `[REDACTED]`
- [x] Recursive masking works for nested dict/list/tuple payloads
- [x] No in-place mutation of input payloads
- [x] Ruff, mypy, compileall checks pass for `masker.py`

---

*Task created: April 2026 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*
