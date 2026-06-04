# Migration pre-flight check (issue #16)

Read-only script that checks every legacy MariaDB identifier has an
equivalent in the destination Supabase before any ETL runs. It is the
gating step before issues #19, #20, #21. Better to find a lookup gap here
than halfway through a production migration with half the tables written.

It validates four lookups:

| Check | Legacy source | Destination |
|---|---|---|
| `franchises` | `franchises.name` | static enum `{alquilatucarro, alquilame, alquicarros}` |
| `branches` | `branches.code` | `locations.code` joined to `rental_companies.code = 'localiza'` |
| `categories` | `categories.identification` | `vehicle_categories.code` joined to `rental_companies.code = 'localiza'` |
| `identification_type` | `reservations.identification_type` | static set `{Cedula Ciudadania, Cedula Extranjeria, Pasaporte}` |

For each check it computes `gaps = legacy_set − destination_set`. Any
non-empty gap means an identifier exists in legacy with no destination
equivalent — the ETL would fail blind on it.

## Setup (one-time, operator-managed)

The venv is intentionally outside the repo and not committed.

Prerequisite (Debian/Ubuntu/WSL): the stdlib `venv` module ships separately.
If `python -m venv` fails with an `ensurepip is not available` error, install
it first:

```bash
sudo apt install python3-venv
```

```bash
cd scripts/migration
python -m venv .venv
source .venv/bin/activate
pip install pymysql psycopg2-binary python-dotenv
```

All five vars must be present AND non-empty — an empty value is treated
as missing (a gate must not run half-configured). No var is exempt.

Then create the env file from the template and fill in all five values:

```bash
cp .env.example .env
$EDITOR .env
```

`.env` is gitignored. `.env.example` is committed; never put real
credentials in it.

## Running

From the repo root, with the venv active:

```bash
python scripts/migration/preflight-check.py
echo $?   # exit code
```

The script writes a JSON report to
`docs/migration-runs/preflight-<UTC-timestamp>.json` (gitignored —
reports can contain full legacy code lists). The timestamp is UTC
ISO-8601 with microsecond precision; the JSON `timestamp` field keeps
the standard `:`-separated form, but the filename replaces `:` with `-`
so it is filesystem-safe across Linux/macOS/Windows and two back-to-back
runs never collide. The write is atomic (temp file + rename) so a
reader or a crash never sees a partial JSON. If the canonical directory
is not writable it falls back to `/tmp/preflight-<timestamp>.json`
(also atomic) and warns on stderr. It also prints a summary table to
stdout.

Per-check values are trimmed and any blank value (empty after trim) is
skipped, on BOTH the legacy and destination side — this avoids phantom
or whitespace-variant false gaps from dirty legacy data.

### Comparison contract

After trimming and blank/NULL skipping, the gap comparison
(`legacy_set − destination_set`) is **exact and case-sensitive** — by
design. Codes and identifiers are compared byte-for-byte: no
case-folding, no accent normalization, no fuzzy matching. A casing
variant (legacy `gr` vs destination `GR`) or an accent variant
(`Cédula` vs `Cedula`) is reported as a **real gap**, not silently
folded away. A migration gate must *surface* identifier drift, not hide
it: if legacy and destination disagree on the exact spelling of a code,
the ETL would mismatch on it, so the operator must see and resolve it
before any data is written. This is intended semantics, not a bug.

The `SUPABASE_DB_URL` never appears unmasked anywhere — report and
error messages show `postgresql://***@host:port/db`, and a malformed
URL is fully redacted to `postgresql://***@***/***`.

## Exit codes

| Code | Meaning | Operator action |
|---|---|---|
| `0` | All checks passed, no gaps | ETL may run |
| `1` | At least one check has gaps (no query errors) | Review report gaps, human decision |
| `2` | Connection failure (legacy or destination) | Check stderr for which side; fix host/creds |
| `3` | At least one check had a query error | Check report `error` field per check; fix SQL/schema |
| `4` | A required env var is missing or empty | Fill `.env` (stderr lists which) |
| `5` | Report not persisted to ANY path (canonical AND `/tmp` both failed) | Fix filesystem permissions; rerun |
| `6` | Unexpected/uncaught error (sanitized — never the message body) | Read stderr exception type; investigate |

Precedence when several conditions hold: env-missing (4) is checked
before any connection; a connection failure (2) aborts before any check
runs — including a destination connection that dies *mid-run* (pooler
idle drop / network blip), which aborts with code 2 and writes NO JSON
(distinct from a query-level error on one check); after checks run,
**report-write failure (5) dominates** — if the JSON could not be
persisted to ANY path the operator has no durable gating evidence, so 5
outranks both a query error (3) and a plain gap (1). A successful `/tmp`
fallback is NOT code 5 (report was written; stderr carries a warning).
Among the rest, a query error (3) dominates a plain gap (1). Code 6 only
fires for an otherwise-uncaught crash and is sanitized so no connection
string leaks.

