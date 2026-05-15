# Pre-flight check — red-green verification evidence (#16)

- **Script**: `scripts/migration/preflight-check.py` (commit `62957b5`)
- **Scenarios (holdout)**: `docs/specs/2026-05-12-issue-16-preflight-check/scenarios/preflight-check.scenarios.md` (commit `ba8b33b`, unmodified)
- **Executed**: 2026-05-15, first-hand by the orchestrator (not echoed from a sub-agent)
- **Legacy**: MariaDB local `rentacar_audit` — 3 franchises / 31 branches / 17 categories / 12967 reservations
- **Destination (green)**: Supabase prod `ilhdholjrnbycyvejsub` via Session pooler
- **Destination (red)**: disposable Supabase branch `preflight-scen002` (`jxxekbgfyndduqephywg`), seeded with prod-minus-`{G,GR,LP,VP}`, deleted after the run

## Strategy inversion (vs. original plan)

#17 is **already applied to prod** (`G/GR/LP/VP` exist for localiza with `status='inactive'`, created 2026-03-30 — MCP-verified). So prod is the **green** reference (SCEN-001), and the **red** state (SCEN-002) was synthesized on a disposable branch. The holdout scenarios are state-parameterized — only which environment satisfies each Given moved; no scenario text was changed and no amend was needed.

## Result: 6 / 6 scenarios satisfied

| Scenario | Command (essence) | Exit | Observable | Verdict |
|---|---|---|---|---|
| SCEN-001 green | script vs prod | `0` | stdout 4×PASS; JSON `passed:true`, all `gaps:[]` | ✓ |
| SCEN-002 red | script vs seeded branch | `1` | JSON `passed:false`; `categories.gaps=["G","GR","LP","VP"]`; other 3 `gaps:[]`, no errors | ✓ |
| SCEN-003 env | empty env / 4-of-5 vars | `4` | stderr `Missing or empty required environment variable(s): …`; no JSON; no connection | ✓ |
| SCEN-004 conn | legacy OK, dest URL invalid | `2` | stderr `destination connection failed for postgresql://***@…`; canary password absent; no JSON | ✓ |
| SCEN-005 idem | script run twice | `0`,`0` | distinct filenames; payloads byte-identical excluding `timestamp` | ✓ |
| SCEN-006 iso | one query → missing relation | `3` | broken `branches` `error` set + `passed:false`; other 3 execute with `error:null`; query-error dominates gap | ✓ |

## Per-scenario evidence

### SCEN-001 — happy path (prod, gaps resolved)
```
$ .venv/bin/python preflight-check.py        # SUPABASE_DB_URL -> prod
name                    legacy   dest  gaps  status
franchises                   3      3     0  PASS
branches                    31     32     0  PASS
categories                  17     18     0  PASS
identification_type          3      3     0  PASS
EXIT=0
```
Report `preflight-2026-05-15T21-37-00.427669Z.json`: `passed:true`; every check `passed:true gaps:[] error:null`.

### SCEN-002 — gap detection (red branch)
Branch seeded: 1 localiza rental_company, 31 locations (= legacy branch codes), 13 vehicle_categories (legacy 17 minus `{G,GR,LP,VP}`).
```
$ SUPABASE_DB_URL=<branch session-pooler> .venv/bin/python preflight-check.py
name                    legacy   dest  gaps  status
franchises                   3      3     0  PASS
branches                    31     31     0  PASS
categories                  17     13     4  FAIL
identification_type          3      3     0  PASS
EXIT=1
```
Report `preflight-2026-05-15T22-03-05.269427Z.json`: `passed:false`; `categories.gaps=["G","GR","LP","VP"]`, `passed:false`, `error:null`; `franchises/branches/identification_type` `gaps:[] error:null`.
Note: the branch pooler's first-connect window was unstable (cold start > the script's 10 s `connect_timeout`, surfacing as a correct exit 2 "destination connection failed"); once warm, the run produced the result above. The exit-2-on-cold-pooler behaviour is itself consistent with SCEN-004.

### SCEN-003 — missing env var
```
$ env -i PATH=$PATH LEGACY_DB_HOST=localhost LEGACY_DB_USER=preflight LEGACY_DB_PASSWORD=x LEGACY_DB_NAME=rentacar_audit .venv/bin/python preflight-check.py
Missing or empty required environment variable(s): SUPABASE_DB_URL
EXIT=4
$ env -i PATH=$PATH .venv/bin/python preflight-check.py
Missing or empty required environment variable(s): LEGACY_DB_HOST, LEGACY_DB_USER, LEGACY_DB_PASSWORD, LEGACY_DB_NAME, SUPABASE_DB_URL
EXIT=4
```
No JSON report created; no DB connection attempted (validate_env returns before connect). `.env` restored intact after the test.

### SCEN-004 — destination connection failure
```
$ SUPABASE_DB_URL='postgresql://postgres.ilhdholjrnbycyvejsub:SECRETLEAKCANARY999@nonexistent-host-xyz.invalid:5432/postgres' .venv/bin/python preflight-check.py
destination connection failed for postgresql://***@nonexistent-host-xyz.invalid:5432/postgres: OperationalError
EXIT=2
```
Asserted: phrase "destination connection failed" present; canary password `SECRETLEAKCANARY999` absent from output; URL masked `postgresql://***@`; no JSON written. Legacy was reachable → confirms legacy-first ordering, abort at destination.

### SCEN-005 — idempotency
Two consecutive prod runs → `preflight-2026-05-15T21-37-00.427669Z.json` and `preflight-2026-05-15T21-37-20.685092Z.json`. Filenames differ (microsecond timestamp, no collision). With `timestamp` excluded, `json.dumps(sort_keys=True)` of both payloads is byte-identical (same `passed`, same per-check `gaps`, same `legacy_source`/`destination_source`). Both exit 0.

### SCEN-006 — per-check query-failure isolation
A throwaway copy of the script with `branches.legacy_query` pointed at `branches_NO_SUCH_TABLE` (committed script untouched; copy deleted; git clean).
```
name                    legacy   dest  gaps  status
franchises                   3      3     0  PASS
branches                     0      0     0  ERROR
categories                  17     18     0  PASS
identification_type          3      3     0  PASS
EXIT=3
```
Report `preflight-2026-05-15T21-38-48.189342Z.json`: global `passed:false`; `branches.error = "legacy query failed for 'branches': (1146, \"Table 'rentacar_audit.branches_NO_SUCH_TABLE' doesn't exist\")"`, `passed:false`; `franchises/categories/identification_type` executed with real counts and `error:null` — the broken check neither aborted the run nor poisoned the destination connection. Query-error exit (3) dominated the plain-gap path (1).

## Reward-hacking check

`git diff` of the scenarios holdout vs commit `ba8b33b`: empty. No `.amends` markers. Scenarios were not modified to fit the implementation.

## Notes / follow-ups

- JSON reports under `docs/migration-runs/preflight-*.json` are git-ignored (may contain full legacy codes); this verification doc is the committed evidence.
- The disposable Supabase branch `preflight-scen002` was deleted immediately after SCEN-002 (cost contained to the run window).
- Operator prerequisite recorded: `sudo apt install python3-venv` on Debian/Ubuntu/WSL; Supabase access requires the **Session pooler** string (IPv4) — the Direct connection is IPv6-only and unreachable from WSL.
