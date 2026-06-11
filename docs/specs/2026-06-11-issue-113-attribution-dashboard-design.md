# Issue #113 — Attribution by reservation (channel / click-id) — dashboard arm

**Date:** 2026-06-11
**Branch:** `task/issue-113-attribution`
**Status:** Design — pending spec review + user approval
**Epic:** #122 (cross-repo origin attribution)
**Sibling arms (out of scope here):** #121 (rentacar-web capture), #35 (rentacar-reservas capture)
**Delivery:** One cohesive PR, tasks 1–7 of the issue. GHL propagation (task 8) documented, deferred.

---

## 1. Context

The dashboard owns the DB, the public `POST /api/reservations` API, the reservations
UI and Analytics. This issue is the **receiving arm**: make the database, API, UI and
analytics ready and waiting for an `attribution` object. The **capture** of that object
on the public sites is the sibling arms (#121 / #35), which integrate against the
**Apéndice A contract** frozen below — out of scope here.

**Scope is the CHANNEL only.** Campaign, ad group and keyword are out of scope (later stage).

### Why click-id over `utm_source`
`utm_source` is hand-written when a campaign is built: it can be blank, misspelled, or
inconsistent (`FB` vs `facebook`). Click-ids (`gclid`, `fbclid`, `ttclid`, `msclkid`,
`gad_source`) are **auto-injected by each platform** into the ad URL (auto-tagging) — no
manual config, unambiguous platform identity. So derivation **prioritizes click-id** and
uses `utm_*` only as fallback.

### Two corrections to the issue body (it was written against a stale mental model)

**Correction 1 — filter & sort are SERVER-SIDE, not @tanstack faceted filters (issue #100).**
The issue's task 4 says "follow the existing @tanstack/react-table filter patterns". Since
issue #100 the reservations table runs `manualFiltering / manualSorting / manualPagination`
— it is a pure renderer of one server-rendered page. Filtering and sorting live in
`ReservationListParams` → URL → `getReservationsPage` (`.eq` / `.order`). Making "Origen"
sortable + filterable therefore touches **five files**, not just `columns.tsx` (see §3.4).

**Correction 2 — `lib/types/database.ts` is vestigial.**
The issue's task 7 says "run `pnpm db:types`". That file is not tracked, not imported, and
not load-bearing; the render path uses hand-written types + `as unknown as` casts. The new
column is typed **by hand** on the `ReservationRow` type and verified at runtime. Running
`db:types` is harmless but is not the typing mechanism.

### What does NOT change
`referrals` / `referral_id` / `referral_raw` are for **manual B2B partners** (hotels,
companies, salespeople) — not ad attribution. Channel attribution is a new, orthogonal
concept. That logic is untouched. Inserts use `createAdminClient()` (service role), so no
RLS change is needed to write; the existing `using (true)` SELECT policy for `authenticated`
already covers new columns. List queries `select("*")`, so the raw columns arrive on their
own — only typing and the derived-channel filter are added.

## 2. Goals / Non-goals

**Goals**
- Persist, per reservation, the raw attribution signals (utm_*, click-ids, referrer) **and**
  a denormalized derived `attribution_channel` for fast SQL filtering/aggregation.
- Accept an optional `attribution` object on `POST /api/reservations` without breaking the
  current contract (absent → all columns NULL, behaves exactly as today).
- Show the channel as a badge in the reservations list (sortable + filterable) and detail,
  and a per-channel breakdown in an Analytics → Origen tab.
- Single source of truth for the derivation rules and for channel labels/colors/order.

**Non-goals (YAGNI)**
- Capturing UTM/click-ids on the websites — that is #121 / #35.
- Campaign / ad group / keyword (stage 2).
- Backfill of existing reservations — impossible, the data was never captured; they stay
  `NULL` → "Desconocido".
- GHL propagation (task 8) — documented in §7, deferred; only build it if the GHL custom
  field already exists.
- First-click vs last-click model, persistence window, consent (Ley 1581) — all frontend
  capture concerns, decided in #121 / #35, not here. The dashboard persists whatever arrives.

## 3. Design

### 3.1 Module layout

**New**
- `lib/attribution/derive-channel.ts` — pure `deriveAttributionChannel(input?)` + the
  `AttributionInput` and `AttributionChannel` types, plus a module-level `OWN_HOSTS`
  constant (the brand + funnel domains: `alquilatucarro.com`, `alquilame.co`,
  `alquicarros.com`, `reservatucarro.com`). No I/O, no imports beyond types.
- `lib/attribution/channel-meta.ts` — `ATTRIBUTION_CHANNELS` (the ordered channel list),
  Spanish labels, badge color/variant per channel, plus the "Desconocido" rendering for
  `null`. Single source consumed by list, detail and analytics.
- `tests/unit/attribution/derive-channel.test.ts` — one test per derivation branch (8+).
- `app/(dashboard)/analytics/attribution/page.tsx` — server component (query) +
- `app/(dashboard)/analytics/attribution/attribution-charts.tsx` — client `recharts` view.

**Modified**
- `app/api/reservations/route.ts`
- `lib/reservations/list-params.ts`
- `lib/queries/reservations.ts`
- `app/(dashboard)/reservations/columns.tsx`
- `app/(dashboard)/reservations/reservations-table.tsx`
- `hooks/use-reservations-table-url-state.ts`
- `app/(dashboard)/reservations/[id]/page.tsx`
- `app/(dashboard)/analytics/tab-nav.tsx` (add the Origen tab)

### 3.2 Migration 057 (additive, non-destructive)

`supabase/migrations/<timestamp>_057_reservations_attribution.sql`:

```sql
alter table public.reservations
  add column utm_source            text,
  add column utm_medium            text,
  add column gclid                 text,
  add column gad_source            text,
  add column fbclid                text,
  add column ttclid                text,
  add column msclkid               text,
  add column landing_referrer      text,
  add column attribution_channel   text
    check (attribution_channel in (
      'google_ads','google_display','meta_ads','tiktok_ads',
      'bing_ads','organic','referral','direct','other'
    ));

create index idx_reservations_attribution_channel
  on public.reservations(attribution_channel);
```

The single-column index serves the list `.eq`/`.is` filter. The Analytics tab aggregates
count/% per channel over a `created_at` period; if that query shows up in the performance
pass, a composite `(attribution_channel, created_at)` index is the follow-up — not added
up front (YAGNI: the table is ~13k rows, a seq scan over the period is cheap today).

- Raw signals kept for audit and future re-derivation; `attribution_channel` denormalized
  for fast filter/aggregate.
- `attribution_channel` is **nullable on purpose**: `NULL` = the reservation never carried
  attribution (old rows, or web not yet updated) → rendered "Desconocido". `'direct'` = the
  attribution object arrived but was empty (real direct traffic). Never conflate the two.
- No backfill possible.
- **Deploy:** file lands in git now; tested on the testing branch first; applied to prod via
  MCP `apply_migration` at merge — **never `supabase db push`** (it would re-run the
  drop-marker migrations 049/051 already applied separately and drag destructive drifts).
  After `apply_migration`, rename the local file to the remote `schema_migrations` timestamp
  so a future diff does not see it as orphaned. Rollback is a symmetric `drop column`.

### 3.3 Derivation — `deriveAttributionChannel(input?)`

```ts
export interface AttributionInput {
  utm_source?: string | null;
  utm_medium?: string | null;
  gclid?: string | null;
  gad_source?: string | null;
  fbclid?: string | null;
  ttclid?: string | null;
  msclkid?: string | null;
  referrer?: string | null;
}

export type AttributionChannel =
  | 'google_ads' | 'google_display' | 'meta_ads' | 'tiktok_ads'
  | 'bing_ads' | 'organic' | 'referral' | 'direct' | 'other';

export function deriveAttributionChannel(input?: AttributionInput): AttributionChannel | null;
```

Pure function. Normalize every field to lowercase + `trim()` before comparing. Rules in
priority order (first match wins):

1. `input` absent (`undefined`) → `null` ("Desconocido").
2. `gclid` or `gad_source` present → `utm_medium` ∈ {display, gdn, banner, cpm} →
   `google_display`; else → `google_ads`.
3. `msclkid`, or `utm_source` ∈ {bing, microsoft, msn} → `bing_ads`.
4. `fbclid`, or `utm_source` ∈ {facebook, fb, instagram, ig, meta} → `meta_ads`.
5. `ttclid`, or `utm_source` ∈ {tiktok, tt, ttads} → `tiktok_ads`.
6. No click-id but `utm_medium` present:
   - ∈ {cpc, ppc, paid, paidsearch, paid-search, paid_search}: source google → `google_ads`;
     bing/microsoft → `bing_ads`; meta/facebook/instagram → `meta_ads`; tiktok → `tiktok_ads`;
     other → `other`.
   - ∈ {display, gdn, banner, cpm} → `google_display` if source google, else `other`.
   - ∈ {organic, social} → `organic`.
   - = referral → `referral`.
   - other → `other`.
7. No utm but `referrer` present **and its host is external** (not in `OWN_HOSTS`, including
   subdomains) → `referral`. An **own-domain referrer is internal navigation that carries no
   attribution**, so it is treated as absent and execution falls through to rule 8.
8. Everything empty (or only an own-domain referrer) → `direct`.

A field that is present but empty/whitespace after normalization counts as absent. An empty
object `{}` (all fields absent/empty) is **not** `undefined` → falls through to rule 8 →
`direct`. This is the load-bearing "Directo vs Desconocido" distinction.

**`gad_source` assumption (flag for the capture arms #121/#35):** rule 2 treats `gad_source`
as a paid-Google signal equivalent to `gclid`. This holds only if the websites attach
`gad_source` exclusively from paid ad landings. If a site were to forward `gad_source` on
non-paid Google traffic, derivation would mislabel it `google_ads`. The capture contract
(Apéndice A) must only populate click-id fields from genuine ad-click query params; this is
called out so the #121/#35 implementers honor it.

### 3.4 API `/api/reservations`

- Extend `ReservationRequestBody` with optional `attribution?: AttributionInput`.
- After resolving the customer, call `deriveAttributionChannel(body.attribution)`.
- In the `insert`, write the **8 raw columns** from `body.attribution` (each `?? null`) and
  `attribution_channel` (the derivation result, may be `null`) = **9 attribution columns total**.
  The 8 inputs of `AttributionInput` map 1:1 to the 8 raw columns, with the input field
  `referrer` mapping to the column `landing_referrer` (rename made explicit).
- No compatibility break: absent `attribution` → all columns `null`, identical to today.

### 3.5 List: server-side filter + sort + badge column

- `list-params.ts`: add `origen: "attribution_channel"` to `SORTABLE_COLUMNS`; add
  `attributionChannel: string | null` to `ReservationListParams`; parse it in
  `parseListParams` validated against the channel enum (an `ATTRIBUTION_CHANNEL_SET`), so an
  out-of-enum value is ignored. A sentinel for "Desconocido" filtering = `IS NULL`, reserved
  key `__unknown__`. The planner must confirm `__unknown__` collides with neither the channel
  enum nor the existing URL-state sentinel `ALL` (`__all__`) in `list-params.ts` — both are
  double-underscore-wrapped, so the new key must not duplicate an existing one.
- `queries/reservations.ts`: in `getReservationsPage`, `if (params.attributionChannel)` →
  `.eq("attribution_channel", …)`; the `__unknown__` sentinel → `.is("attribution_channel", null)`.
  Raw columns already arrive via `select("*")`.
- `reservations-table.tsx`: add a `<Select>` "Origen" in the toolbar (Todas / per channel /
  Desconocido), wired to `setFilter`.
- `use-reservations-table-url-state.ts`: add the `origen` filter to the URL state contract.
- `columns.tsx`: add `attribution_channel: AttributionChannel | null` to `ReservationRow`;
  new **"Origen"** column **between "Franquicia" and "Referido"**, rendering a `Badge` from
  `channel-meta.ts`, `enableSorting: true`.

### 3.6 Detail

`reservations/[id]/page.tsx`: show the channel badge, and in a secondary/collapsible section
the captured raw signals (utm_source, utm_medium, the click-ids, landing_referrer) for audit.
Two empty cases must render coherently: a `direct` reservation (`{}` arrived) has a badge but
all-NULL raw signals → the raw section renders with an explicit "Sin señales capturadas
(tráfico directo)" note rather than empty fields; an old `NULL` reservation ("Desconocido")
hides the raw section entirely (nothing was ever captured).

### 3.7 Analytics → Origen

- Add the tab in `analytics/tab-nav.tsx` (`{ label: "Origen", href: "/analytics/attribution" }`).
- `analytics/attribution/page.tsx` (server: count + % per channel over the period) +
  `attribution-charts.tsx` (client recharts), mirroring `analytics/referrals/`.
- Minimum: count and % of reservations per channel in the period, with "Desconocido" shown
  distinctly (grouped/visible, not silently dropped). Reuse `channel-meta.ts`.

## 4. Channel label map (Spanish)

`google_ads`→"Google Ads", `google_display`→"Google Display", `meta_ads`→"Meta Ads",
`tiktok_ads`→"TikTok Ads", `bing_ads`→"Bing Ads", `organic`→"Orgánico",
`referral`→"Referido web", `direct`→"Directo", `other`→"Otro", `null`→"Desconocido".

## 5. Error handling

- Derivation is pure and total — never throws; unknown shapes fall to `other` or `direct`.
- API: malformed `attribution` (not an object) is ignored → treated as absent → `null`
  channel; the reservation still saves (attribution must never block a booking).
- Migration `check` constraint rejects any out-of-enum `attribution_channel` at the DB level,
  so a derivation bug surfaces as an insert error rather than silent bad data.

## 6. Testing

- `tests/unit/attribution/derive-channel.test.ts`: one case per rule, including
  `gclid`→google_ads, `gclid`+`utm_medium=display`→google_display, `fbclid`→meta_ads,
  `msclkid`→bing_ads, `ttclid`→tiktok_ads, the rule-6 utm ladder (`utm_medium=cpc`+source,
  `utm_medium=organic`→organic, unknown medium→other), rule-7 external referrer→referral,
  own-domain referrer→direct, absent→`null`, `{}`→`direct`, whitespace-only fields→treated
  as absent, case-insensitivity. (Mirrors SCEN-1..4, 12..15.)
- Runtime verification (testing branch): POST with `attribution:{gclid:"x"}` →
  `attribution_channel='google_ads'` + `gclid` persisted; POST without `attribution` → all
  attribution columns NULL, flow unchanged; list shows "Origen" badge, old rows "Desconocido";
  sort + filter by channel work; detail shows raw signals; Analytics → Origen renders with
  zero console errors / failed requests.
- Gate: `pnpm type-check`, `pnpm lint`, `pnpm test` green.

## 7. Out of scope (documented)

- **GHL (task 8): explicitly out of this PR.** No GHL probing or mapping happens in this
  effort. The follow-up, if pursued: if a matching GHL custom field exists, map
  `attribution_channel` in `lib/ghl/mapper.ts` toward the contact/opportunity. Kept out to
  prevent scope creep — `attribution_channel` is persisted and can be propagated later without
  rework.
- Website capture (#121 / #35), campaign/ad-group/keyword, backfill.

## 8. Apéndice A — Frozen contract for the websites (reference; not implemented here)

Each site, on `POST /api/reservations`, includes an optional `attribution` object:

```jsonc
{
  // ...current reservation fields...
  "attribution": {
    "utm_source":  "google",
    "utm_medium":  "cpc",
    "gclid":       "Cj0KCQ...",
    "gad_source":  "1",
    "fbclid":      "IwAR...",
    "ttclid":      "E.C....",
    "msclkid":     "abc123",
    "referrer":    "https://www.google.com/"
  }
}
```

Frontend responsibility (later stage): read params + `document.referrer` on first landing;
persist (~90 days); attach on reservation create; send `attribution: {}` (empty) when there
is no data so the dashboard records **Directo** instead of "Desconocido".

## 9. Observable scenarios (bridge to SDD)

- **SCEN-1 (derive: google):** Given `attribution={gclid:"x"}`, when derived, then channel =
  `google_ads`.
- **SCEN-2 (derive: google display):** Given `{gclid:"x", utm_medium:"display"}`, then
  `google_display`.
- **SCEN-3 (derive: meta/bing/tiktok):** Given `{fbclid}`/`{msclkid}`/`{ttclid}`, then
  `meta_ads`/`bing_ads`/`tiktok_ads` respectively.
- **SCEN-4 (derive: direct vs unknown):** Given `{}`, then `direct`; given `undefined`, then
  `null`.
- **SCEN-12 (derive: utm ladder, no click-id):** Given `{utm_source:"google", utm_medium:"cpc"}`,
  then `google_ads`; given `{utm_medium:"organic"}`, then `organic`; given
  `{utm_source:"bing", utm_medium:"cpc"}`, then `bing_ads`; given `{utm_medium:"foobar"}`,
  then `other`.
- **SCEN-13 (derive: external referrer → referral):** Given
  `{referrer:"https://www.google.com/"}` (no utm, no click-id), then `referral`.
- **SCEN-14 (derive: own-domain referrer → direct):** Given
  `{referrer:"https://www.alquilatucarro.com/gamas"}` (no utm, no click-id), then `direct`
  (own host is ignored, falls through to rule 8) — distinct from `undefined` → `null`.
- **SCEN-15 (derive: whitespace/case):** Given `{utm_source:"  FACEBOOK  "}`, then `meta_ads`
  (trim + lowercase); given `{gclid:"   "}` (whitespace only), then treated as absent.
- **SCEN-5 (API persist):** Given POST with `attribution={gclid:"x"}`, when saved, then the
  row has `attribution_channel='google_ads'` and `gclid='x'`.
- **SCEN-6 (API compat):** Given POST without `attribution`, when saved, then all 9 columns
  are NULL and the response is unchanged from today.
- **SCEN-7 (list badge):** Given a row with `attribution_channel='meta_ads'` and an old row
  with NULL, when the list renders, then the first shows "Meta Ads" and the second
  "Desconocido".
- **SCEN-8 (list filter):** Given filter Origen=`google_ads`, when applied, then only
  google_ads rows return; Origen=Desconocido returns only NULL rows.
- **SCEN-9 (list sort):** Given sort by Origen, when applied, then rows order by
  `attribution_channel` server-side.
- **SCEN-10 (detail):** Given a reservation with raw signals, when its detail renders, then
  the badge + the raw utm/click-id/referrer values are shown.
- **SCEN-11 (analytics):** Given reservations across channels in a period, when Analytics →
  Origen renders, then per-channel count and % appear with zero console errors.
