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
runs; after checks run, **report-write failure (5) dominates** — if the
JSON could not be persisted to ANY path the operator has no durable
gating evidence, so 5 outranks both a query error (3) and a plain
gap (1). A successful `/tmp` fallback is NOT code 5 (report was written;
stderr carries a warning). Among the rest, a query error (3) dominates a
plain gap (1). Code 6 only fires for an otherwise-uncaught crash and is
sanitized so no connection string leaks.

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
