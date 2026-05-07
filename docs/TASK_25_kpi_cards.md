# TASK_25_kpi_cards.md — KPI Card Component Upgrade

**Status:** ✅ DONE  
**Phase:** 4 — API + Frontend  
**Prerequisite:** TASK_24 complete and validated  
**Assigned to:** Aider  
**Validated by:** Codex

---

## What to Build

Enhance `components/dashboard/KPICard.tsx` into a richer, typed KPI tile that supports trend direction, optional delta, and semantic visual states while preserving current layout style.

---

## Files to Create / Edit (Aider scope — ONLY these)

```
components/dashboard/KPICard.tsx
```

---

## Functional Requirements

1. Typed props:
- Replace inline anonymous props with named type/interface:
  - `label: string`
  - `value: string`
  - `metric: string`
  - `delta?: string` (example: `+4.8%`)
  - `trend?: "up" | "down" | "flat"`
  - `status?: "good" | "warning" | "critical" | "neutral"`
  - `updatedAt?: string`

2. Visual semantics:
- Keep existing card shell (`panel p-5`) and typography feel
- Add compact trend badge area:
  - `up` -> positive color
  - `down` -> negative color
  - `flat` -> neutral color
- Add status accent (border/indicator chip) based on `status`
- If `delta` missing, hide trend badge cleanly

3. Content behavior:
- Keep metric key visible (small uppercase text)
- Keep primary value emphasis (large number)
- Show optional `updatedAt` as muted footer text

4. Accessibility:
- Keep semantic text contrast
- Do not rely on color alone; include text cue (Up/Down/Flat or icon + label)

5. Backward compatibility:
- Existing call sites with only `label/value/metric` must still render correctly

---

## Non-Goals

- Do not modify dashboard pages or data-fetching
- Do not modify other dashboard components
- Do not add chart logic in KPI card

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file components/dashboard/KPICard.tsx
```

**Prompt to paste into Aider:**

```text
Implement TASK_25_kpi_cards.md with minimal edits to components/dashboard/KPICard.tsx only.

Requirements:
- Introduce a named typed props interface with optional delta/trend/status/updatedAt.
- Preserve existing visual style baseline and keep backward compatibility.
- Add trend/status display with semantic classes.
- Keep value and metric emphasis.
- Optional fields should render only when provided.
- No other file changes.
```

---

## Validation Steps

```bash
cd /home/appadmin/projects/Ram_Projects/Category_Analysis
npx tsc --noEmit
```

---

## Definition of Done

- [x] KPICard has a named typed props interface
- [x] Optional trend/status/delta render correctly without breaking existing usage
- [x] Component remains backward compatible with existing props
- [x] TypeScript compile passes

---

*Task created: April 2026 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*
