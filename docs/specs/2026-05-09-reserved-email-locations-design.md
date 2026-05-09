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

Migration `025_locations_address_map_fields.sql` makes `pickup_address` and `pickup_map` `NOT NULL` with non-blank `CHECK` constraints. The `return_*` columns are nullable and represent **a different physical spot for returns at this same location** (e.g., AABOT picks up at El Dorado airport but returns at "Diagonal 24C, 99-45 — a 5 minutos del Aeropuerto"). When `return_address` is null, the location returns at the same spot it picks up — so we fall back to its `pickup_address`/`pickup_map`. This is the only correct interpretation of the schema.

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

The "Ver en Google Maps" button is an `<a>` styled inline-block (table-based, email-safe — no flexbox), padding `8px 14px`, background = `franchiseColor`, white text, `border-radius: 6px`, `text-decoration: none`, `font-size: 13px`. The `href` is the raw `pickup_map` / `returnMapUrl` value.

## Affected files

| File | Change |
|---|---|
| `lib/email/notifications.ts` | Extend the `SELECT` for the `reservado` branch to include the 4 new location columns. Compute `returnAddress`/`returnMapUrl` with fallback. Pass 4 new props to `ReservedClientEmail`. |
| `lib/email/templates/reserved-confirmation.tsx` | Add 4 required props. Render two new rows (one under each location row) with address text + button. Add ~3 style consts for the button. |
| `tests/unit/email/notifications.test.ts` | Extend mock fixture (`pickup_location`/`return_location`) with the 4 new columns. Add assertion that `renderEmail` is called with props containing the address strings and map URLs. Add a test for the null-`return_address` fallback case. |

Files explicitly **not** modified:
- `lib/email/templates/components/reservation-details.tsx` — shared by `pending-client`, `pending-localiza`, `extras-localiza`, `total-insurance-localiza`, `monthly-client`, `monthly-localiza`, `pickup-reminder`, `post-pickup-reminder`, `reservation-request`. Out of scope.

## Observable scenarios

1. **Same pickup/return location.** Given a `reservado` reservation where `pickup_location_id === return_location_id` (e.g., both = "Aeropuerto El Dorado"), when `sendReservationNotifications` fires, then the rendered email contains the location's `pickup_address` text twice (once under "Lugar de Recogida", once under "Lugar de Devolución") and the `pickup_map` URL appears twice as button `href` values.

2. **Distinct locations, return has explicit `return_*`.** Given a `reservado` reservation where pickup_location = AABOT (has `return_address` populated) and return_location = AABOT, when notifications fire, then the email shows AABOT's `pickup_address` for recogida and AABOT's `return_address` (the different physical spot) for devolución, with each address paired with its respective map URL.

3. **Distinct locations, return location has `return_address = null`.** Given a `reservado` reservation where return_location's `return_address` is null, when notifications fire, then the rendered email's devolución block uses that location's `pickup_address` and `pickup_map` (fallback path).

4. **Email-client rendering.** When the rendered HTML is opened in Gmail, Outlook, and Apple Mail, then the "Ver en Google Maps" button is visibly styled as a button (background color = franchise color), is clickable, opens the correct shortlink, and the address text wraps cleanly without horizontal overflow on a 320px-wide mobile viewport.

## Satisfaction criteria

- All 4 scenarios above produce the stated observable outcome.
- `vitest run tests/unit/email/notifications.test.ts` passes with the new fixtures and assertions.
- Manual visual check: render `ReservedClientEmail` with sample props (Same-location and Distinct-location fixtures) → both visually correct in Gmail web preview.
- Linter and TypeScript pass: `pnpm lint && pnpm typecheck`.
- No regression in the 5+ other templates that import `ReservationDetails` (no changes to that file).

## Risks

- **Risk:** `pickup_map` shortlinks could expire or be rate-limited by Google. **Mitigation:** these shortlinks already exist in production data; they have not failed historically. Out of scope for this change.
- **Risk:** Some addresses are long (2 sentences, e.g., AABOT pickup). **Mitigation:** addressed by cell padding + natural text wrap; verified visually as part of satisfaction criteria.
- **Risk:** Outlook may strip `border-radius` from button. **Mitigation:** acceptable degradation — button is still clickable as a square.

## Rollout

Standard merge → deploy → next `reservado` event in production. No data migration, no env vars, no feature flag. Rollback = revert the 3-file commit.
