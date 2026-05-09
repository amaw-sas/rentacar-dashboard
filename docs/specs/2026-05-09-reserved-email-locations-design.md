# Spec: Pickup/Return Address + Map Link in Approved Reservation Email

**Date:** 2026-05-09
**Status:** Approved (brainstorming gate)
**Owner:** Pablo Diaz
**Scope:** `Reserva Aprobada` notification email (status `reservado` → `ReservedClientEmail`) only.

---

## Problem

The approved-reservation email currently shows only the **name** of the pickup and return locations (e.g., "Aeropuerto El Dorado"). Customers reaching the agency for the first time often need the full street address and a map link to navigate. They have to search for it manually or call support, which adds friction at a high-stakes moment (arriving at the airport with luggage).

The data already exists in `public.locations` (`pickup_address`, `pickup_map`, `return_address`, `return_map` — added in migration 025). It is not yet surfaced in the email.

## Goal

Render, in the `Reserva Aprobada` email, the full address and a clickable "Ver en Google Maps" link for both the pickup and return locations.

## Non-goals

- Other email templates (`pending-client`, `mensualidad`, `pickup-reminder`, etc.) are out of scope. They can be iterated separately if the need surfaces.
- No static map images. No Google Static Maps API integration. No new external dependencies.
- No QR codes.
- No schema changes. No new env vars. No new API surface.

## Approach

### Why "link only" instead of static map image

Google Static Maps API would require: enabling billing on a Google Cloud project, geocoding the existing addresses (the `maps.app.goo.gl` shortlinks do not embed lat/lng), storing or fetching coordinates, adding `GOOGLE_MAPS_STATIC_API_KEY` to 3 franchise envs, handling fallback when the API fails. Estimated 1–2 days of work plus ongoing per-image cost.

A clickable button to the existing shortlink delivers the same functional outcome (the user reaches Google Maps) with zero infra cost and immediate compatibility with all email clients (Gmail, Outlook, Apple Mail, mobile webviews). The data already in the DB is sufficient.

### Data flow

```
sendReservationNotifications(reservationId, "reservado", franchiseCode)
  └── fetchReservationContext(reservationId)
       └── SELECT … pickup_location:locations!pickup_location_id (
                      name, pickup_address, pickup_map
                    ),
                    return_location:locations!return_location_id (
                      name, pickup_address, pickup_map,
                      return_address, return_map
                    )
  └── Apply fallback for return:
       returnAddress = return_location.return_address ?? return_location.pickup_address
       returnMapUrl  = return_location.return_map     ?? return_location.pickup_map
  └── ReservedClientEmail({
        …existing props,
        pickupAddress, pickupMapUrl,
        returnAddress, returnMapUrl,
      })
```

### Fallback semantics

Migration `025_locations_address_map_fields.sql` makes `pickup_address` and `pickup_map` `NOT NULL` with non-blank `CHECK` constraints. The `return_*` columns are nullable and represent **a different physical spot for returns at this same location** (e.g., AABOT picks up at El Dorado airport but returns at "Diagonal 24C, 99-45 — a 5 minutos del Aeropuerto"). When `return_address` is null, the location returns at the same spot it picks up — so we fall back to its `pickup_address`/`pickup_map`.

