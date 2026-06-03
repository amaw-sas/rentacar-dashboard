# Design — Issue #45 Phase 1: size the legacy `log_veh` history

> **Issue:** [#45](https://github.com/amaw-sas/rentacar-dashboard/issues/45)
> **Scope:** Phase 1 ONLY — dimension the legacy table before choosing an extraction method. No extraction, no parsing, no analysis, no destination.
> **Date:** 2026-06-03
> **Status:** design

---

## 1. Problem

Issue #45 wants the full legacy search history (`log_veh_available_rates_queries`)
extracted and analyzed as an analytics dataset — explicitly **outside** the
productive ETL (#19–#24) and **never** written to `public.search_logs`.

But the issue is emphatic that the **next concrete step is sizing, not
extraction**. Two facts force this:

1. **A `SELECT *` against prod legacy already crashed the server once** (the audit
   could only capture a 501-row sample for that reason). Any process touching this
   table must be non-blocking by construction.
2. **The >3-month prune never ran** (confirmed 2026-05-21). The real volume is
   unknown — the operator estimates ~500k, the issue comments say possibly ≫500k
   multi-year. The extraction method (read replica, throttled `mysqldump`, paged
   export, off-hours window) cannot be chosen without real numbers.

This phase delivers those numbers safely.

## 2. Goal & non-goals

**Goal:** a read-only script that reports, without risk of blocking prod legacy:
approximate row count, on-disk byte size, and the temporal span (depth) of the
table — plus an exact row count *when it fits in a bounded time budget*.

**Non-goals (explicitly out of scope this phase):**
- No row extraction, no `request_parameters` / `processed_data` / `source_ip` reads.
- No JSON parsing, no distribution/error-rate analysis.
- No destination dataset, no schema, no load.
- No writes anywhere — not to legacy, not to Supabase.

## 3. Key constraint discovered during design

The three queries the issue proposed are **not uniformly cheap on this table**.
The legacy schema (`docs/audit-workspace/01-legacy-schema-snapshot.md`) shows
`log_veh_available_rates_queries` has only a PK index on `id`:

| Issue's proposed query | Real cost on this table |
|---|---|
| `SELECT COUNT(*)` | InnoDB **PK-index scan** — does NOT read the heavy `longText`/JSON columns, so far lighter than `SELECT *`, but still O(rows). |
| `information_schema` bytes | Metadata only — **instant, zero table access**. |
| `MIN/MAX(created_at)` | `created_at` is **unindexed** → **full table scan**. This is the dangerous one, not the COUNT. |

The design must therefore replace the naive temporal query and protect any
table-touching query with a server-side time budget.

## 4. Approach (A — tiered metadata-first + kill-switch)

Run queries from least to most invasive, all under a **server-side
`SET SESSION max_statement_time=15`** (MariaDB) that makes the *server* abort any
query that overruns. This is the hard non-blocking guarantee — not a client-side
promise. The session is also `SET SESSION TRANSACTION READ ONLY`.

| Tier | Query | Cost | Always run? |
|---|---|---|---|
| 1. Metadata | `information_schema.tables` → `TABLE_ROWS`, `DATA_LENGTH`, `INDEX_LENGTH`, `DATA_FREE`, `AVG_ROW_LENGTH`, `ENGINE` (filtered by `TABLE_SCHEMA` = `LEGACY_DB_NAME` AND `TABLE_NAME`) | Zero table access | Yes |
| 2. Temporal span (PK proxy) | `SELECT id, created_at … ORDER BY id ASC LIMIT 1` and `… ORDER BY id DESC LIMIT 1` | Two PK-index seeks, O(1) | Yes |
| 3. Exact count | `SELECT COUNT(*)` | PK-index scan, O(rows), under the 15s budget | Yes (protected) |
| 4. Exact range | `SELECT MIN(created_at), MAX(created_at)` | Full scan, under budget | Only with `--exact-range` (default OFF) |

**Tier 2 rationale:** the auto-increment `id` is monotonic with insert time
(the Laravel `Prunable` model only *deletes* old rows, never backdates), so the
first/last row by `id` carry the earliest/latest `created_at` via O(1) PK seeks —
the temporal depth (the issue's central open question) with zero scan. The PK
proxy is labelled as a proxy in the report; the exact `MIN/MAX` stays available
behind `--exact-range` for anyone who wants the verified bounds and accepts the
scan within the time budget.

**Tier 3 rationale (decision A, confirmed with operator):** attempt the exact
count under the budget. If the table is ~500k it returns instantly; if it is
multi-million and the scan would overrun, the server kills it and the script
records `{"value": null, "timed_out_after_s": 15}` — and that timeout is itself a
finding ("table too large for an exact count within budget; rely on the
`TABLE_ROWS` approximation"). The cheap tiers still complete and the run still
exits 0. A bounded heavy query that the server aborts is **not** a failure mode —
partial sizing is still useful.

### Rejected approaches

- **B — the three literal issue queries, unprotected.** Faithful to the issue text
  but runs `COUNT(*)` and `MIN/MAX(created_at)` (full scan, unindexed) with no
  budget — the exact scan class that already crashed prod. Rejected.
- **C — pure metadata, no table access at all.** Zero risk but yields no temporal
  depth and no exact count, under-delivering on the issue's core question (is there
  multi-year analytical depth?). Rejected.

## 4b. Execution precondition — SSH tunnel via the proxy machine

Prod legacy MySQL is **not directly reachable** from a workstation. The `rentacar`
EC2 host (`~/.ssh/config` → `ec2-54-71-220-67`) **is** the legacy `rentacar-admin`
Laravel app server, and that box has direct network access to the legacy MySQL
server. The historical extraction method (confirmed by operator, 2026-06-03) is an
**SSH tunnel through that machine**:

```bash
# forward a local port through the app server to the MySQL host it can reach
ssh -fN -L 3307:<mysql-host>:3306 rentacar
# then point the script at the local tunnel end:
#   LEGACY_DB_HOST=127.0.0.1
#   LEGACY_DB_PORT=3307
```

The legacy MySQL credentials (`<mysql-host>`, user, password, db name) live in the
**Laravel `.env` on the EC2** (`DB_HOST` / `DB_USERNAME` / `DB_PASSWORD` /
`DB_DATABASE`); they are copied into our local, gitignored `scripts/migration/.env`
as the `LEGACY_DB_*` values for the run. The operator owns the tunnel and the
secret handling; the script never sees a secret outside that gitignored `.env`.

Implications for this phase:

- The script must accept an **optional `LEGACY_DB_PORT`** (default `3306`) so the
  tunnel's local port works. `connect_legacy()` in `etl-customers.py` omits the
  port (pymysql defaults to 3306); the sizing script adds it. `LEGACY_DB_PORT` is
  **optional** — absent → 3306 — so it is NOT added to `REQUIRED_ENV` (the 4
  `LEGACY_DB_*` credential vars stay the required set; the run must not fail
  "env-missing" just because the default port is implicit).
- The tunnel is a manual operator step run **before** the script; bringing it up
  and tearing it down is documented in the Phase 1 runbook, not automated by the
  script. The `connect_timeout=10` already surfaces a dead/absent tunnel as a
  clean exit 2 (connection failure) rather than a hang.

## 5. Reuse — mirror `etl-customers.py`, do not reinvent

The script copies the proven scaffolding verbatim (rename only), so it inherits
already-reviewed security and robustness:

| Block | Source in `etl-customers.py` | Note |
|---|---|---|
| Exit-code contract (0/2/3/4/5/6) | `:46-53` | No commit/gate → no `7` |
| `validate_env()` | `:539-541` | `REQUIRED_ENV` = the **4 `LEGACY_DB_*` vars only** (no `SUPABASE_DB_URL` — destination is never touched) |
| `mask_db_url()` | `:496-536` | Security boundary — reused so connection errors never echo a credential |
| `connect_legacy()` (lazy `pymysql`, `connect_timeout=10`) | `:602-613` | Plus optional `LEGACY_DB_PORT` (default 3306, for the SSH tunnel), `max_statement_time`, and read-only session SETs right after connect |
| `_atomic_write` / `report_paths` / report writer | `:544-596` | Atomic JSON + `/tmp` fallback |
| Pure / lazy-driver split | whole file | `build_summary()` is a pure function so unit tests run on bare Python with no `pymysql` |

## 6. Outputs

- **Machine report (JSON, committable):**
  `docs/migration-runs/size-log-veh-<UTC-stamp>.json` — atomic write, `/tmp`
  fallback. Contains ONLY metadata + counts + timestamps; **no row payloads, no
  `request_parameters`, no `source_ip`** → **PII-free, so it is committed** as the
  sizing evidence (unlike the ETL JSONL reports, which carry PII and are gitignored).
- **Human summary to stdout:** a small table (approx rows, exact rows or
  timed-out, bytes data/index/total, temporal span first→last, elapsed per tier).
- **Run-summary (Spanish prose, /humanizer):**
  `docs/data-ops/2026-06-03-issue-45-size-log-veh/run-summary.md` — the numbers
  transcribed plus the method-selection implication for Phase 2.

## 7. Exit codes (mirror of the ETL contract)

| Code | Meaning |
|---|---|
| `0` | Run completed (all cheap tiers ran; a heavy tier that the server time-boxed is still `0`) |
| `2` | Legacy connection failure (host masked, no report) |
| `3` | A query failed for a reason **other** than the time budget (real SQL/schema error) |
| `4` | A required `LEGACY_DB_*` env var missing or empty (no connection opened, no report) |
| `5` | Report not persisted to ANY path (canonical AND `/tmp`) |
| `6` | Unexpected/uncaught error (sanitized) |

A statement-timeout abort on a protected tier is caught, recorded as a null
metric with `timed_out_after_s`, and does **not** raise the exit code — it is a
finding, not an error.

## 8. Observable scenarios (→ scenario-driven-development)

- **SCEN-001 — happy path.** Valid `LEGACY_DB_*` env, table reachable → exit 0;
  JSON report written; stdout summary shows approx rows, byte size, and the
  first→last temporal span; the report contains the metadata + count + span keys.
- **SCEN-002 — missing env.** A `LEGACY_DB_*` var missing or empty → exit 4, the
  missing name on stderr, **no connection opened**, no report written.
- **SCEN-003 — connection failure.** Unreachable host / bad creds → exit 2,
  the host masked in any message, no report.
- **SCEN-004 — non-blocking guarantee (key).** A protected heavy tier exceeds
  `max_statement_time` → the server aborts that query; the script records
  `{"value": null, "timed_out_after_s": 15}` for that metric, the cheap tiers
  still complete, and the run **exits 0** with the timeout flagged in the summary.
- **SCEN-005 — read-only.** The script issues only `SELECT` and `SET SESSION`
  statements and runs in a `TRANSACTION READ ONLY` session; it never writes to
  legacy. (Verifiable: no `INSERT`/`UPDATE`/`DELETE` in the source; session is
  read-only.)
- **SCEN-006 — report is PII-free and atomic.** The JSON report's keys are
  metadata/counts/timestamps only — no `request_parameters`, `processed_data`,
  `source_ip`, or any row payload — and it is written atomically (temp + rename).

## 9. Test strategy

- **Unit (Vitest is JS; these are Python — `pytest`-style, run on bare Python):**
  `build_summary()` is pure → test it maps a metrics dict to the summary shape,
  including the `timed_out` branch (SCEN-004) and the PII-free key set (SCEN-006).
  `validate_env()` returns the missing `LEGACY_DB_*` names (SCEN-002).
  `mask_db_url()` is already covered by the ETL suite; re-exercise the import.
- **Manual / integration:** the real prod-legacy run is the SCEN-001 evidence,
  captured in the run-summary; SCEN-003 is observable by pointing at an
  unreachable host; SCEN-004 is observable by setting `max_statement_time` very
  low (e.g. via a `--budget` override) against the real table.
- Driver-dependent paths (`connect_legacy`) use lazy imports so the pure tests
  need no `pymysql`.

## 10. Phase 2 hand-off (out of scope, noted)

The sizing numbers decide the extraction method: small (~500k, fits in budget) →
a single throttled paged read may suffice; multi-million / multi-GB → read
replica or off-hours `mysqldump --quick --single-transaction`. Phase 2 is a
separate session with its own spec; this phase only produces the evidence to
choose.
