# Implementation Plan: Pickup/Return Address + Map Link in Reserved Email

**Date:** 2026-05-09
**Spec:** [`2026-05-09-reserved-email-locations-design.md`](./2026-05-09-reserved-email-locations-design.md)
**Status:** Ready for review

---

## File Structure

| File | Purpose | Status |
|---|---|---|
| `lib/email/notifications.ts` | Data fetch + per-status template orchestration | **Modify** — extend SELECT, add atomic-pair fallback + URL-safety filter in `reservado` branch, log warning with location `code` for unsafe URLs, pass 4 new props to `ReservedClientEmail`. |
| `lib/email/templates/reserved-confirmation.tsx` | React Email template for "Reserva Aprobada" | **Modify** — add 4 props (`pickupAddress`, `pickupMapUrl?`, `returnAddress`, `returnMapUrl?`), 2 new rows (Dirección under each location row), conditional `<a>` button with email-safe styles + a11y attrs. |
| `tests/unit/email/notifications.test.ts` | Existing notifications dispatch test | **Extend** — add `code`, `pickup_address`, `pickup_map`, `return_address`, `return_map` to mock fixtures; assertions for happy path, atomic null-pair fallback, mixed-null pair fallback, malformed-URL filter + warn payload contains `code`. |
| `tests/unit/email/reserved-confirmation.snapshot.test.ts` | Structural assertion of rendered HTML | **New** — render template with 3 fixtures (same-location, distinct-location, malformed-URL), parse with `jsdom` (already a dev-dep), assert button `href`/`target`/`rel`/`aria-label`, inline-style substrings, declared-width oracle (no element declares `width` or `max-width` > 320px), structural-negative oracle (zero `<a href^="https://maps">` in pickup row when URL filtered). |

**Files explicitly NOT modified:** `lib/email/templates/components/reservation-details.tsx` (shared by 9+ templates — out of scope).

**No new dependencies.** No env vars. No schema changes. No new API routes. Rollback = revert these 4 files.

---

## Prerequisites

- `jsdom` already installed (`^29.0.1`, dev) — used for parsing in the snapshot test.
- `@react-email/render` already wired via `lib/email/render.ts`.
- `pnpm` is the only allowed package manager (per `feedback_package_manager.md` memory).
- No external service setup required (Google Maps shortlinks are existing data).

---

## Implementation Steps

### Step 1 — URL allowlist + happy-path safety check | Size: S | Dependencies: none

**What:** In `lib/email/notifications.ts`, add a private const `isSafeMapUrl(u: string): boolean` that returns `true` only when `u.startsWith("https://maps.app.goo.gl/")` or `u.startsWith("https://www.google.com/maps/")` (note the trailing `/` on the second prefix to prevent host-smuggling per spec § URL safety).

**Why now:** Foundational pure function used by Steps 3+. Easiest scenario to write first; cannot regress later steps.

**Scenario embedded:** Given a candidate URL string, when `isSafeMapUrl` is called, then it returns `true` exclusively for the two whitelisted prefixes and `false` for `javascript:alert(1)`, `http://maps.app.goo.gl/x`, `https://maps.app.goo.gl` (no trailing slash), `https://www.google.com/mapsX-evil`, and the empty string.

**Acceptance criteria:**
- A new test block in `tests/unit/email/notifications.test.ts` (or co-located helper test) covers the 5 negative cases above and 2 positive cases — all green.
- `pnpm vitest run tests/unit/email/notifications.test.ts` passes.

---

### Step 2 — Extend `fetchReservationContext` SELECT | Size: S | Dependencies: Step 1

**What:** In `lib/email/notifications.ts`, extend the joined-location selects:
- `pickup_location:locations!pickup_location_id (name, code, pickup_address, pickup_map)`
- `return_location:locations!return_location_id (name, code, pickup_address, pickup_map, return_address, return_map)`

**Why now:** The data has to be available before the `reservado` branch can consume it. This step intentionally does NOT yet wire any new prop — proves the SELECT is harmless to other callers (`sendReservationRequestEmail` and the non-`reservado` status branches) before behavior changes.

**Scenario embedded:** Given an existing test exercising the `pendiente` and `mensualidad` branches, when `sendReservationNotifications` runs after the SELECT extension, then those branches still pass without code or assertion changes — i.e., the extra columns are harmless extras for other consumers.

**Acceptance criteria:**
- Mock fixture in `tests/unit/email/notifications.test.ts` extended with the 4 new fields + `code` on both joined locations.
- `pnpm vitest run tests/unit/email/notifications.test.ts` still passes for ALL pre-existing assertions.
- `pnpm typecheck` passes.

---