**Atomic pair fallback.** The schema does NOT enforce a both-or-neither constraint on `return_address`/`return_map`, but the seeded data convention is to set both or neither. To prevent inconsistent rendering (e.g., a `return_map` URL that doesn't match the `return_address` text, or vice versa), the fallback is **atomic**:

```ts
const useReturnOverride = Boolean(returnLoc.return_address) && Boolean(returnLoc.return_map);
const returnAddress = useReturnOverride ? returnLoc.return_address : returnLoc.pickup_address;
const returnMapUrl  = useReturnOverride ? returnLoc.return_map     : returnLoc.pickup_map;
```

If either column is missing, both fall back together. Never mix-and-match.

### URL safety and HTML escaping

The `pickup_map` and `returnMapUrl` values are rendered as `<a href={url}>`. Migration 025's `CHECK` only validates non-blank — it does NOT validate URL shape. A future bad row could ship `javascript:alert(1)` and reach the email client. To prevent this, validate at the data layer (in `notifications.ts`) before passing to the template:

```ts
const isSafeMapUrl = (u: string) =>
  u.startsWith("https://maps.app.goo.gl/") || u.startsWith("https://www.google.com/maps/");
```

Both prefixes require a trailing `/` so attackers cannot smuggle a different host via path tricks (e.g., `https://www.google.com/mapsX-evil`).

If `isSafeMapUrl(url)` returns false, omit the button (render only the address text). Log a warning that includes the offending location's `code` and the rejected URL — the `code` enables the data team to find and fix the row in one query. The address text itself is rendered as JSX children — React Email escapes it by default; no further sanitization needed.

### Render

Two rows added inline inside `reserved-confirmation.tsx` (NOT in the shared `ReservationDetails` component, which is used by 6+ other templates):

```
| Lugar de Recogida  | Aeropuerto El Dorado          |
| Dirección          | Piso 1 Puerta 7, Punto de…    |
|                    | [ Ver en Google Maps → ]      |
| Fecha de Recogida  | 15 de mayo 2026 - 9:00 AM     |
| Lugar de Devolución| Diagonal 24C, 99-45 …         |
| Dirección          | Diagonal 24C, 99-45 - a 5…    |
|                    | [ Ver en Google Maps → ]      |
| Fecha de Devolución| 20 de mayo 2026 - 9:00 AM     |
```

The "Ver en Google Maps" button is an `<a>` styled inline-block (table-based, email-safe — no flexbox):

- `padding: 12px 18px` (yields ≥44px touch-target height for mobile a11y, WCAG 2.5.5)
- `background: franchiseColor`, `color: #ffffff`, `font-size: 14px`, `font-weight: 600`
- `border-radius: 6px` (gracefully degrades to square in Outlook), `text-decoration: none`
- `display: inline-block`, `mso-padding-alt: 0` (Outlook spacing safe)
- `target="_blank"` + `rel="noopener noreferrer"` (link opens in new context — required for safe external nav)
- `aria-label="Abrir {locationName} en Google Maps (nueva pestaña)"` so screen readers convey destination + new-tab behavior

The `href` is the validated map URL (see "URL safety" below). When validation fails, the button is omitted entirely — only the address text remains.

### Dark mode

Decision: **accept native client inversion**. Apple Mail and Gmail iOS may auto-invert colors; the franchise color and white text remain legible after inversion (verified for the 3 franchise palette colors). No `prefers-color-scheme` media query, no `color-scheme` meta — both have inconsistent client support and add complexity beyond the goal.

## Affected files

| File | Change |
|---|---|
| `lib/email/notifications.ts` | Extend the `SELECT` in `fetchReservationContext` to include the 4 new location columns on `pickup_location` and `return_location`. Inside the `reservado` branch, compute `pickupAddress`/`pickupMapUrl`/`returnAddress`/`returnMapUrl` with atomic fallback + URL-safety check. Pass 4 new props to `ReservedClientEmail`. Other status branches and `sendReservationRequestEmail` continue to ignore the extra columns — harmless additions to the SELECT. |
| `lib/email/templates/reserved-confirmation.tsx` | Add 4 props (`pickupAddress`, `pickupMapUrl?`, `returnAddress`, `returnMapUrl?` — map URLs optional because URL-safety check may strip them). Render two new rows (one under each location row) with address text + conditional button. Add style consts for the button. Pass `pickupLocationName` / `returnLocationName` to a small inline helper for the `aria-label`. |
| `tests/unit/email/notifications.test.ts` | Extend mock fixture (`pickup_location`/`return_location`) with the 4 new columns plus a `code` field. Add assertions: (a) `renderEmail` receives props containing the address strings and map URLs; (b) atomic fallback when `return_address` is null AND `return_map` is null; (c) atomic fallback triggers when `return_map` is set but `return_address` is null (mixed-null pair → fall back together); (d) malformed `pickup_map` (e.g., `javascript:alert(1)`) results in `pickupMapUrl=undefined` passed to the template AND `console.warn` is called with arguments whose joined string includes BOTH the location `code` AND the rejected URL. Add a snapshot test (`tests/unit/email/reserved-confirmation.snapshot.test.ts`) that renders `ReservedClientEmail` with two fixtures (same-location, distinct-location), parses the HTML via `jsdom` (already a dev-dep), and asserts: button `href`/`target`/`rel`/`aria-label`, inline-style substrings, no element exceeds 320px width, and structural-negative oracle for the malformed-URL fixture. |

Files explicitly **not** modified:
- `lib/email/templates/components/reservation-details.tsx` — shared by `pending-client`, `pending-localiza`, `extras-localiza`, `total-insurance-localiza`, `monthly-client`, `monthly-localiza`, `pickup-reminder`, `post-pickup-reminder`, `reservation-request`. Out of scope.
- No generated `database.types.ts` exists in this project (verified) — rollback is a clean 4-file revert (the 3 modified files above plus the new `tests/unit/email/reserved-confirmation.snapshot.test.ts`).

## Observable scenarios

1. **Same pickup/return location.** Given a `reservado` reservation where `pickup_location_id === return_location_id` (e.g., both = "Aeropuerto El Dorado"), when `sendReservationNotifications` fires, then the rendered HTML contains the location's `pickup_address` text twice (once under "Lugar de Recogida", once under "Lugar de Devolución") and the `pickup_map` URL appears twice as button `href` attributes.

2. **Distinct locations, return has explicit `return_*` pair.** Given a `reservado` reservation where pickup_location = AABOT (has both `return_address` and `return_map` populated) and return_location = AABOT, when notifications fire, then the email shows AABOT's `pickup_address`+`pickup_map` for recogida and AABOT's `return_address`+`return_map` (the different physical spot) for devolución.

3. **Distinct locations, return pair fully null.** Given a `reservado` reservation where return_location has `return_address = null` AND `return_map = null`, when notifications fire, then the rendered email's devolución block uses that location's `pickup_address` and `pickup_map` (fallback path).

4. **Mixed-null return pair.** Given a `reservado` reservation where return_location has `return_address = "Some street"` but `return_map = null` (or vice versa), when notifications fire, then the atomic fallback triggers — devolución block shows the location's `pickup_address` and `pickup_map`, NOT the partial override. Verified by unit assertion comparing rendered props.

5. **Malformed map URL.** Given a `reservado` reservation where `pickup_map = "javascript:alert(1)"` (or any URL not starting with `https://maps.app.goo.gl/` / `https://www.google.com/maps/`), when notifications fire, then:
   - The rendered HTML contains the pickup address text under the "Dirección" row.
   - **Structural negative oracle:** within the pickup-row group, the count of `<a` elements whose `href` starts with `https://maps` is `0` (i.e., no button rendered). Asserted via DOM query, not a substring search.
   - A `console.warn` is emitted whose payload contains BOTH the location's `code` (e.g., `"AABOT"`) AND the rejected URL substring. Asserted via spy on `console.warn` checking the joined argument string includes both.

6. **Email-client rendering (concrete oracles).** Given the rendered HTML for scenarios 1 and 2, when validated against snapshot fixtures committed under `tests/unit/email/__snapshots__/reserved-confirmation.html`, then:
   - The output HTML satisfies oracle-based assertions on attributes, style substrings, and structural counts (NOT byte-for-byte equality — see plan § Risk Tracker for the rationale of preferring oracles over full-HTML snapshots).
   - The button anchor has `href` = expected URL, `target="_blank"`, `rel="noopener noreferrer"`, `aria-label` containing the location name, and inline style includes `padding:12px 18px` and `background:` + the franchise hex.
   - **Declared-width assertion** (jsdom has no layout engine, so we inspect declared values, not computed): no element in the rendered HTML declares an inline `width:` or `max-width:` style — or a `width=` attribute — greater than 320px. Asserted by parsing the HTML with `jsdom` (already a dev-dep), walking all elements, and pattern-matching the `style` attribute and `width` attribute against numeric values > 320.

## Satisfaction criteria

- All 6 scenarios above produce the stated observable outcome — verified by automated tests, not visual judgment.
- `pnpm vitest run tests/unit/email/` passes with the extended fixtures, snapshot fixture, and 4 new assertions.
- `pnpm lint && pnpm typecheck` pass.
- No regression in the 5+ other templates that import `ReservationDetails` (no changes to that file — verified by `git diff` scope).
- Snapshot fixtures committed alongside the test, reviewable in PR diff.

## Risks

- **Risk:** `pickup_map` shortlinks could expire or be rate-limited by Google. **Mitigation:** these shortlinks already exist in production data; they have not failed historically. Out of scope for this change.
- **Risk:** Some addresses are long (2 sentences, e.g., AABOT pickup). **Mitigation:** addressed by cell padding + natural text wrap; verified by snapshot 320px-width assertion.
- **Risk:** Outlook may strip `border-radius` from button. **Mitigation:** acceptable degradation — button is still clickable as a square.
- **Risk:** A new bad row in `locations.pickup_map` slips through the non-blank `CHECK` with a malicious URI scheme. **Mitigation:** runtime URL allowlist in `notifications.ts` (see "URL safety"). Logged warning surfaces the bad row to the data team without breaking the email.
- **Risk:** Adding columns to the shared `fetchReservationContext` SELECT increases payload for non-`reservado` callers. **Mitigation:** 4 short-text columns per location, ~200 bytes max — negligible. Confirmed callers are `sendReservationNotifications` (uses extras only in `reservado` branch) and `sendReservationRequestEmail` (ignores extras).

## Rollout

Standard merge → deploy → next `reservado` event in production. No data migration, no env vars, no feature flag. Rollback = revert the 4-file commit (or merge revert).
