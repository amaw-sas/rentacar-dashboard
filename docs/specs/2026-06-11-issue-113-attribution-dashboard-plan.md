# Issue #113 — Implementation Plan (dashboard attribution arm)

**Date:** 2026-06-11
**Design:** `docs/specs/2026-06-11-issue-113-attribution-dashboard-design.md`
**Branch / worktree:** `task/issue-113-attribution` · `.worktrees/issue-113-attribution`
**Delivery:** one PR, 8 steps across 4 SDD phases. Scenarios SCEN-1..15 (design §9) are the holdout set.

Clarification / research / design phases are already complete and approved in the design spec;
this document is the file-structure map + ordered, scenario-embedded implementation steps only.

---

## Chunk 1: File structure + implementation steps

### File structure map

**New files**

| File | Single responsibility |
|------|------------------------|
| `supabase/migrations/<ts>_057_reservations_attribution.sql` | Add 8 raw columns + `attribution_channel` (check enum) + filter index. Additive only. |
| `lib/attribution/derive-channel.ts` | Pure `deriveAttributionChannel(input?)`, `AttributionInput`/`AttributionChannel` types, `OWN_HOSTS`. No I/O. |
| `lib/attribution/channel-meta.ts` | `ATTRIBUTION_CHANNELS` (ordered), ES labels, badge colors, `ATTRIBUTION_CHANNEL_SET`, `UNKNOWN_FILTER` sentinel. Shared by list/detail/analytics. |
| `tests/unit/attribution/derive-channel.test.ts` | Encodes SCEN-1..4, 12..15 — one case per derivation branch (~15). |
| `tests/unit/attribution/channel-meta.test.ts` | Exhaustiveness: every channel + null has a label/color. |
| `app/(dashboard)/analytics/attribution/page.tsx` | Server component: query per-channel count/% over the period. |
| `app/(dashboard)/analytics/attribution/attribution-charts.tsx` | Client recharts view of the breakdown. |

**Modified files**

| File | Change |
|------|--------|
| `app/api/reservations/route.ts` | `ReservationRequestBody += attribution?`; derive; insert 9 attribution columns (`referrer`→`landing_referrer`). |
| `lib/reservations/list-params.ts` | `SORTABLE_COLUMNS += origen`; `ReservationListParams += attributionChannel`; parse + validate + `__unknown__`. |
| `lib/queries/reservations.ts` | `getReservationsPage`: `.eq`/`.is` on `attribution_channel`. (raw cols already arrive via `*`) |
| `app/(dashboard)/reservations/columns.tsx` | `ReservationRow += attribution_channel`; "Origen" badge column between Franquicia and Referido; sortable. |
| `app/(dashboard)/reservations/reservations-table.tsx` | "Origen" `<Select>` in toolbar. |
| `hooks/use-reservations-table-url-state.ts` | `origen` filter in the URL-state contract. |
| `app/(dashboard)/reservations/[id]/page.tsx` | Channel badge + collapsible raw-signals section (direct vs NULL empty cases). |
| `app/(dashboard)/analytics/tab-nav.tsx` | Add `{ label: "Origen", href: "/analytics/attribution" }`. |

Files that change together stay together: derivation + its types in one module; all channel
presentation (labels/colors/order) centralized in `channel-meta.ts` so list, detail and
analytics never drift.

---

## Prerequisites

- Worktree `.worktrees/issue-113-attribution` on `task/issue-113-attribution` (exists).
- Supabase testing branch for runtime verification (QA login per the known SQL-seed procedure).
- No new dependencies.

---

## Implementation Steps

### Phase 1 — Foundation (contract: DB + pure logic + shared meta)

**Step 1 — Migration 057 (DB contract).** Size: S. Deps: none.
Create `supabase/migrations/<ts>_057_reservations_attribution.sql` exactly as design §3.2.
- *Scenario (infra check — does NOT consume a §9 holdout scenario):* applying the migration adds the 9 columns + index; inserting a row
  with `attribution_channel='bogus'` is rejected by the check constraint; a valid value
  (`'google_ads'`) and `NULL` both insert.
