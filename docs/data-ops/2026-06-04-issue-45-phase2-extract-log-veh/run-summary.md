# Run summary — Issue #45 Phase 2: raw extraction of legacy `log_veh`

**Status:** SCAFFOLD — filled after the real Step-10 autonomous run.
**Driver:** `scripts/migration/extract-log-veh.py` + `scripts/migration/_tunnel.py`
**Scenarios:** `docs/specs/2026-06-04-issue-45-phase2-extract-log-veh/scenarios/extract-log-veh.scenarios.md`

This doc carries ONLY PII-free numbers transcribed from the gitignored
`manifest.json`. The chunk files (`response_raw` + `source_ip`) and the manifest
itself stay local under `docs/migration-runs/log-veh-extract-<stamp>/` and are
never committed.

---

## Run metadata (to fill from the manifest after Step 10)

| Field | Value |
|---|---|
| `generated_at` (UTC) | _pending_ |
| `source_version` | _pending_ |
| `table_charset` (detected) | _pending_ |
| `source_ip` storage type (M10) | _pending_ |
| `min_id` | _pending_ |
| `max_id_frozen` | _pending_ |
| `max_id_at_completion` | _pending_ |
| `rows_arrived_during_run` | _pending_ |
| `chunk_rows` | _pending_ |
| `consistency` | _pending_ (point-in-time / eventual) |
| `append_only_precondition.rows_updated_after_insert` | _pending_ |
| chunks produced | _pending_ |
| `total_rows` | _pending_ |
| `reconciled_count` | _pending_ |
| `complete` | _pending_ |
| exit code | _pending_ |

## Scenario evidence (Step 10)

- **SCEN-001 happy path** — exit 0, manifest `complete:true`,
  `total_rows == reconciled_count`: _pending_.
- **SCEN-003 tunnel relaunch** — any relaunch event from the run log: _pending_.
- **SCEN-005a byte fidelity** — `SHA2(response_raw)` / `SHA2(processed_data)`
  source-vs-restored equal on a sampled multibyte row: _pending_.
- **SCEN-005b no-lock** — captured statement stream contains no `LOCK TABLES`:
  _pending_.

## Notes

_pending_
