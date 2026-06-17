---
name: location-schedule-v2
created_by: claude
created_at: 2026-06-17T00:00:00Z
issue: amaw-sas/rentacar-dashboard#95
source_of_truth: amaw-sas/rentacar-web docs/specs/2026-06-03-issue-47-schedule-restrictions-design.md
---

# Issue #95 — `locations.schedule` structured schema v2 (ola D1)

Replaces the free-text `schedule: z.record(z.string(), z.string())` with a
day-keyed `LocationSchedule` contract that is queryable per day, so the web
funnel (W1, blocked by D1+D2+D3) can restrict the calendar/time selector.

Contract: optional keys `mon|tue|wed|thu|fri|sat|sun|hol`, each an array of
`"HH:MM-HH:MM"` ranges. Absent key or `[]` = closed. `["00:00-24:00"]` = 24 h.
`display: z.string().optional()` is preserved so the web reading `schedule.display`
does not break before web ola W1.

Range rules (from the issue, copied verbatim — start/end asymmetry is deliberate):
- regex `/^([01]\d|2[0-3]):(00|30)-([01]\d|2[0-4]):(00|30)$/`
  start hour `00`–`23`, end hour `00`–`24` (the `24` enables the `24:00` sentinel),
  minutes `:00`/`:30` only.
- `start < end` compared in **minutes-from-midnight**, mapping `24:00 → 1440`.
- end must not exceed the `24:00` sentinel (i.e. `endMinutes ≤ 1440`), so `24:30`
  is rejected even though the regex shape admits it.

## SCEN-001 (AC-D1.1): typical week with closed-by-empty holiday passes
**Given**: a `LocationSchedule` value `{ mon: ["08:00-18:00"], sat: ["08:00-13:00"], hol: [] }`
**When**: parsed with `locationScheduleSchema` (and inside `locationSchema`)
**Then**: parse succeeds; `hol: []` is accepted as "closed"
**Evidence**: `safeParse(...).success === true` in `tests/unit/schemas/location.test.ts`

## SCEN-002 (AC-D1.2): off-grid minute boundary fails
**Given**: `{ mon: ["08:15-18:00"] }`
**When**: parsed
**Then**: parse fails (minutes must be `:00` or `:30`)
**Evidence**: `safeParse(...).success === false`

## SCEN-003 (AC-D1.3): inverted range fails
**Given**: `{ mon: ["18:00-08:00"] }`
**When**: parsed
**Then**: parse fails (start must be earlier than end in minutes-from-midnight)
**Evidence**: `safeParse(...).success === false`

## SCEN-004 (AC-D1.4): empty object is permissive
**Given**: `{}`
**When**: parsed
**Then**: parse succeeds (all day keys optional)
**Evidence**: `safeParse(...).success === true`

## SCEN-005 (AC-D1.5): display string and structured days coexist
**Given**: `{ display: "Lun-Vie 06:00-19:00", mon: ["08:00-18:00"] }`
**When**: parsed
**Then**: parse succeeds; `display` is retained alongside structured days
**Evidence**: `safeParse(...).success === true` and `result.data.display === "Lun-Vie 06:00-19:00"`

## SCEN-006 (AC-D1.6): 24-hour sentinel passes
**Given**: `{ mon: ["00:00-24:00"] }`
**When**: parsed
**Then**: parse succeeds (`0 < 1440`); this is the form ola D2 produces for 24 h branches
**Evidence**: `safeParse(...).success === true`

## SCEN-007 (AC-D1.7): degenerate and over-sentinel ranges fail
**Given**: `{ mon: ["24:00-24:00"] }` and separately `{ mon: ["23:30-24:30"] }`
**When**: each parsed
**Then**: both fail — `24:00` is not a valid start (regex), `24:00-24:00` is not `start < end`,
and `24:30` exceeds the `24:00` sentinel (`1470 > 1440`)
**Evidence**: `safeParse(...).success === false` for each

## SCEN-009 (hardening): zero-length range fails
**Given**: `{ mon: ["08:00-08:00"] }`
**When**: parsed
**Then**: parse fails (`start < end` is strict; a 0-minute window is not a valid open period)
**Evidence**: `safeParse(...).success === false`
**Rationale**: not in the issue ACs; added from edge-case review to lock the `<` invariant
against an accidental `<=` relaxation that would leak a 0-minute window to ola W1.

## SCEN-010 (hardening): unknown/misspelled day key fails loudly
**Given**: `{ monday: ["08:00-18:00"] }` and separately `{ lun: ["08:00-18:00"] }`
**When**: parsed
**Then**: both fail — `.strict()` rejects unknown keys instead of silently stripping them
**Evidence**: `safeParse(...).success === false` for each
**Rationale**: not in the issue ACs; without `.strict()` a typo'd or Spanish-locale day key is
dropped silently and the schedule collapses to "closed", silently blocking bookings on an open day.

## SCEN-008 (regression): existing locationSchema fields still validate
**Given**: a full valid location with `schedule: { mon: ["08:00-18:00"] }`
**When**: parsed with `locationSchema`
**Then**: parse succeeds; unchanged fields (uuid `rental_company_id`, required `code`/`name`,
`city_id` uuid, return-field defaults) keep their prior behavior; `schedule` defaults to `{}`
when absent (the location form has no schedule field, so the server action relies on this default)
**Evidence**: existing `location.test.ts` assertions remain green with the array-form fixture