> **A non-zero exit other than 1 does NOT mean "no gaps".** The exit
> code reflects the *dominant* condition only (precedence: report-lost 5
> > query-error 3 > gaps 1 > ok 0, plus 2 env-or-connection, 6
> unexpected). In particular **exit 3 (query error) says nothing about
> gaps** — checks that ran fine may still have gaps recorded in the JSON.
> A caller that branches solely on the exit code will miss them. For the
> gap decision, parse the JSON report: the top-level `passed` and each
> check's `gaps` array are the source of truth, not the exit code.

## What each scenario means

- **SCEN-001** — happy path: #17 applied, all 4 checks pass, exit 0.
- **SCEN-002** — gap detection: without #17, `categories` reports gaps
  `["G", "GR", "LP", "VP"]`, exit 1.
- **SCEN-003** — missing env var: exit 4, name on stderr, no JSON, no
  connection opened.
- **SCEN-004** — destination unreachable: exit 2, stderr says
  "destination connection failed", URL masked, no JSON.
- **SCEN-005** — idempotency: two consecutive runs differ only in the
  `timestamp` field and the filename.
- **SCEN-006** — per-check isolation: one broken query yields exit 3 with
  that check's `error` populated, the other three still complete.

---

# ETL: customers (issue #19)

`etl-customers.py` extracts unique customers from the legacy MariaDB
`rentacar_audit.reservations` (read-only), dedups them by `TRIM(identification)`
— the destination's single-column `UNIQUE(identification_number)` — transforms
them to the destination shape, and inserts them into Supabase
`public.customers` transactionally (`ON CONFLICT (identification_number) DO
NOTHING`). Run the migration pre-flight (above) first — it must pass before
this ETL runs.

## Setup

Same venv and `.env` as the pre-flight (above): the five vars
`LEGACY_DB_HOST` / `LEGACY_DB_USER` / `LEGACY_DB_PASSWORD` / `LEGACY_DB_NAME` /
`SUPABASE_DB_URL`. No extra dependencies — same `pymysql`, `psycopg2-binary`,
`python-dotenv`.

The destination MUST have migrations through **048**
(`20260525201336_048_customers_legacy_migrated_marker.sql`) applied, so the
`customers._legacy_migrated_at` marker column exists.

## Transform decisions (encoded in the code + unit tests)

- **Identification normalization** (`normalize_identification`): strips spaces,
  dots, and dashes only — never alphanumerics. `12.345.678` / `12 345 678` /
  `12345678` collapse to `12345678`; a passport `AB-12345` becomes `AB12345`
  (letters kept). The normalized value is BOTH the dedup key AND the persisted
  `identification_number`.
- **Dedup key** = the normalized identification alone (never the legacy
  composite `(type, identification)` — that would violate the single-column
  UNIQUE). Latest-wins by `updated_at DESC`, stable tiebreak `created_at DESC`
  then legacy row id DESC (deterministic → idempotent). `created_at =
  MIN(group)`, `updated_at = MAX(group)`.
- **Type mapping**: `Cedula Ciudadania → CC`, `Cedula Extranjeria → CE`,
  `Pasaporte → PP`. Anything else → row rejected
  (`reason="invalid_identification_type"`), never guessed.