- *Acceptance:* file present; applied to the testing branch via MCP; `\d reservations` shows the
  9 columns + `idx_reservations_attribution_channel`; the bogus-value insert fails, valid/NULL pass.

**Step 2 — `deriveAttributionChannel` pure function + tests.** Size: M. Deps: none (parallel to 1).
Write `tests/unit/attribution/derive-channel.test.ts` FIRST encoding SCEN-1..4, 12..15, then
implement `lib/attribution/derive-channel.ts` (types, `OWN_HOSTS`, the 8-rule ladder, lowercase+trim
normalization, whitespace-as-absent, external-vs-own-host referrer).
- *Scenario:* SCEN-1 `{gclid}`→google_ads; SCEN-2 `{gclid,utm_medium:display}`→google_display;
  SCEN-3 `{fbclid}`/`{msclkid}`/`{ttclid}`→meta/bing/tiktok; SCEN-4 `{}`→direct, `undefined`→null;
  SCEN-12 utm ladder (cpc×source, organic, display×source, referral, other); SCEN-13 external
  referrer→referral; SCEN-14 own-domain referrer→direct; SCEN-15 whitespace/case.
- *Acceptance:* `pnpm test tests/unit/attribution/derive-channel.test.ts` green, ~15 cases, every
  rule branch covered.

**Step 3 — `channel-meta.ts` shared presentation module + test.** Size: S. Deps: Step 2 (type).
`ATTRIBUTION_CHANNELS` ordered list, ES label map (design §4), badge color/variant per channel,
"Desconocido" for null, `ATTRIBUTION_CHANNEL_SET` (for param validation), `UNKNOWN_FILTER='__unknown__'`.
- *Scenario:* a test asserts every member of `ATTRIBUTION_CHANNELS` and `null` resolves to a
  non-empty label and a defined color — no channel can render unlabeled.
- *Acceptance:* `pnpm test tests/unit/attribution/channel-meta.test.ts` green; `pnpm type-check` clean.

### Phase 2 — Core (API persistence)

**Step 4 — API accepts, derives, persists attribution.** Size: M. Deps: Steps 1–2.
In `app/api/reservations/route.ts`: extend `ReservationRequestBody` with `attribution?: AttributionInput`;
after customer resolution call `deriveAttributionChannel(body.attribution)`; in the insert write the 8
raw columns (`?? null`, `referrer`→`landing_referrer`) + `attribution_channel`. Malformed `attribution`
(non-object) is ignored → treated as absent (booking never blocked).
- *Scenario:* SCEN-5 — POST `{..., attribution:{gclid:"x"}}` → saved row has
  `attribution_channel='google_ads'` and `gclid='x'`. SCEN-6 — POST without `attribution` → all 9
  attribution columns NULL and the JSON response is byte-identical to today's.
- *Acceptance:* on the testing branch, both POSTs verified via SQL on the inserted row; existing
  reservation flow (notifications, response shape) unchanged. The "byte-identical response"
  guarantee (SCEN-6) holds only because the route returns `{ reserveCode, reservationStatus }`
  from a `.select("id")` insert — the new columns are written but never projected into the
  response. Confirm this projection stays narrow; do not widen it to echo attribution.

### Phase 3 — Integration (list: server filter/sort + UI)

**Step 5 — Server-side filter + sort plumbing.** Size: M. Deps: Steps 1, 3.
`list-params.ts`: `SORTABLE_COLUMNS += { origen: "attribution_channel" }`; `ReservationListParams +=
attributionChannel: string | null`; parse `origen` param validated against `ATTRIBUTION_CHANNEL_SET`
plus the `__unknown__` sentinel (anything else → null). `queries/reservations.ts`: in
`getReservationsPage`, channel value → `.eq("attribution_channel", v)`, `__unknown__` →
`.is("attribution_channel", null)`.
- *Scenario:* SCEN-8/9 (server) — unit test `parseListParams` maps `?origen=google_ads` and
  `?origen=__unknown__` correctly and rejects `?origen=bogus`→null; `?sort=origen:asc` resolves to
  `attribution_channel`.
