# Implementation Plan — Issue #45 Phase 3: log_veh exploratory analysis

**Date:** 2026-06-09
**Spec (detailed design):** `docs/specs/2026-06-09-issue-45-phase3-analysis-log-veh-design.md` (commit b7705f0)
**Holdout (acceptance):** `docs/specs/2026-06-09-issue-45-phase3-analysis-log-veh/scenarios/analyze-log-veh.scenarios.md` (SCEN-001..006, commit 3a7a0c9)
**Branch:** `task/issue-45-phase3-analysis` · **Worktree:** `.worktrees/issue-45-phase3-analysis`

The requirements/research/design phases are already satisfied by the committed spec + scenarios
(produced via brainstorming). This plan covers the file-structure map and the ordered,
scenario-tied implementation steps.

---

## File Structure

All scripts tracked and PII-free. The throwaway datadir lives in `/tmp` (outside git).

| File | Responsibility | Git |
|---|---|---|
| `scripts/analysis/log-veh/provision-db.sh` | Preflight (server binaries + ≥60 GiB free on /tmp); `mariadb-install-db` into `/tmp/log-veh-analysis-db/`; start `mariadbd` **socket-only** (skip-networking). Emits socket + datadir paths. | tracked |
| `scripts/analysis/log-veh/load-archive.sh` | Restore the 27 chunks one-at-a-time in PK order under `set -o pipefail`, checking each exit code; then `COUNT(*)` must equal 664,126 or abort. **DDL footgun:** every chunk (not just chunk 1) carries `DROP TABLE IF EXISTS` + `CREATE TABLE`, so a naive sequential load would have each chunk wipe the prior. Load **chunk 1 in full** (creates the table + its rows) then **chunks 2–27 as INSERT-only** via `zcat … \| grep '^INSERT INTO' \| mariadb` (append, no DROP). `--skip-extended-insert` guarantees one `INSERT INTO` per row, so `grep` extracts exactly the data rows. Archive path is a parameter (Phase 2 worktree). | tracked |
| `scripts/analysis/log-veh/materialize.sql` | Build `search_flat` (one row/search; `pd_kind`, `rp_kind`, extracted scalars) + `cat_quotes` (`JSON_TABLE` explosion over `pd_kind='array'`). | tracked |
| `scripts/analysis/log-veh/analysis-queries.sql` | The 11 cuts, each with explicit denominator + deterministic `ORDER BY`. Never references `response_raw`; `source_ip` only as aggregate. | tracked |
| `scripts/analysis/log-veh/check-pii.sh` | SCEN-003 gate over the committed report + **all** committed `scripts/analysis/log-veh/*.sql` (both `materialize.sql` and `analysis-queries.sql`). Report: zero IPv4/email matches. SQL: `response_raw` must appear **nowhere** (it is never read), and bare `source_ip` may appear **only** inside an aggregate call — the gate flags any `source_ip` token not immediately within `COUNT(`/`DISTINCT`. Exit non-zero on any violation. | tracked |
| `scripts/analysis/log-veh/teardown.sh` | `mariadb-admin … shutdown` (no kill); `find … -delete` the datadir (no rm -rf). Idempotent. | tracked |
| `scripts/analysis/log-veh/run-analysis.sh` | Orchestrator: provision → load → materialize → run queries (capture aggregates to a `/tmp` results file) → teardown. Single entry point. | tracked |
| `scripts/analysis/log-veh/README.md` | How to run + reproduce; where the archive lives; PII discipline. | tracked |
| `docs/data-ops/2026-06-09-issue-45-phase3-analysis-log-veh/analysis-report.md` | The PII-free aggregate report, transcribed from the query results and passed through `/humanizer`. | tracked |

Boundaries: each shell script is one pipeline stage with a single responsibility, composable by
`run-analysis.sh`. The two `.sql` files separate *shaping* (`materialize`) from *reporting*
(`analysis-queries`) so the expensive `JSON_TABLE` explosion runs once and the cuts read cheap
materialized tables.

---

## Prerequisites

- Local MariaDB **server** binaries: `mariadbd`, `mariadb-install-db`, `mariadb-admin`, `mariadb`
  (verified present at design time).
- ≥60 GiB free on `/tmp` (verified ~930 GiB).
- Phase 2 archive readable at
  `.worktrees/issue-45-phase2-extract/docs/migration-runs/log-veh-extract-unattended/`
  (27 `chunk-*.sql.gz` + `manifest.json`).

---

## Implementation Steps

### Phase 1 — Foundation

**Step 1 — Provisioning + preflight** · Size: S · Deps: none
Build `provision-db.sh`: refuse to start unless the server binaries exist and `/tmp` has the disk
floor; then install + launch a throwaway `mariadbd` with a custom socket and **no TCP listener**.
*Scenario:* operator runs provisioning → a MariaDB server answers on the custom socket and nothing
listens on TCP; a missing binary or insufficient disk aborts before install.
*Acceptance:* `mariadb -S <socket> -e 'SELECT 1'` → `1`; `ss -ltn` shows no port for this instance;
forced-missing-binary path exits non-zero with a clear message. (Setup for SCEN-001; pair of SCEN-005.)