- **Fullname split**: 1 token → `(token, '.')` + `needs_review=true`;
  2/3/4+ tokens per the documented rule; stopwords `{de, del, la, las, los}`
  glue to the following token (compound surname). An empty name OR a name that
  is ENTIRELY stopwords (e.g. `"de la"`) → rejected
  (`reason="invalid_first_name"`) — an all-stopword string is not a name, so it
  is never persisted as `first_name="de la"` (issue #63).
- **Placeholder discard (Q11)**: `is_placeholder` (against the NORMALIZED id)
  discards three closed junk families: `^0+$` (all-zeros), keyboard ramps
  (prefixes of `1234567890`, length ≥ 6), and a verified operator/test denylist.
  Discarded BEFORE dedup, logged `action="skipped", reason="placeholder"`. This
  REPLACED the original provisional `^123\d{4,}$` regex, which the 2026-05-25
  dry-run proved discarded ~66 REAL 10-digit cédulas starting with `123`
  (personal emails + birth-year correlation). A closed enumeration cannot
  over-match a real cédula. The gitignored JSONL report enumerates EVERY
  discarded identification in full; the stdout summary keeps only the count and
  `within_expected_range`. **Commit-mode gate (Decision A):** if the unique
  discarded-placeholder count is outside `[1, 30]` (a coarse anomaly tripwire —
  the closed rule discards 14 on the real dump), the gate FAILS, the whole
  transaction rolls back, and the run exits 7. `--dry-run` never blocks on the
  range — it completes and enumerates the full list so the operator can eyeball
  it. Always run the dry-run first and eyeball that list.
- **Control chars + bad rows**: free-text fields are stripped of NUL and other
  control characters during extraction (Postgres text rejects them). If a row
  still raises a DB error inside a batch, the batch retries row-by-row so one
  bad row is isolated as `rejected` while the rest insert — one bad row never
  rolls back up to 500 good rows. If a `ROLLBACK TO SAVEPOINT` itself fails (the
  transaction is poisoned, `25P02`), the error PROPAGATES and the whole run
  aborts (exit 3) rather than masking the real poison row behind spurious
  per-row rejects (issue #63).
- **Full accounting**: every scanned legacy row has exactly one disposition.
  Blank/NULL-identification rows are counted in `dropped_no_identification`;
  zero-date / unparseable timestamps are counted in `timestamp_fallback` AND
  EXCLUDED from the dedup `created_at` MIN / `updated_at` MAX — the synthetic
  sentinel never persists as year 0001; an all-fallback customer coalesces to
  the run-start timestamp (issue #63). The summary's `reconciliation` block
  proves `legacy_rows_total == inserted + skipped + rejected +
  placeholder_reservations + dropped_no_identification` at the row level.

## Running

From the repo root with the venv active:

```bash
# Dry-run: read + compute + ROLLBACK. Writes NOTHING to the destination.
python scripts/migration/etl-customers.py --dry-run
echo $?

# Commit: COMMITs only if the gate passes
# (0 unexpected rejects
#  AND unique placeholder count within [1, 30]
#  AND inserted == computed_unique_non_placeholder, or every non-inserted
#      record is an explained idempotent skip).
# Else the whole transaction is ROLLED BACK (exit 7).
python scripts/migration/etl-customers.py
echo $?
```

`--dry-run` is also enabled by the env var `ETL_DRY_RUN=1`. Always run a
dry-run against a disposable Supabase branch first (validate the placeholder
list and the conflict counts), then commit.

`--help` prints usage and the exit-code table.

## Reports

- **Per-row JSONL** at
  `docs/migration-runs/etl-customers-<UTC-timestamp>.jsonl` (atomic write,
  `/tmp` fallback). One object per logged event: `inserted` / `skipped`
  (`placeholder` / `already_migrated` / `conflict_existing`) / `rejected` /
  `resolved` (`cross_type_id`, with the legacy types seen and the winner).
  The **full discarded-placeholder id list and the cross-type ids live here
  only**. **Gitignored — it carries identification numbers (PII).**
- **Aggregate summary** printed to stdout as a JSON object: counts, elapsed,
  mode, gate decision, conflict tallies, the placeholder COUNT +
  `within_expected_range`, and the `reconciliation` block. **No PII** — no
  identification lists, no cross-type ids. This is the evidence to transcribe
  into `docs/data-ops/2026-05-22-issue-19-etl-customers/run-summary.md`.

## Idempotency

A re-run inserts 0: `ON CONFLICT DO NOTHING` plus the `_legacy_migrated_at`
marker. Skips are classified by the existing row's marker —
`already_migrated` (a prior ETL run) vs `conflict_existing` (dashboard-owned,
marker NULL, never overwritten). Both are "explained" skips that pass the gate.
A `conflict_unknown` (ON CONFLICT fired yet the row is absent on re-read — a
"shouldn't happen" anomaly) is NOT explained: it FAILS the commit gate and
rolls the whole transaction back (issue #63).

## Exit codes

| Code | Meaning | Operator action |
|---|---|---|
| `0` | Run completed (dry-run, or commit that committed) | Review report/summary |
| `2` | Connection failure (legacy or destination, URL masked) | Fix host/creds |
| `3` | Query / insert failure (sanitized) | Check stderr exception type |
| `4` | A required env var is missing or empty | Fill `.env` (stderr lists which) |
| `5` | Report not persisted to ANY path (canonical AND `/tmp`) | Fix filesystem permissions; rerun |
| `6` | Unexpected/uncaught error (sanitized — never the body) | Read stderr exception type |
| `7` | Commit mode: gate FAILED (unexpected rejects, placeholder count outside `[1, 30]`, unexplained insert mismatch, or any `conflict_unknown` skip) → whole transaction ROLLED BACK, nothing written | Read the stderr reason + stdout summary; fix the cause; rerun |

(Code `1` is reserved for the pre-flight's "gaps" and is not used by the ETL.)

## Rollback

`docs/data-ops/2026-05-22-issue-19-etl-customers/rollback.sql` deletes ONLY
rows with `_legacy_migrated_at IS NOT NULL` (the ETL-inserted ones);
dashboard-created customers (marker NULL) are never touched. It opens with an
executable FK guard (`DO $$ ... RAISE EXCEPTION ... $$`) that aborts the whole
transaction if any reservation references an ETL-inserted customer, so the
rollback can never partially run. After sign-off, migration **049**
(`20260525201337_049_drop_customers_legacy_migrated_marker.sql`) drops the
marker column.

# ETL: reservations (issue #20)

`etl-reservations.py` reads the legacy MariaDB `rentacar_audit.reservations`
(read-only, 12,967 rows), rewrites every legacy BIGINT FK to its destination
UUID/enum, transforms each row to the destination shape, and inserts them **1:1**
into Supabase `public.reservations` transactionally (`ON CONFLICT (_legacy_id)
DO NOTHING`). Unlike customers (#19), reservations are NOT deduped — one legacy
row becomes one destination row, or one logged reject. Run AFTER #19 customers
and #17 categories are migrated — their rows are the FK targets this ETL
resolves against.

## Setup

Same venv and `.env` as #19: `LEGACY_DB_HOST` / `LEGACY_DB_USER` /
`LEGACY_DB_PASSWORD` / `LEGACY_DB_NAME` / `SUPABASE_DB_URL`. Same `pymysql`,
`psycopg2-binary`, `python-dotenv`.

The destination MUST have migrations through **050**
(`..._050_reservations_legacy_migrated_marker.sql`) applied, so the
`reservations._legacy_id` (idempotency key, UNIQUE) and `_legacy_migrated_at`
(provenance marker) columns exist. It must ALSO have #19 customers and #17
categories migrated, or FK resolution cascade-rejects en masse.

## FK resolution (the core new work)

Before insert, six lookup structures are built — most from the DESTINATION, a
few composed with the legacy id→code/name tables:

- **customer_id** ← `customers.identification_number → id`, keyed by
  `normalize_identification(legacy.identification)` (the SAME function #19 used as
  its dedup key / persisted `identification_number`, so the join lands). A legacy
  identification absent from the map (e.g. a #19-discarded placeholder) →
  `customer_not_migrated`.
- **pickup_location_id / return_location_id** ← legacy `branches` (id→code)
  composed with destination `locations` (code→id). NULL legacy branch →
  `{side}_location_null`; a branch code with no destination location →
  `{side}_location_unmapped` (distinct, so a broken `branches.code`↔
  `locations.code` mapping is visible, not lost in the NULL bucket).
- **category_code** ← legacy `categories` (id→identification) validated against
  the destination `vehicle_categories.code` set → `category_unmapped` if outside.
- **franchise** ← legacy `franchises` (id→name) → enum, lowercase-exact against
  `{alquilatucarro, alquilame, alquicarros}` → `franchise_unmapped` if outside.
- **rental_company_id** ← the single `localiza` UUID (P6: all legacy
  reservations are Localiza, 1:1).
- **referral_id / referral_raw** ← `referrals.code` keyed `lower(trim(user))`.
  `legacy.reservations.user` IS the referral column (P12 correction, 2026-05-19),
  NOT an operator name. `referral_raw` is the trimmed original, PRESERVED even
  when `referral_id` is NULL (free-text user that matches no code). Never rejects.

## Transform decisions (encoded in the code + unit tests)

- **status** → a CLOSED `STATUS_MAP` of the 13 canonical legacy values to their
  snake_case destination value. Anything outside (including the historical
  `Terminado`, 0 rows in the dump) → `status_unmapped` — never a blind
  `lower(replace())`, never lets the destination CHECK explode as a raw SQL error.
- **booking_type** → derived (total function, never rejects): `monthly_mileage`
  not null → `monthly` (wins); else `total_insurance` true →
  `standard_with_insurance`; else `standard`.
- **monthly_mileage** → `1k_kms/2k_kms/3k_kms → 1000/2000/3000`, NULL→NULL.
- **numerics** → `ROUND(v, 2)` to `numeric(12,2)` with an overflow guard
  (> 9,999,999,999.99 → `numeric_overflow`, never truncated), applied to all
  money fields INCLUDING `total_price_to_pay`. `selected_days` / `coverage_days` /
  `extra_hours` range-guarded to smallint. `return_fee` NULL→0. A non-coercible
  value (impossible under the NOT-NULL numeric legacy schema) also rejects
  `numeric_overflow` rather than crashing, so the reconciliation invariant holds.
- **Reject taxonomy** (every reject carries a no-PII reason; one disposition per
  row): `customer_not_migrated`, `pickup_location_null`, `return_location_null`,
  `pickup_location_unmapped`, `return_location_unmapped`, `category_unmapped`,
  `franchise_unmapped`, `status_unmapped`, `numeric_overflow`,
  `monthly_mileage_unmapped`. The `*_unmapped` / `numeric_overflow` reasons are
  defensive — expected 0 on the real dump (the audit confirms all 17 category
  codes resolve, 3 franchises map 1:1, 0 `Terminado`, no price overflow).
- **Control chars + bad rows**: same posture as #19 — free text is stripped of
  NUL/control chars at extraction; a row that still raises inside a batch retries
  row-by-row (one bad row isolated as a reject, never rolling back up to 500 good
  rows); a poisoned transaction (`25P02`) propagates and aborts (exit 3).
- **Full accounting**: every scanned legacy row has exactly one disposition. The
  summary's `reconciliation` block proves `inserted + skipped + rejected ==
  legacy_rows_total` (12,967) at the row level. **Acceptance is this invariant +
  a logged reason per reject + 0 constraint violations — NOT a hardcoded
  inserted-count.** The expected inserted band (~12,150–12,271, after location
  NULLs and the ~121 placeholder-customer cascade rejects) is pinned by the
  dry-run (#22), not asserted here.

## Running

From the repo root with the venv active:

```bash
# Dry-run: read + compute + ROLLBACK. Writes NOTHING. Run this FIRST against a
# disposable Supabase branch (validate reconciliation + the reject taxonomy).
python scripts/migration/etl-reservations.py --dry-run
echo $?

# Commit: COMMITs only if the gate passes (0 unexpected rejects — only the
# taxonomy reasons — AND reconciliation closes AND every non-inserted record is
# an explained idempotent skip). Else the whole transaction ROLLS BACK (exit 7).
python scripts/migration/etl-reservations.py
echo $?
```

`--dry-run` is also enabled by `ETL_DRY_RUN=1`. `--help` prints the exit-code
table.

## Reports

- **Per-row JSONL** at `docs/migration-runs/etl-reservations-<UTC-timestamp>.jsonl`
  (atomic write, `/tmp` fallback). One object per logged event: `inserted` /
  `skipped` (`already_migrated`) / `rejected` (with the taxonomy reason). The
  per-row report keys on the legacy `_legacy_id`; it carries no identification /
  name / email. **Gitignored** (defensive, consistent with #19).
- **Aggregate summary** to stdout (JSON): counts, elapsed, mode, gate decision,
  the per-reason reject tallies, and the `reconciliation` block. No PII. Transcribe
  into `docs/data-ops/2026-05-XX-issue-20-etl-reservations/run-summary.md`.

## Idempotency

A re-run inserts 0: `ON CONFLICT (_legacy_id) DO NOTHING` plus the
`_legacy_migrated_at` marker. `_legacy_id` (the legacy `reservations.id`) is the
key — reservations has no natural unique column, so migration 050 adds it with a
UNIQUE index (nullable: dashboard-created rows keep `_legacy_id` NULL and Postgres
treats NULLs as distinct, so they never collide). Skips are classified
`already_migrated`; a `conflict_unknown` (ON CONFLICT fired yet the row is absent
on re-read) FAILS the gate and rolls back.

## Exit codes

Identical contract to #19 (0 ok / 2 connection / 3 query / 4 env / 5 report /
6 unexpected / 7 gate-failed). `--help` prints the table.

## Rollback

`docs/data-ops/2026-05-XX-issue-20-etl-reservations/rollback.sql` deletes ONLY
rows with `_legacy_migrated_at IS NOT NULL`; dashboard-created reservations
(marker NULL) are never touched. Two dependents have DIFFERENT delete semantics:
`commissions.reservation_id` is NO ACTION (financial records — an executable
`DO $$ ... RAISE EXCEPTION $$` guard ABORTS the whole rollback if any commission
references an ETL reservation, so they are never silently deleted), while
`notification_logs.reservation_id` is ON DELETE CASCADE (operational logs of a
rolled-back reservation are removed automatically). After sign-off, the paired
drop migration removes the marker + idempotency-key columns.

## db:types

`pnpm db:types` (`supabase gen types typescript --local`) regenerates the
gitignored, untracked `lib/types/database.ts` from the local stack — the
generated types are not committed and no tracked code imports them, so the
marker columns require no committed type change (same as #19's migration 048).
Run it locally when applying the migration if you use the typed client.

---

# Sizing: legacy log_veh (issue #45, Phase 1)

`size-log-veh.py` is a **read-only** script that dimensions the legacy
`log_veh_available_rates_queries` table **before** anyone commits to an extraction
method. It is the next concrete step of issue #45 (analytics extraction of the
legacy search history, **outside** the productive ETL — it writes nothing to
`public.search_logs` or anywhere else).

Why it exists: a prior `SELECT *` against this prod table crashed the server, and
the >3-month prune never ran, so the real volume is unknown. The script answers
"how big, how deep" **without** risking a blocking scan.

## Non-blocking by construction

Every table-touching query runs under a server-side
`SET SESSION max_statement_time=<budget>` (MariaDB, seconds) that the **server**
aborts if it overruns — not a client-side promise. The script first verifies the
budget took effect (`SELECT @@max_statement_time`); if it did not (e.g. the server
is not MariaDB ≥10.1), it runs ONLY the safe tiers and **skips** the scanning
tiers rather than run an unprotected `COUNT(*)`. The session is also
`SET SESSION TRANSACTION READ ONLY`; the source issues only `SELECT` and
`SET SESSION`.

Two more guards back the server-side kill-switch: a **client-side `read_timeout`**
(`max(2·budget, 30)s`) bounds any single statement even if the server does not
honor `max_statement_time`, and `--budget` is **clamped to [1, 300]s** in code
(MariaDB treats `max_statement_time = 0` as *unlimited*, so a 0/negative budget is
rejected, not silently disarming). The first time you run tier 2 against a given
server, confirm the PK span really is a seek:
`EXPLAIN SELECT id, created_at FROM \`log_veh_available_rates_queries\` ORDER BY id DESC LIMIT 1`
should show `key: PRIMARY`, `rows: 1`, `Backward index scan`.

Tiers, least-invasive first:

| Tier | Query | Cost |
|---|---|---|
| 1. metadata | `information_schema.TABLES` → approx rows + bytes | zero table access |
| 2. temporal span | first/last row by PK (`ORDER BY id ASC/DESC LIMIT 1`) | two PK seeks, O(1) |
| 3. exact count | `COUNT(*)` (time-boxed) | PK-index scan |
| 4. exact range | `MIN/MAX(created_at)` — opt-in `--exact-range`, time-boxed | full scan |

(`created_at` is unindexed in the legacy schema, so the exact range is a full
scan — that is why tier 2 uses the auto-increment PK as an O(1) span proxy and the
exact range is opt-in.)

## Setup — SSH tunnel through the legacy app server

Prod legacy MySQL is reachable only from the `rentacar` EC2 (the legacy
`rentacar-admin` app server). Bring up a tunnel, then point the script at its local
end:

```bash
# operator: forward a local port through the app server to the MySQL host
ssh -fN -L 3307:<mysql-host>:3306 rentacar
```

Use the same venv as the ETL (`pymysql` + `python-dotenv` are enough). In
`scripts/migration/.env` (gitignored) set:

```
LEGACY_DB_HOST=127.0.0.1
LEGACY_DB_PORT=3307          # the tunnel's local port; optional, defaults to 3306
LEGACY_DB_USER=<from the EC2 Laravel .env DB_USERNAME>
LEGACY_DB_PASSWORD=<from the EC2 Laravel .env DB_PASSWORD>
LEGACY_DB_NAME=<from the EC2 Laravel .env DB_DATABASE>
```

`SUPABASE_DB_URL` is **not** needed — this script never touches the destination.

## Running

```bash
cd scripts/migration
set -a && . ./.env && set +a
python size-log-veh.py                 # tiers 1-3 (metadata + PK span + exact count)
python size-log-veh.py --exact-range   # also tier 4 (exact MIN/MAX created_at)
python size-log-veh.py --budget 30     # raise the server-side time budget (default 15s)
echo $?
```

## Output

- **JSON report** (PII-free, committable) at
  `docs/migration-runs/size-log-veh-<UTC-stamp>.json` — atomic write, `/tmp`
  fallback. It holds ONLY metadata, counts, and timestamps; never
  `request_parameters` / `processed_data` / `source_ip` / any row payload.
- **stdout summary** table (approx rows, exact rows or timed-out/skipped, byte
  sizes, temporal span, kill-switch state).
- Transcribe the numbers into
  `docs/data-ops/2026-06-03-issue-45-size-log-veh/run-summary.md` and attach to #45;
  that evidence selects the Phase-2 extraction method.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Run completed (a scanning tier the server time-boxed, or skipped because the kill-switch was unconfirmed, is still `0` — it is a finding, not an error) |
| `2` | Legacy connection failure (host masked, no credentials echoed, no report) |
| `3` | A query failed for a reason **other** than the time budget (real SQL/schema error) |
| `4` | A required `LEGACY_DB_*` var missing or empty (no connection opened, no report) |
| `5` | Report not persisted to ANY path (canonical AND `/tmp`) |
| `6` | Unexpected/uncaught error (sanitized) |

## Scenarios

The holdout contract is
`docs/specs/2026-06-03-issue-45-size-log-veh/scenarios/size-log-veh.scenarios.md`
(SCEN-001 happy path, 002 env-missing, 003 connection-failure, 004 time-budget
abort, 005 read-only, 006 PII-free + atomic, 007 kill-switch-unconfirmed). Pure
functions are unit-tested in `test_size_log_veh.py` (bare Python, no driver).

---

# Extraction: legacy log_veh raw archive (issue #45, Phase 2)

`extract-log-veh.py` is an **autonomous, resumable** driver that produces a
faithful 1:1 raw archive of `log_veh_available_rates_queries` (~657,984 rows /
28.7 GiB, MariaDB 10.11.15) as gzipped per-PK-range `mysqldump` chunks plus a
PII-free manifest. It runs **read-only** on the source and **never writes** to
`public.search_logs` — it is decoupled from the productive ETL (#19–#24). Phase 1
(`size-log-veh.py`, above) confirmed the prune never ran, so the table is the full
multi-year history; the archive is the durable input for a later analysis phase.

## Autonomy — the driver owns its dependencies

No human input mid-run. The driver:

1. **Fetches its own credentials** via `ssh rentacar 'sudo -n cat /home/rentacar/.env'`,
   extracting ONLY the five `DB_*` keys and discarding the rest of the `.env` blob
   immediately (never logged, never returned whole — `parse_legacy_env`).
2. **Owns its SSH tunnel** (`_tunnel.py`): launches `ssh -N -L 127.0.0.1:3307:<DB_HOST>:3306`
   with keepalives + `ExitOnForwardFailure`, re-probes the raw MariaDB handshake
   before every chunk, and relaunches a silently-dead forwarder. On exit it tears
   down ONLY a forwarder it created (`created_by_us` + recorded PID) — a
   pre-existing operator tunnel is left running.
3. **Never hangs**: a per-chunk subprocess timeout (`--chunk-timeout`, SIGKILL on
   breach), a global `--run-deadline`, and a stall rule (`--stall-minutes`: no
   `current_id`/`bytes` advance → kill the in-flight chunk and retry under
   `--max-retries`).
4. **Freezes the PK bounds once** (`min_id`/`max_id_frozen`) and plans contiguous,
   non-overlapping id windows over them — never re-sampled, so the plan is stable
   across resumes. Rows arriving after the freeze (`id > max_id_frozen`) are
   reported as `rows_arrived_during_run`, **never** folded into `total_rows`.

## Credentials never on argv

The password reaches `mysqldump` ONLY via a `0600 --defaults-extra-file=<path>`
written inside the gitignored run dir — **never** as `-p<pass>` on argv (which
`ps` would expose). Verify during a live run:

```bash
ps -ef | grep mysqldump | grep -v grep   # MUST show no -p<...> token
```

## Non-blocking + faithful flags

Each chunk is dumped with:

```
mysqldump --defaults-extra-file=<0600 file> \
          --single-transaction --quick --no-tablespaces --skip-lock-tables \
          --hex-blob --skip-extended-insert \
          --default-character-set=<charset detected from SHOW CREATE TABLE> \
          --where="id BETWEEN <lo> AND <hi>" <db> log_veh_available_rates_queries \
  | gzip > chunk-NNNNN-<lo>-<hi>.sql.gz.partial
```

`--single-transaction --quick` = an MVCC snapshot streamed row-by-row (no LOCK
TABLES, no client/server buffering — the exact `SELECT *` failure mode that
crashed prod is avoided). `--skip-extended-insert` = exactly ONE `INSERT INTO`
statement per row, which makes the row count an unambiguous anchored line count
immune to a `),(` or a quoted `INSERT INTO` substring inside `response_raw`. The
charset is read at runtime (`--default-character-set=<actual>`, **no utf8mb4
assumption**) so `response_raw`/`json` payloads round-trip byte-for-byte.

### Read-only / no-lock grep (SCEN-005b)

The dump must emit no table-level lock. On a scratch instance with `general_log`
on, the captured statement stream MUST contain a consistent-snapshot start and
SELECTs but **no `LOCK TABLES`**:

```bash
# after restoring/replaying through a scratch MariaDB with general_log = ON:
grep -i 'LOCK TABLES' /var/lib/mysql/<host>.log   # MUST return nothing
grep -i 'START TRANSACTION WITH CONSISTENT SNAPSHOT' /var/lib/mysql/<host>.log  # present
```

## Resume + integrity

A chunk counts as **verified** ONLY by `(range present in manifest + sha256
recorded + gzip_ok + rows == range_count)` — the manifest is the SOLE source of
verified-ness. A re-invocation skips verified ranges and re-dumps the rest. If the
manifest is absent or corrupt, resume trusts NO chunk and cold-starts (every range
re-dumped via `.partial` + atomic rename). A 0-row chunk is verified ONLY when its
live `range_count == 0` too (an empty dump over a non-empty range is a
silently-failed dump, rejected — M9).

## Completeness verdict (no silent gaps)

`complete:true` requires ALL of: every planned range verified · the verified
ranges **partition** `[min_id, max_id_frozen]` exactly (no gap, no overlap) ·
`sum(chunk.rows) == reconciled_count == COUNT(*) WHERE id BETWEEN min_id AND
max_id_frozen` **exactly** (no tolerance band). Any shortfall → `complete:false`
and exit 6.

## Running

```bash
cd scripts/migration
# The driver fetches creds + brings up the tunnel itself — no .env / manual tunnel
# needed (unlike Phase 1). Run off-hours, detached, and watch the status file.
python extract-log-veh.py                      # defaults: 25k-row windows, 180-min deadline
python extract-log-veh.py --chunk-rows 25000 --run-deadline 180 --chunk-timeout 20 \
                          --stall-minutes 10 --max-retries 3 --local-port 3307
python extract-log-veh.py --allow-eventual     # proceed despite updated-after-insert rows
echo $?
```

A re-invocation against the SAME run dir resumes (skips verified chunks). `--help`
prints the exit-code table.

## Output

A single gitignored run dir (PII-bearing — `response_raw` + `source_ip`):

```
docs/migration-runs/log-veh-extract-<UTC-stamp>/
  chunk-00001-<lo>-<hi>.sql.gz   # one mysqldump SQL file per PK range
  ...
  manifest.json                  # PII-FREE metadata (counts, sha256, charset, verdict)
  status.json                    # PII-FREE progress (chunks done, bytes, current id)
  .defaults-extra.cnf            # 0600 temp creds — local-only, never committed
```

The whole dir is ignored by `/docs/migration-runs/log-veh-extract-*/` (NOT
inherited from the `*.json` rule, which only reaches files directly in
`docs/migration-runs/`). Verify:

```bash
git check-ignore -v docs/migration-runs/log-veh-extract-X/chunk-00001-1-2.sql.gz
git status --porcelain docs/migration-runs/log-veh-extract-*/   # MUST be empty of tracked files
```

The PII-free numbers (incl. `table_charset` and the `source_ip` storage type) are
transcribed into `docs/data-ops/2026-06-04-issue-45-phase2-extract-log-veh/run-summary.md`.
The operator moves the run dir to durable secure storage afterward (out of scope).

## Restore-to-scratch byte-fidelity recipe (SCEN-005a)

Prove a produced chunk restores 1:1 — by `SHA2` equality of the bulk columns
source-vs-restored, not mere row presence:

```bash
# 1. spin a scratch MariaDB (same major version) and create the empty table.
# 2. restore one sampled chunk into it:
zcat docs/migration-runs/log-veh-extract-X/chunk-00007-<lo>-<hi>.sql.gz \
  | mysql --defaults-extra-file=<scratch.cnf> scratch_db
# 3. pick ids in that chunk INCLUDING one with multibyte / 4-byte content, then
#    compare the bulk columns source (over the tunnel) vs restored:
#    SELECT id, SHA2(response_raw,256), SHA2(processed_data,256)
#      FROM log_veh_available_rates_queries WHERE id IN (...);
# The SHA2 hex strings MUST match for every sampled id. JSON columns are compared
# as bytes (no re-canonicalization).
```

## Exit codes

| Code | Meaning | Operator action |
|---|---|---|
| `0` | Complete — `complete:true`, all ranges verified, `total_rows == reconciled_count` | Move the run dir to durable storage; transcribe numbers |
| `2` | Connection / credential-fetch failure (ssh/sudo) before any dump | Fix SSH/sudo to `rentacar`; rerun |
| `3` | Tunnel unrecoverable after relaunches, OR a real query error (metadata / range COUNT) | Check tunnel + source; resume |
| `4` | Append-only precondition failed (`updated_at <> created_at` > 0) and no `--allow-eventual` | Investigate the updated rows; rerun with `--allow-eventual` to proceed (stamps `consistency:eventual`) |
| `5` | Global `RUN_DEADLINE` breached — tunnel torn down, verified chunks preserved, `complete:false`, no `.partial` | Re-invoke to resume |
| `6` | Completeness shortfall — ran to the end but `complete:false` (a range failed all retries / gap / overlap / `sum(rows) != reconciled`) | Investigate the manifest; do NOT blindly re-invoke |

## Scenarios

The holdout contract is
`docs/specs/2026-06-04-issue-45-phase2-extract-log-veh/scenarios/extract-log-veh.scenarios.md`.
The pure functions (range planning, manifest/resume, completeness verdict, the N1
row counter, the cred-file builder, host masking, status shaping, the append-only
gate, the `SHOW CREATE TABLE` parser, the handshake parser, and the watchdog loop
under an injected clock + fake chunk-runner) are unit-tested in
`test_extract_log_veh.py` (bare Python — NO pymysql / mysqldump / ssh). The
DB/subprocess surface (SCEN-001 happy path, 003 tunnel relaunch, 005a byte
fidelity, 005b no-lock) is validated by the real Step-10 run and documented in the
run-summary.