- *Acceptance:* `pnpm test tests/unit/reservations/list-params.test.ts` (extend existing) green.

**Step 6 — List UI: Origen column + toolbar filter + URL state.** Size: M. Deps: Steps 3, 5.
`columns.tsx`: `ReservationRow += attribution_channel: AttributionChannel | null`; new "Origen" column
between "Franquicia" and "Referido" rendering a `Badge` from `channel-meta.ts`, `enableSorting: true`.
`reservations-table.tsx`: "Origen" `<Select>` (Todas / per channel / Desconocido) wired to `setFilter`.
`use-reservations-table-url-state.ts`: add `origen` to the URL-state contract.
- *Scenario:* SCEN-7 — a `meta_ads` row shows "Meta Ads", an old NULL row shows "Desconocido".
  SCEN-8 (UI) — selecting Origen=Google Ads narrows the list to google_ads rows; Desconocido → NULL rows.
- *Acceptance:* runtime (agent-browser, testing branch): badge renders per channel, filter + column
  sort work, zero console errors / failed requests.

### Phase 4 — Polish (detail + analytics)

**Step 7 — Reservation detail: badge + raw signals.** Size: S. Deps: Step 3.
`[id]/page.tsx`: channel badge + collapsible raw-signals section. `direct` (all-NULL raw) → renders
"Sin señales capturadas (tráfico directo)"; `NULL`/Desconocido → section hidden.
- *Scenario:* SCEN-10 — a reservation with raw signals shows badge + utm/click-id/referrer values; a
  `direct` one shows the note; a `NULL` one hides the section.
- *Acceptance:* runtime: three cases render correctly, no console errors.

**Step 8 — Analytics → Origen tab.** Size: M. Deps: Step 3.
`tab-nav.tsx` += Origen tab; `analytics/attribution/page.tsx` (server: count + % per channel over the
selected period, "Desconocido" shown distinctly) + `attribution-charts.tsx` (recharts), mirroring
`analytics/referrals/`.
- *Scenario:* SCEN-11 — reservations across channels in a period → per-channel count and % render.
- *Acceptance:* runtime: breakdown renders with `channel-meta` colors/labels, "Desconocido" visible,
  zero console errors / failed requests.

---

## Testing Strategy

- **Unit (vitest):** derivation (~15 cases, Step 2), channel-meta exhaustiveness (Step 3),
  list-params parsing (Step 5). All embedded in their step — no separate test-only step.
- **Runtime (testing branch + agent-browser):** API persistence (Step 4), list badge/filter/sort
  (Step 6), detail (Step 7), analytics (Step 8). Zero console errors, zero failed requests.
- **Gate:** `pnpm type-check && pnpm lint && pnpm test && pnpm build` all green before PR.

## Rollout Plan

- **Migration deploy:** apply 057 to prod via MCP `apply_migration` at merge — **never `db push`**
  (drags drop-markers 049/051). Rename local file to the remote `schema_migrations` timestamp after.
- **Types:** run `pnpm db:types` (harmless); the load-bearing typing is hand-written on `ReservationRow`.
- **Monitoring:** after deploy, new reservations from #121/#35 begin populating `attribution_channel`;
  pre-existing rows stay NULL ("Desconocido") — expected, no backfill.
- **Rollback:** symmetric `drop column` migration; UI/API tolerate NULL so a partial rollback degrades
  gracefully to "Desconocido" everywhere.

## Open Questions

- None blocking. GHL propagation (task 8) deferred by design. First/last-click + consent are the
  sibling arms' (#121/#35) decisions, not this PR's.
