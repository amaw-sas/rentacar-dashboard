# Implementation Plan — Preserve listing filter on save (return-URL)

**Design (approved + reviewed):** `../../2026-05-25-forms-save-preserve-filter-design.md`
**Scenarios (holdout):** `../scenarios/forms-save-preserve-filter.scenarios.md`
**Branch / worktree:** `fix/forms-save-preserve-filter` @ `.worktrees/forms-save-preserve-filter`
**Date:** 2026-05-25

## File structure map

### New (2)
| File | Responsibility |
|------|----------------|
| `lib/navigation/return-to.ts` | Pure `safeReturnTo(from, fallback)` — open-redirect guard, returns a same-listing relative path or the fallback. No deps. |
| `components/data-table/return-link.tsx` | `"use client"` `ReturnLink` — drop-in for `<Link>` on Editar/Nuevo; on plain left-click captures `window.location` and pushes `${href}?from=<encoded>`; modified-click falls through to the plain `<Link>`. |

### New tests (2)
| File | Encodes |
|------|---------|
| `tests/unit/navigation/return-to.test.ts` | SCEN-004 (no `from` → fallback), SCEN-005 (hostile `from` → fallback), valid same-listing `from` → returned. |
| `tests/unit/components/return-link.test.tsx` | SCEN-007 (modified-click does not `preventDefault`, no `from` push); plain click pushes `?from=<encoded current URL>`. |

### Modified (24)
| Group | Files | Change |
|-------|-------|--------|
| Editar links (8) | `app/(dashboard)/{reservations,customers,referrals,cities,locations,rental-companies,categories,franchises}/columns.tsx` | `<Link href={…/edit}>` → `<ReturnLink href={…/edit}>` (inside existing `<Button asChild>`). |
| Nuevo links (8) | `app/(dashboard)/{…}/page.tsx` | `<Link href="/…/new">` → `<ReturnLink href="/…/new">`. |
| Forms (8) | `components/forms/{reservation,customer,referral,city,location,rental-company,vehicle-category,franchise}-form.tsx` | On save success: `router.push("/<listing>")` → read `from` from `window.location.search`, `router.push(safeReturnTo(from, "/<listing>"))`. |

Out of scope (unchanged): 5 detail-page Editar links, server actions, queries, schemas, URL-state hooks.

## Steps

### Step 1 — `safeReturnTo` guard + unit tests (Foundation) | Size: S | Deps: none
SDD: write `tests/unit/navigation/return-to.test.ts` first (red), then `lib/navigation/return-to.ts` (green).
- **Scenario**: given a `from` value and a listing fallback, when resolved, then a hostile/absent/foreign `from` yields the fallback and a valid same-listing `from` is returned verbatim.
- **Acceptance**:
  - Tests cover: `null`/`undefined`/`""` → fallback; `//evil.com`, `https://evil.com`, `/customers` (≠ fallback), `/reservations\\@evil`, leading-whitespace, tab/newline → fallback (rejected by `startsWith("/")` — do NOT trim; trimming weakens the guard); `/reservations` and `/reservations?status=nueva&page=2` → returned verbatim.
  - `pnpm test tests/unit/navigation/return-to.test.ts` green.

### Step 2 — `ReturnLink` component + DOM test (Foundation) | Size: S | Deps: none
SDD: write `tests/unit/components/return-link.test.tsx` first (red), then `components/data-table/return-link.tsx` (green).
- **Scenario**: given a `ReturnLink`, when plain-left-clicked, then it prevents default and `router.push`es `${href}?from=<encoded location.pathname+search>`; when cmd/ctrl/shift/middle-clicked, then it does NOT prevent default (plain `<Link>` navigates, no `from`).
- **Acceptance**:
  - `useRouter` mocked; assert `push` called with the `from`-encoded URL on plain click; assert `preventDefault` not called + no `push` on `metaKey` click.
  - Props/ref forward to inner `<Link>` (works under `<Button asChild>`); `href` typed `string`.
  - `pnpm test tests/unit/components/return-link.test.tsx` green.

### Step 3 — Wire the 8 forms to `safeReturnTo` (Integration) | Size: M | Deps: Step 1
- **Scenario**: given an edit/new URL carrying `?from=/<listing>?…`, when the form saves successfully, then it redirects to the preserved filtered listing; with no/hostile `from`, to the bare listing.
- **Acceptance**:
  - All 8 `*-form.tsx` replace bare `router.push("/<listing>")` in the save-success path with `router.push(safeReturnTo(new URLSearchParams(window.location.search).get("from"), "/<listing>"))`.
  - Each form keeps its own correct fallback path (reservations→`/reservations`, vehicle-category→`/categories`, etc. per design).
  - No `useSearchParams` added. `pnpm type-check` + `pnpm lint` clean.

### Step 4 — Wire Editar (8) + Nuevo (8) links to `ReturnLink` (Integration) | Size: M | Deps: Step 2
- **Scenario**: given a filtered listing, when the operator clicks Editar on a row or the Nuevo button, then navigation carries `?from=<current filtered URL>` to the edit/new page.
- **Acceptance**:
  - 8 `columns.tsx`: Editar `<Link>` → `<ReturnLink>` (import added, `<Button asChild>` preserved). **Surgical:** `reservations/columns.tsx` has 3 `<Link>`s (row-name →`/<id>`, Libro →`/<id>/libro`, Editar →`/<id>/edit`); swap ONLY the `/edit` one. The other 7 columns files have a single `<Link>`.
  - 8 listing `page.tsx`: Nuevo `<Link>` → `<ReturnLink>`.
  - 5 detail-page Editar links untouched (out of scope).
  - `pnpm type-check` + `pnpm lint` clean.

### Step 5 — Full verification (Polish/Gate) | Size: M | Deps: Steps 1-4
- **Acceptance** (invoke `/verification-before-completion`):
  - CI gate locally: `pnpm type-check` → `pnpm lint` → `pnpm test` → `pnpm build` all green (build proves no Suspense regression on static `new` pages — SCEN guard).
  - Runtime via `/agent-browser` + `/dogfood` on reservations + a second entity with a **static `new` page** (e.g. `customers` or `cities`) so the run also exercises the Suspense-sensitive path: SCEN-001 (edit→save preserves filter + fresh data), SCEN-002 (new→save preserves filter), SCEN-003 (Cancel preserves filter), SCEN-004 (deep-link no-`from`→bare listing). Zero console errors / failed requests.

## Testing Strategy
- **Unit (vitest):** `safeReturnTo` (Step 1), `ReturnLink` click behavior (Step 2).
- **Type/build gate:** `pnpm build` is the regression guard for the Suspense concern.
- **Runtime:** `/agent-browser` exercises SCEN-001..004 against a dev server with real Supabase reads.

## Rollout
- PR to `main`; CI (type-check → lint → test → build) is the merge gate.
- No DB migration, no env var, no feature flag. Pure client-navigation change.
- **Rollback:** revert the PR — no data or schema impact.

## Risk
- **Overall:** S–M. Mechanical, well-bounded, no server/data changes.
- **Highest residual risk:** a form's save-success path differs from the assumed bare `router.push` (reviewer verified all 8 match) → caught by Step 3 type-check + Step 5 runtime.