### Step 3 — Atomic fallback + URL safety + props plumbed to template | Size: M | Dependencies: Step 2

**What:** Inside the `if (status === "reservado")` branch of `sendReservationNotifications`:
1. Read `pickupLoc` and `returnLoc` from the fetched reservation.
2. Compute `useReturnOverride = Boolean(returnLoc.return_address) && Boolean(returnLoc.return_map)` — atomic both-or-neither.
3. Derive `returnAddress` and `returnMapRaw` from the override or from `returnLoc.pickup_*`.
4. Apply `isSafeMapUrl` to both pickup and return map URLs; if either fails, set the corresponding `*MapUrl` prop to `undefined` AND `console.warn` with a payload that includes the location's `code` and the rejected URL value.
5. Add 4 props to the `ReservedClientEmail({...})` call: `pickupAddress`, `pickupMapUrl?`, `returnAddress`, `returnMapUrl?`.
6. In `lib/email/templates/reserved-confirmation.tsx`, extend the props interface with these 4 fields (map URLs typed `string | undefined`). Do not yet render anything new — TypeScript should compile because the props are accepted but unused at this step.

**Why now:** Separates data-layer concerns (Step 3) from render concerns (Step 4) so each step can be reviewed and tested independently. A regression in step 3 is caught before any visual change ships.

**Scenarios embedded** (matching design § Observable scenarios):
- **Scenario 3** (full null pair): `return_address = null` AND `return_map = null` → assertion: `renderEmail` called with props where `returnAddress === returnLoc.pickup_address` and `returnMapUrl === returnLoc.pickup_map`.
- **Scenario 4** (mixed null pair): `return_address = "X"` but `return_map = null` → atomic fallback triggers; assertion: same as Scenario 3, override is rejected as a unit.
- **Scenario 5** (malformed URL): `pickup_map = "javascript:alert(1)"` → assertion: prop `pickupMapUrl === undefined` AND `console.warn` was called with a string payload containing both the location's `code` (e.g., `"AABOT"`) and the rejected URL substring `"javascript:alert(1)"`.

**Acceptance criteria:**
- 3 new tests in `notifications.test.ts` cover Scenarios 3, 4, 5 — all green.
- `pnpm vitest run tests/unit/email/notifications.test.ts` passes.
- `pnpm typecheck` passes (template accepts the new optional props without rendering).
- No visual change to the rendered email yet (verified manually by re-rendering the existing fixture in dev preview if available, or by snapshot diff being empty in the existing dev path).

---

### Step 4 — Render Dirección rows + button in template | Size: M | Dependencies: Step 3

**What:** In `lib/email/templates/reserved-confirmation.tsx`:
1. Add a row labeled **"Dirección"** immediately under the existing "Lugar de Recogida" row, with cell content = `pickupAddress` text + (when `pickupMapUrl` is defined) a button anchor below it.
2. Add the analogous "Dirección" row under "Lugar de Devolución" using `returnAddress` + `returnMapUrl`.
3. Button anchor structural requirements (per spec):
   - `<a href={mapUrl} target="_blank" rel="noopener noreferrer" aria-label={\`Abrir ${locationName} en Google Maps (nueva pestaña)\`}>Ver en Google Maps →</a>`
   - Inline styles: `display: inline-block`, `padding: 12px 18px`, `background: franchiseColor`, `color: #ffffff`, `font-size: 14px`, `font-weight: 600`, `border-radius: 6px`, `text-decoration: none`, `mso-padding-alt: 0`.
4. Pass the existing pickup/return location names (already available in the template via the `ReservationDetails` props) into the new helper for the `aria-label`.

**Why now:** Render layer is the smallest meaningful change after data is plumbed — keeps the diff focused.

**Scenario embedded:**
- **Scenario 1** (same location): given the same-location fixture, when the template renders, then the rendered HTML contains the `pickup_address` text twice (one occurrence per Dirección row) and the `pickup_map` URL appears as `href` on exactly two `<a>` elements within the Detalles table.

**Acceptance criteria:**
- Snapshot test (created in Step 5) for the same-location fixture passes.
- Manual re-render of the existing dev fixture in the dev preview shows the two new rows with a visible button styled in the franchise color.
- `pnpm typecheck` and `pnpm lint` pass.

---

### Step 5 — Snapshot test with structural oracles | Size: M | Dependencies: Step 4

**What:** Create `tests/unit/email/reserved-confirmation.snapshot.test.ts`:

