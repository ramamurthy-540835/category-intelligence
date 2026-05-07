# TASK_28_rbac.md — RBAC Enforcement Alignment (Backend + Frontend)

**Status:** ✅ DONE  
**Phase:** 5 — Governance  
**Prerequisite:** TASK_27 complete and validated  
**Assigned to:** Aider  
**Validated by:** Codex

---

## What to Build

Align role-based access control behavior between backend and frontend so all privileged actions are consistently gated for `viewer`, `analyst`, and `manager` roles.

---

## Files to Create / Edit (Aider scope — ONLY these)

```
backend/core/auth/rbac.py
lib/auth/rbac.ts
```

---

## Functional Requirements

1. Canonical roles and permissions:
- Keep roles: `viewer`, `analyst`, `manager`
- Keep permissions:
  - `read:kpi`
  - `run:diagnosis`
  - `run:simulation`
  - `trigger:action`
  - `export:data`
- Ensure backend and frontend mappings match exactly

2. Backend enforcement (`backend/core/auth/rbac.py`):
- Keep/extend `Permission` enum and `ROLE_PERMISSIONS`
- Ensure unknown roles are denied by default
- Keep `require_permission(permission)` dependency usable in FastAPI routes
- Return HTTP 403 for missing permission with clear detail
- Add explicit typing for role-permission map and dependency return

3. Frontend authorization helpers (`lib/auth/rbac.ts`):
- Keep `UserRole` union type and `can(role, permission)` API
- Introduce exported permission type literal union (or const map) so permission strings are type-safe
- Ensure `can()` denies unknown/invalid permission checks safely
- Keep call-site backward compatibility (no required caller refactor)

4. Governance behavior to enforce:
- `viewer` cannot trigger actions or export
- `analyst` can run diagnosis/simulation but cannot trigger actions
- `manager` can trigger actions and export

5. Minimal change policy:
- No edits outside the two RBAC files
- No route/component rewrites in this task

---

## Non-Goals

- Do not modify FastAPI route handlers in `backend/main.py`
- Do not modify UI components in this task
- Do not add database-level row security here

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file backend/core/auth/rbac.py \
  --file lib/auth/rbac.ts
```

**Prompt to paste into Aider:**

```text
Implement TASK_28_rbac.md with minimal edits to:
- backend/core/auth/rbac.py
- lib/auth/rbac.ts

Requirements:
- Keep role and permission model consistent across backend/frontend.
- Unknown roles must be denied by default.
- Keep backend require_permission() FastAPI dependency behavior with HTTP 403 on denied access.
- Add/strengthen typing in both files (no any).
- Keep frontend can(role, permission) backward compatible while improving permission type-safety.
- No other file changes.
```

---

## Validation Steps

```bash
cd /home/appadmin/projects/Ram_Projects/Category_Analysis
npx tsc --noEmit

cd backend
./../.venv/bin/ruff check core/auth/rbac.py
./../.venv/bin/python -m mypy core/auth/rbac.py --ignore-missing-imports
python3 -m compileall core/auth/rbac.py
```

---

## Definition of Done

- [x] Backend and frontend role-permission mappings are identical
- [x] Unknown roles are denied safely
- [x] `require_permission` still works as FastAPI dependency and returns 403 on deny
- [x] Frontend `can()` remains backward compatible and type-safe
- [x] TS, Ruff, mypy, and compileall checks pass for scoped files

---

*Task created: April 2026 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*