**Step 2 — Load + reconcile** · Size: M · Deps: Step 1
Build `load-archive.sh`: load chunk 1 in full (DROP+CREATE+rows), then chunks 2–27 INSERT-only
(`grep '^INSERT INTO'`) so each appends instead of dropping the table, all under `pipefail` with
per-chunk exit-code checks, aborting on the first non-zero chunk; then reconcile.
*Scenario:* all chunks load → `COUNT(*)` equals the manifest total; a truncated load → abort, no
analysis.
*Acceptance:* **SCEN-001** — `SELECT COUNT(*)` → `664126` matching `manifest.json:total_rows`; a
deliberately short load reconciles to a smaller count and halts the run. The abort path is exercised
in a **separate scratch datadir** (provision a second throwaway instance, load only the first chunk,
assert the reconcile gate aborts) so the negative test never disturbs the full-load instance.

### Phase 2 — Core

**Step 3 — Materialize `search_flat` + `cat_quotes`** · Size: M · Deps: Step 2
Write `materialize.sql`: classify every row into `pd_kind ∈ {array,error,malformed,null}` and
`rp_kind ∈ {valid,malformed,null}`, extract scalars into `search_flat` (exactly 664,126 rows), and
explode `processed_data` arrays into `cat_quotes` over the `pd_kind='array'` subset.
*Scenario:* materialization runs → every row is classified, none dropped; category rows exist only
for array-kind searches.
*Acceptance:* **SCEN-002** — `GROUP BY pd_kind` and `GROUP BY rp_kind` each sum to 664,126;
`COUNT(*) search_flat` = 664,126; `cat_quotes` rows all map to `pd_kind='array'` searches.

**Step 4 — Analysis queries (the 11 cuts)** · Size: M · Deps: Step 3
Write `analysis-queries.sql`: the 5 issue cuts + 6 extras, each with explicit denominator and
deterministic `ORDER BY` (stable tie-break). Never selects `response_raw`; `source_ip` only as
`COUNT(DISTINCT …)`.
*Scenario:* each cut runs → a populated result whose total matches its declared denominator; a second
run is byte-identical.
*Acceptance:* **SCEN-006** — every cut populates; all-rows cuts (#1/#4/#8/#10) sum to 664,126;
`rp_kind='valid'` cuts (#6/#7/#9) and `pd_kind='array'` cuts (#5/#11) sum to their counts. **SCEN-004**
— diff of two consecutive runs is empty.

### Phase 3 — Integration

**Step 5 — Orchestrator + PII gate + teardown** · Size: M · Deps: Steps 1–4
Wire `run-analysis.sh` (provision → load → materialize → queries → capture results → teardown) and
build `teardown.sh` + `check-pii.sh`.
*Scenario:* the full pipeline runs end to end → results captured to `/tmp`, server shut down, datadir
gone; the PII gate over the committed artifacts finds nothing.
*Acceptance:* **SCEN-005** — after teardown `test -d <datadir>` absent and no `mariadbd` on the
socket; **SCEN-003** — `check-pii.sh` over report + SQL → 0 IPv4/email matches, `response_raw` absent,
`source_ip` only in aggregates.

**Step 6 — Execute end-to-end + transcribe report** · Size: M · Deps: Step 5
Run the real pipeline over the 664,126-row archive; transcribe the PII-free aggregates into
`analysis-report.md`; pass the prose through `/humanizer`.
*Scenario:* the analyst runs the pipeline once over the full archive → a PII-free report carrying the
11 cuts + the data-quality (`pd_kind`/`rp_kind`) section, every figure reconciled to its denominator.
*Acceptance:* all of SCEN-001..006 satisfied with fresh execution evidence; `check-pii.sh` on the
committed report passes; report numbers reconcile to 664,126 where the cut spans all rows.

### Phase 4 — Polish

**Step 7 — README + quality gate + verification** · Size: S · Deps: Step 6
Write the README; run the 4-agent quality gate (code-reviewer + edge-case-detector +
performance-engineer + security-reviewer) over the scripts + SQL; run
`/verification-before-completion` before the final commit/PR.
*Scenario:* a reviewer picks up the folder cold → can reproduce the run from the README and trusts the
gate output.
*Acceptance:* quality gate findings addressed or justified; PR opened with `Refs #45`. The 4-agent
gate is static analysis over the committed scripts + SQL (no DB needed). Verification reuses Step 6's
captured `/tmp` results file + the committed report rather than re-provisioning — the full load +
`JSON_TABLE` explosion (~664k rows / ~3M category rows) is expensive and Step 6's teardown already
deleted the datadir; only re-run the pipeline if a script/SQL change after Step 6 invalidates the
captured evidence.

---

## Testing Strategy

- **Scenario-driven:** SCEN-001..006 are the acceptance contract. Each functional step above carries
  its scenario inline (no separate "add tests" steps).
- **Execution evidence:** the analysis is validated by running the real pipeline over the real
  664,126-row archive — not mocks. Reconciliation totals and the PII grep are the observable gates.
- **Determinism:** SCEN-004 re-run diff guards against nondeterministic queries.
- **Quality gate:** Step 7 runs the 4 review agents over the committed scripts + SQL.

## Rollout Plan

- **Deliverable:** committed scripts + SQL + PII-free report on `task/issue-45-phase3-analysis`; PR
  with `Refs #45` (issue stays open — the persistent-dataset destination is still deferred).
- **No production surface:** nothing deploys; no write to `public.search_logs`; the legacy source is
  not touched (archive is read-only input).
- **Rollback:** the work is additive (new scripts + one report); reverting the branch removes it
  cleanly. The throwaway `/tmp` datadir is deleted by teardown regardless.

## Open Questions (deferred, not blocking)

- Where the **persistent** analytical dataset eventually lives — explicitly deferred by the issue to
  "when the analytics module takes shape". This phase produces only the exploratory report.