1. **Fixture A — Same-location:** pickup_location = return_location, both with the same `pickup_address` / `pickup_map`, no `return_*` overrides.
2. **Fixture B — Distinct-location with explicit `return_*`:** pickup_location = AABOT-like (with `return_address` + `return_map` populated), return_location = same row, so its `return_*` is used for devolución.
3. **Fixture C — Malformed pickup_map:** pickup_map = `"javascript:alert(1)"` → notifications.ts already sets `pickupMapUrl = undefined`; here we render the template directly with that prop missing.

For each fixture: render via `renderEmail()`, parse the resulting HTML with `new JSDOM(html)` (jsdom is already a dev-dep, no new install).

**Oracles asserted:**
- **Fixture A & B:** for each Dirección row, locate the `<a>` element and assert: `getAttribute("href")` equals the expected URL, `target === "_blank"`, `rel === "noopener noreferrer"`, `getAttribute("aria-label")` includes the corresponding location name; `getAttribute("style")` includes the substrings `padding:12px 18px` (or normalized form), `background:` followed by the franchise hex, `border-radius:6px`.
- **Fixture B specifically:** assert that the recogida `href` !== devolución `href` (different physical spots).
- **Fixture C:** within the pickup row's container, count of `<a>` elements whose `href` starts with `https://maps` is exactly `0`; the address text node IS present.
- **Declared-width oracle (all fixtures):** walk every element; for each, parse the `style` attribute for `width:` or `max-width:` and the `width=` HTML attribute; assert no parsed numeric value > 320 (per spec § scenario 6 declared-width assertion).

**Why now:** Snapshot infrastructure can only be written once the template renders the new content. Combining the fixture creation here keeps the snapshot test self-contained.

**Scenarios embedded:** Scenarios 1, 2, 5 from the spec (the structural oracles are the verification mechanism for these).

**Acceptance criteria:**
- New file `tests/unit/email/reserved-confirmation.snapshot.test.ts` with 3 `it()` blocks (one per fixture) — all green.
- `pnpm vitest run tests/unit/email/` passes (this file + the extended `notifications.test.ts`).
- `pnpm lint && pnpm typecheck` pass.
- `git diff --name-only` shows exactly the 4 files in the File Structure table — no unintended scope creep.

---

## Testing Strategy

| Layer | Mechanism | What it proves |
|---|---|---|
| Pure-function unit | Direct call to `isSafeMapUrl` (Step 1) | URL allowlist correctness |
| Data-layer unit | Extended `notifications.test.ts` with mocked `createAdminClient` (Steps 2, 3) | SELECT extension is harmless; atomic fallback; URL safety + warn payload contains `code` |
| Template structural | New `reserved-confirmation.snapshot.test.ts` parsing rendered HTML via jsdom (Steps 4, 5) | Button `href`/`target`/`rel`/`aria-label`; inline styles; declared-width ≤ 320px; structural-negative oracle for filtered URL |
| Manual visual | Render a sample fixture via the existing dev-preview path or temporary script; open in browser; spot-check Gmail web preview | Subjective visual quality (color, spacing, wrap on long addresses) — backstop for the snapshot oracle |

**Scope of NOT-tested (intentional):**
- Real cross-client rendering in Outlook, Apple Mail (would require Litmus/Email-on-Acid; out of scope per spec — accepted risk).
- Live Google Maps shortlink resolution (out of scope per spec).

---

## Rollout Plan

1. **Branch + PR.** Single feature branch off `main`; one PR with all 5 steps as separate commits (so a reviewer can walk Step-1 → Step-5 sequentially).
2. **CI gate.** PR cannot merge until `pnpm lint`, `pnpm typecheck`, and `pnpm vitest run tests/unit/email/` all pass.
3. **Manual visual check before merge.** Render the Reserved email in dev for one franchise; verify button appearance + address wrap on the AABOT pickup address (longest in the seed data).
4. **Merge to main → automatic deploy** via existing pipeline. No data migration. No env var to set.
5. **Verification in production.** Within 24h of deploy, monitor `notification_logs` for any failed `reservado_cliente` send. Visually verify the next real `reservado` event reaches the customer with the new layout.
6. **Rollback** = revert the merge commit. Reverts all 4 files atomically. ≤ 2 minutes. No data cleanup needed.

---

## Risk Tracker

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Snapshot test brittleness from cosmetic style edits | Med | Low | Oracle-based assertions inspect attributes + style substrings, not full-HTML byte equality, so trivial whitespace changes don't break tests. |
| Gmail clipping email body if it grows past 102KB | Low | Med | Two new rows + button add ~600 bytes per email — far below threshold. |
| Outlook strips `border-radius` | High | Low | Documented as accepted degradation in spec; button still clickable. |
| Bad `pickup_map` URL slips into prod data later | Med | High → mitigated to Low | URL allowlist + warn + button omission = email still useful, log surfaces the bad row. |
