---
name: attribution-channel
created_by: claude
created_at: 2026-06-11T00:00:00Z
issue: 113
---

# Attribution by reservation (channel / click-id) — dashboard receiving arm

The dashboard accepts an optional `attribution` object on `POST /api/reservations`, derives a
marketing channel from it (`deriveAttributionChannel`), persists the raw signals + the derived
`attribution_channel`, and surfaces the channel as a badge in the reservations list (server-side
sortable + filterable), the reservation detail, and an Analytics → Origen tab. Capture on the
websites is out of scope (#121 / #35). Design: `../2026-06-11-issue-113-attribution-dashboard-design.md`.

Load-bearing distinction: `attribution` **absent** (`undefined`) → channel `null` → rendered
"Desconocido" (never captured). `attribution` **empty** (`{}`) → channel `direct` → "Directo"
(real direct traffic). Never conflate the two.

---

## SCEN-001: a Google ad click derives to Google Ads
**Given**: a reservation request whose `attribution = { gclid: "Cj0KCQ..." }`
**When**: `deriveAttributionChannel` runs on it
**Then**: the result is `google_ads`
**Evidence**: return value of `deriveAttributionChannel`

## SCEN-002: a Google click tagged display derives to Google Display
**Given**: `attribution = { gclid: "x", utm_medium: "display" }`
**When**: the channel is derived
**Then**: the result is `google_display` (the display/gdn/banner/cpm medium overrides the default google_ads)
**Evidence**: return value of `deriveAttributionChannel`

## SCEN-003: platform click-ids derive to their platform
**Given**: three separate inputs `{ fbclid: "x" }`, `{ msclkid: "x" }`, `{ ttclid: "x" }`
**When**: each is derived
**Then**: they yield `meta_ads`, `bing_ads`, `tiktok_ads` respectively
**Evidence**: return value of `deriveAttributionChannel` for each input

## SCEN-004: empty object is Directo, absent is Desconocido
**Given**: input `{}` and, separately, input `undefined`
**When**: each is derived
**Then**: `{}` yields `direct`; `undefined` yields `null`
**Evidence**: return value of `deriveAttributionChannel` for each input

## SCEN-005: the API persists the derived channel and raw click-id
**Given**: a valid `POST /api/reservations` body that additionally carries `attribution = { gclid: "x" }`
**When**: the reservation is created
**Then**: the inserted `reservations` row has `attribution_channel = 'google_ads'` and `gclid = 'x'`
**Evidence**: DB row columns `attribution_channel`, `gclid` for the inserted reservation

## SCEN-006: a request without attribution still saves and is unchanged
**Given**: a valid `POST /api/reservations` body with NO `attribution` field
**When**: the reservation is created
**Then**: the inserted row has all 9 attribution columns (`utm_source, utm_medium, gclid, gad_source,
fbclid, ttclid, msclkid, landing_referrer, attribution_channel`) `NULL`, and the JSON response body is
`{ reserveCode, reservationStatus }` exactly as before this feature
**Evidence**: the 9 attribution columns on the inserted DB row; the HTTP response JSON shape

## SCEN-007: the list badge shows the channel, old rows show Desconocido
**Given**: one reservation with `attribution_channel = 'meta_ads'` and one older reservation with
`attribution_channel = NULL`
**When**: the operator opens `/reservations`
**Then**: the first row's "Origen" column renders a "Meta Ads" badge; the older row renders "Desconocido"
**Evidence**: the rendered DOM text/badge in the "Origen" column for each row

## SCEN-008: filtering by Origen narrows server-side
**Given**: reservations across several channels including some with `attribution_channel = NULL`
**When**: the operator selects Origen = "Google Ads" (`?origen=google_ads`), then Origen = "Desconocido"
(`?origen=__unknown__`)
**Then**: the google_ads selection returns only rows where `attribution_channel = 'google_ads'`; the
Desconocido selection returns only rows where `attribution_channel IS NULL`; both totals match an
independent SQL count
**Evidence**: `attribution_channel` of every returned row; results-count label vs SQL count

## SCEN-009: sorting by Origen orders server-side
**Given**: reservations with mixed `attribution_channel` values
**When**: the operator sorts by the "Origen" column (`?sort=origen:asc`)
**Then**: the `origen` sort key resolves to the DB column `attribution_channel` and the returned page is
ordered by it server-side (not re-sorted in the browser)
**Evidence**: `parseListParams` mapping of `sort=origen:asc` → `{ column: "attribution_channel" }`; row order in the returned page

## SCEN-010: detail shows the badge and the raw signals
**Given**: a reservation with raw signals captured (e.g. `utm_source='google', utm_medium='cpc', gclid='x'`)
and channel `google_ads`; separately a `direct` reservation (all raw NULL, channel `direct`); separately a
`NULL` reservation
**When**: each reservation's detail page renders
**Then**: the captured one shows the "Google Ads" badge plus the raw utm/click-id/referrer values; the
`direct` one shows the "Directo" badge plus a "Sin señales capturadas (tráfico directo)" note; the `NULL`
one shows "Desconocido" and no raw-signals section
**Evidence**: rendered DOM of the detail page for each of the three reservations

## SCEN-011: analytics renders the per-channel breakdown
**Given**: reservations spanning multiple channels (all-time, all franchises — the Origen tab mirrors the
Referidos analytics: no period/franchise selector)
**When**: the operator opens Analytics → Origen
**Then**: the page renders a per-channel count and percentage over ALL reservations, with "Desconocido"
shown distinctly (not silently dropped), and zero console errors / failed network requests. The counts come
from a server-side `GROUP BY` aggregate (RPC `attribution_breakdown`) — never a row fetch that PostgREST's
max-rows cap could silently truncate (the #75 lesson).
**Evidence**: rendered chart/table values; browser console + network log; the query is an RPC, not a `select` of N rows

## SCEN-012: the utm fallback ladder (no click-id) derives correctly
**Given**: inputs (no click-id) `{ utm_source:"google", utm_medium:"cpc" }`, `{ utm_medium:"organic" }`,
`{ utm_source:"bing", utm_medium:"cpc" }`, `{ utm_source:"google", utm_medium:"display" }`,
`{ utm_medium:"display" }`, `{ utm_medium:"referral" }`, `{ utm_medium:"foobar" }`
**When**: each is derived
**Then**: results are `google_ads`, `organic`, `bing_ads`, `google_display`, `other`, `referral`, `other`
respectively
**Evidence**: return value of `deriveAttributionChannel` for each input

## SCEN-013: an external referrer derives to referral
**Given**: input `{ referrer: "https://www.google.com/" }` (no utm, no click-id)
**When**: the channel is derived
**Then**: the result is `referral`
**Evidence**: return value of `deriveAttributionChannel`

## SCEN-014: an own-domain referrer is internal navigation → Directo
**Given**: input `{ referrer: "https://www.alquilatucarro.com/gamas" }` (no utm, no click-id), where the
host is in `OWN_HOSTS`
**When**: the channel is derived
**Then**: the result is `direct` (the own-domain referrer is ignored as internal navigation and falls
through to the all-empty rule) — distinct from `undefined`, which yields `null`
**Evidence**: return value of `deriveAttributionChannel`

## SCEN-017: every channel has a complete presentation (no unlabeled/uncolored badge)
**Given**: the shared `channel-meta` module, consumed by the list, detail and analytics surfaces
**When**: presentation metadata is looked up for every member of `ATTRIBUTION_CHANNELS` and for the
`null` ("Desconocido") case
**Then**: each resolves to a non-empty Spanish label (per design §4: Google Ads, Google Display, Meta
Ads, TikTok Ads, Bing Ads, Orgánico, Referido web, Directo, Otro, Desconocido), a defined badge variant,
and a defined chart color — no channel can render unlabeled or uncolored; and `ATTRIBUTION_CHANNEL_SET`
contains exactly the 9 channel literals (for server-side filter validation) while `UNKNOWN_FILTER`
(`'__unknown__'`) is distinct from every channel literal and from the list `ALL` sentinel
**Evidence**: the resolved label/variant/color for each channel + null; membership of `ATTRIBUTION_CHANNEL_SET`

## SCEN-016: derivation is total — malformed input never throws
**Given**: malformed inputs that an untrusted JSON caller could emit — `null`, a non-object
(`"foo"`, `42`), and an object with non-string field values (`{ utm_source: 123 }`,
`{ gclid: 0 }`, `{ referrer: 12345 }`)
**When**: each is derived
**Then**: the function returns a value without throwing — `null` and non-objects yield channel
`null` (treated as absent, "Desconocido"); non-string field values are treated as absent so an
otherwise-empty object yields `direct`. Attribution must never block a booking (design §5: pure
and total).
**Evidence**: return value of `deriveAttributionChannel` for each input; no exception raised

## SCEN-015: derivation is case- and whitespace-insensitive
**Given**: inputs `{ utm_source: "  FACEBOOK  " }` and `{ gclid: "   " }`
**When**: each is derived
**Then**: the first yields `meta_ads` (trimmed + lowercased); the second treats the whitespace-only gclid
as absent (so with no other signal it yields `direct`)
**Evidence**: return value of `deriveAttributionChannel` for each input
