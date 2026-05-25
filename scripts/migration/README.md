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
(`20260522000048_048_customers_legacy_migrated_marker.sql`) applied, so the
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
  glue to the following token (compound surname). Empty name → rejected.
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
  rolls back up to 500 good rows.
- **Full accounting**: every scanned legacy row has exactly one disposition.
  Blank/NULL-identification rows are counted in `dropped_no_identification`;
  zero-date / unparseable timestamps fall back to a synthetic value and are
  counted in `timestamp_fallback`. The summary's `reconciliation` block proves
  `legacy_rows_total == inserted + skipped + rejected + placeholder_reservations
  + dropped_no_identification` at the row level.

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
marker NULL, never overwritten).

## Exit codes

| Code | Meaning | Operator action |
|---|---|---|
| `0` | Run completed (dry-run, or commit that committed) | Review report/summary |
| `2` | Connection failure (legacy or destination, URL masked) | Fix host/creds |
| `3` | Query / insert failure (sanitized) | Check stderr exception type |
| `4` | A required env var is missing or empty | Fill `.env` (stderr lists which) |
| `5` | Report not persisted to ANY path (canonical AND `/tmp`) | Fix filesystem permissions; rerun |
| `6` | Unexpected/uncaught error (sanitized — never the body) | Read stderr exception type |
| `7` | Commit mode: gate FAILED (unexpected rejects, placeholder count outside `[1, 30]`, or unexplained insert mismatch) → whole transaction ROLLED BACK, nothing written | Read the stderr reason + stdout summary; fix the cause; rerun |

(Code `1` is reserved for the pre-flight's "gaps" and is not used by the ETL.)

## Rollback

`docs/data-ops/2026-05-22-issue-19-etl-customers/rollback.sql` deletes ONLY
rows with `_legacy_migrated_at IS NOT NULL` (the ETL-inserted ones);
dashboard-created customers (marker NULL) are never touched. It opens with an
executable FK guard (`DO $$ ... RAISE EXCEPTION ... $$`) that aborts the whole
transaction if any reservation references an ETL-inserted customer, so the
rollback can never partially run. After sign-off, migration **049**
(`20260522000049_049_drop_customers_legacy_migrated_marker.sql`) drops the
marker column.
