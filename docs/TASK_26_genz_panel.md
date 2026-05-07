# TASK_26_genz_panel.md — Gen Z Affinity Panel Upgrade

**Status:** ✅ DONE  
**Phase:** 4 — API + Frontend  
**Prerequisite:** TASK_25 complete and validated  
**Assigned to:** Aider  
**Validated by:** Codex

---

## What to Build

Upgrade `components/loyalty/GenZAffinityPanel.tsx` from a static placeholder into a typed, evidence-first panel that can render key outputs from the Gen Z Interest Agent while remaining safe when optional data is missing.

---

## Files to Create / Edit (Aider scope — ONLY these)

```
components/loyalty/GenZAffinityPanel.tsx
```

---

## Functional Requirements

1. Add typed props interface:
- `category?: string`
- `affinityScore?: number`
- `scoreDrivers?: { gen_z_visit_share: number; gen_z_conversion_rate: number; repeat_purchase_rate: number; social_referral_share: number; store_pickup_share: number }`
- `trendingSearchTerms?: Array<{ term: string; week_over_week_growth: number }>`
- `discoveryChannelMix?: { social_media_referral: number; internal_search: number; direct_pdp: number }`
- `recommendation?: { type: "expand" | "hold" | "test"; rationale: string; action: string } | null`
- `updatedAt?: string`

2. Preserve current panel shell style:
- Keep section structure and panel styling (`panel p-5`) as baseline
- Keep the large affinity score visual emphasis
- Keep readable text contrast and spacing consistency

3. Render evidence blocks (only when data exists):
- Score drivers list with compact percentage display
- Trending terms section with WoW growth values
- Discovery channel mix section with percentages
- Recommendation block with `type`, `rationale`, and `action`

4. Safe fallbacks:
- If `affinityScore` missing, show `--`
- If optional sections are missing/empty, hide section cleanly (no placeholder noise)
- Component must still render with zero props

5. Accessibility and semantics:
- Use text labels for trends and sections (not color-only signals)
- Keep heading hierarchy clean (`h2` + section labels)

6. Backward compatibility:
- Existing zero-prop usage must continue working without runtime errors

---

## Non-Goals

- Do not change `LoyaltySegments.tsx` or `PreFlightModal.tsx`
- Do not add API fetching logic in this component
- Do not modify backend or route handlers in this task

---

## Aider Invocation

```bash
aider \
  --model gemini/gemini-3.1-pro-preview \
  --env-file .env.local \
  --no-auto-commits \
  --file components/loyalty/GenZAffinityPanel.tsx
```

**Prompt to paste into Aider:**

```text
Implement TASK_26_genz_panel.md with minimal edits to components/loyalty/GenZAffinityPanel.tsx only.

Requirements:
- Add a named TypeScript props interface with optional fields for Gen Z evidence data.
- Preserve existing panel visual baseline and readability.
- Keep affinity score prominent and render '--' when missing.
- Render optional sections only when data exists: score drivers, trending terms, discovery channel mix, recommendation.
- Ensure zero-prop usage remains safe and backward compatible.
- No other file changes.
```

---

## Validation Steps

```bash
cd /home/appadmin/projects/Ram_Projects/Category_Analysis
npx tsc --noEmit
npx eslint components/loyalty/GenZAffinityPanel.tsx --ext .ts,.tsx --max-warnings 0
```

---

## Definition of Done

- [ ] GenZAffinityPanel has typed optional props
- [ ] Affinity score and evidence sections render correctly when data is present
- [ ] Component renders safely with no props
- [ ] No files outside scope are modified
- [ ] TypeScript and ESLint checks pass

---

*Task created: April 2026 · Project: ctoteam · Model: gemini/gemini-3.1-pro-preview*
