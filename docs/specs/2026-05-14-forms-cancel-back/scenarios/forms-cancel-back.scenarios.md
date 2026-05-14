---
name: forms-cancel-back
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-14T16:00:00Z
issue_origin: gap in #28 acceptance criteria — "cancela la edición o vuelve, el filtro se conserve"
---

# Scenarios — Cancel button preserves the listing's URL state

Gap identified after PR #28 (#30) shipped: the issue's acceptance criteria included "cancela la edición o vuelve" but the implementation only covered the browser-back path. Eight entity forms used `router.push("/<listing>")` for their Cancel buttons, which strips the listing's query string (the filters the operator had applied). Reservations is included even though its URL-state persistence (issue #27) is still pending — `router.back()` is harmless today and correct once #27 ships.

The Cancel button on every entity form must take the operator back to the listing in the exact state they left it.

---

## SCEN-001: Cancel on the edit form returns to the listing with its URL intact

**Given**: the operator is on `/customers?q=lopez&sort=full_name:asc&page=2`, clicks "Editar" on a row → navigates to `/customers/<id>/edit`.
**When**: they click "Cancelar" without saving.
**Then**: the browser returns to `/customers?q=lopez&sort=full_name:asc&page=2` with the filter, sort, and page restored exactly as they were. The Cancel handler delegates to `router.back()`, which pops the history entry created by the Editar navigation.
**Evidence**: source-diff inspection — each of the 8 affected forms (`customer-form.tsx`, `referral-form.tsx`, `city-form.tsx`, `location-form.tsx`, `rental-company-form.tsx`, `vehicle-category-form.tsx`, `franchise-form.tsx`, `reservation-form.tsx`) replaces the inline `() => router.push("/<listing>")` Cancel handler with `() => router.back()`. Runtime verification via `/agent-browser`: filter is visible in URL before and after the cancel cycle.

---

## SCEN-002: Post-submit behavior is intentionally unchanged

**Given**: the operator submits the edit form successfully.
**When**: the action settles.
**Then**: the form keeps its existing post-submit redirect `router.push("/<listing>")`. The operator lands on a freshly-rendered listing that includes the saved record. This is the same behavior as before this fix.
**Evidence**: source-diff — the `router.push("/<listing>")` calls at the post-submit handlers across the 8 forms are NOT modified. Only the inline Cancel `onClick` handlers change.

**Why preserve post-submit**: after a successful save, the operator wants to see the listing recomputed with their changes. `router.back()` would land on the detail page or the row they came from, which obscures whether the save took effect. This is a separate UX concern from filter preservation and should be discussed independently if it ever becomes a problem.

---

## SCEN-003: Cancel from a "new" form returns to the listing's prior URL

**Given**: the operator is on `/customers?q=lopez` and clicks "Nuevo Cliente" → `/customers/new`.
**When**: they click "Cancelar" without saving.
**Then**: the browser returns to `/customers?q=lopez`. Same `router.back()` mechanism — works for both `/<listing>/[id]/edit` and `/<listing>/new` because both push a fresh history entry on top of the listing URL.
**Evidence**: source-diff — the Cancel handler is identical for new and edit; one change covers both flows.
