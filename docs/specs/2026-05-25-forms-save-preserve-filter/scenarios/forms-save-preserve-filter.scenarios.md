---
name: forms-save-preserve-filter
created_by: claude-opus-4.7-via-brainstorming-skill
created_at: 2026-05-25T00:00:00Z
origin: operator report — saving an edited reservation from a filtered listing drops the filter; gap left by #33 (which fixed only Cancel/Volver)
---

# Scenarios — Saving an entity preserves the listing's filter (return-URL)

The 8 entity forms redirect to `router.push("/<listing>")` on successful save — a bare path that strips the listing's query string (the operator's filters, sort, page). #33 fixed Cancel/Volver via `router.back()` but intentionally left the post-submit redirect untouched. The fix carries the filtered listing URL forward as `?from=<encoded>` when navigating to edit/new, and the form pushes `safeReturnTo(from, "/<listing>")` after a successful save — preserving the filter while still landing on the listing (not the detail page) with fresh data.

---

## SCEN-001: Editing from a filtered listing preserves the filter on save
**Given**: the operator is on `/reservations?status=nueva&page=2`, clicks "Editar" on a row → `ReturnLink` navigates to `/reservations/<id>/edit?from=%2Freservations%3Fstatus%3Dnueva%26page%3D2`.
**When**: they change a field and click "Guardar" (the server action returns success).
**Then**: the browser lands on `/reservations?status=nueva&page=2` — filter, sort, and page restored exactly — and the listing shows the edited record (fresh data via the existing `revalidatePath`).
**Evidence**: `/agent-browser` runtime — assert `window.location.href` after save equals the filtered listing URL; the edited field's new value is visible in the corresponding row. Zero console errors / failed requests.

---

## SCEN-002: Creating from a filtered listing returns to the filtered listing
**Given**: the operator is on `/customers?q=lopez`, clicks "Nuevo Cliente" → `ReturnLink` navigates to `/customers/new?from=%2Fcustomers%3Fq%3Dlopez`.
**When**: they fill the form and click "Crear" successfully.
**Then**: the browser lands on `/customers?q=lopez` with the new record visible.
**Evidence**: `/agent-browser` runtime — `window.location.search` after save equals `?q=lopez`; the new record appears in the filtered list.

---

## SCEN-003: Cancel still preserves the filter (no regression on #33)
**Given**: the operator is on the edit form reached from a filtered listing.
**When**: they click "Cancelar" without saving.
**Then**: `router.back()` returns them to the filtered listing exactly as #33 shipped — the `from` query param does not interfere.
**Evidence**: `/agent-browser` runtime — after Cancel, the URL equals the pre-edit filtered listing URL. Source-diff: the Cancel `onClick` handlers are unchanged.

---

## SCEN-004: No `from` (deep-link / new tab) falls back to the bare listing
**Given**: the operator opens `/reservations/<id>/edit` directly (no `from` param — e.g. a bookmark, a cmd-clicked new tab, or an edit link on a detail page).
**When**: they save successfully.
**Then**: the browser lands on `/reservations` (bare) without error — identical to current behavior.
**Evidence**: unit — `safeReturnTo(null, "/reservations") === "/reservations"`. Runtime — open edit URL with no `from`, save, assert URL is `/reservations`.

---

## SCEN-005: Hostile `from` is rejected (open-redirect guard)
**Given**: a crafted edit URL whose `from` is `//evil.com`, `https://evil.com`, `/customers` (a different listing), or contains a backslash.
**When**: the form saves successfully.
**Then**: `safeReturnTo` rejects the value and navigates to the entity's own listing (`/reservations`) — never off-site and never to a different section.
**Evidence**: unit — `safeReturnTo("//evil.com", "/reservations")`, `safeReturnTo("https://evil.com", "/reservations")`, `safeReturnTo("/customers", "/reservations")`, and `safeReturnTo("/reservations\\@evil", "/reservations")` all return `"/reservations"`.

---

## SCEN-006: Behavior is consistent across all 8 forms
**Given**: each of the 8 entity forms (reservations, customers, referrals, cities, locations, rental-companies, categories, franchises).
**When**: the edit/new-from-filtered-listing → save flow runs.
**Then**: filter preservation behaves identically — each form reads `from` and redirects via `safeReturnTo(from, "/<its-listing>")`.
**Evidence**: source-diff — all 8 `*-form.tsx` files replace the bare `router.push("/<listing>")` with the `safeReturnTo`-guarded push; all 8 `columns.tsx` and 8 listing `page.tsx` swap the Editar/Nuevo `<Link>` for `<ReturnLink>`.

---

## SCEN-007: Modified-click on Editar/Nuevo opens the plain edit URL in a new tab
**Given**: the operator cmd/ctrl/shift/middle-clicks "Editar" on a row.
**When**: the browser opens the link in a new tab.
**Then**: `ReturnLink` does not `preventDefault` — the plain `<Link href>` fires, opening `/<entity>/<id>/edit` with no `from`. Saving there falls back to the bare listing (SCEN-004). The operator's current tab and its filter are untouched.
**Evidence**: unit/DOM — fire a click event with `metaKey: true` on `ReturnLink`; assert `preventDefault` was not called and no `router.push` with `from` occurred.

---

## Out of scope

- **Edit from a detail page** (`listing → detail → edit → save`): the 5 detail-page "Editar" links keep the plain `<Link>` (no `from`), so save lands on the bare listing — current behavior, no regression. Propagating `from` through the detail chain is deferred (marginal value, larger blast radius).
