# ETL customers — branch verification evidence (issue #19)

**Date:** 2026-05-25
**Branch:** `issue-19-etl-dry-run` (`douqvrnijqhgpjnhmbmq`), disposable, parent prod `ilhdholjrnbycyvejsub`.
**Legacy source:** MariaDB `rentacar_audit`, 12,967 reservations.
**Script:** `scripts/migration/etl-customers.py` (commit-mode against the branch session pooler).

All counts below are aggregates only — no PII. The per-row JSONL (with identifications) stays gitignored under `docs/migration-runs/*.jsonl`.

## Placeholder-rule correction (the key finding)

The first dry-run exposed that the provisional `^123\d{4,}$` placeholder regex was wrong: it discarded **~66 real 10-digit cédulas** starting with `123` (matched personal emails + birth-year correlation; several with 3-4 bookings). The count gate `[50,200]` passed anyway because it counts quantity, not content — the JSONL eyeball was the catch.

Replaced with a **closed-enumeration rule** (cannot over-match a real cédula):

- `^0+$` (all-zeros)
- keyboard ramps — prefixes of `1234567890`, length ≥ 6 (e.g. `123456`, `12345678`, `123456789`, `1234567890`)
- verified operator/test denylist `{12345677, 1234454, 1234558, 1234564, 1234566}` — all `dc005241@gmail.com` / "prueba" reservations.

The sequential ramps are fake ids shared across multiple distinct people → unusable as a per-customer key → correctly discarded: `123456` (2 people), `123456789` (6 distinct emails, incl. an operator address and a "prueba test" name), `1234567890` (the full ramp). Keeping any of them would merge several different people into one bogus customer under the dedup-by-identification key — the exact failure the rule must prevent. (Verified post-review against the legacy dump; the edge-case-detector's suggestion to cap the ramp at len ≤ 8 was rejected because it would re-admit `123456789`/`1234567890` and cause that merge.)

Result: **14 ids / 121 reservations discarded** (was 89/216 under the broken rule); **10,774 customers migrate** (66+ real customers recovered from wrongful discard). Range gate recalibrated `[50,200] → [1,30]` (SCEN-010).

## Run results

| Run | Mode | exit | inserted | gate |
|---|---|---|---|---|
| 1 | dry-run | 0 | 10,774 (rolled back) | within_range=true |
| 2 | commit | 0 | 10,774 | passed |
| 3 | commit (re-run) | 0 | 0 | passed (idempotent) |

Reconciliation invariant (SCEN-012): `inserted(12,846 reservations) + placeholder_reservations(121) + dropped_no_identification(0) = 12,967 = legacy_rows_total` → reconciles.

## Scenario evidence (SQL on branch, C0 = 1 seeded marker-NULL "dashboard" row)

| Scenario | Observable | Result |
|---|---|---|
| SCEN-001 happy path | total=10,775, marker NOT NULL=10,774, marker NULL=1 | PASS |
| SCEN-002 placeholder (corrected) | two real 123-prefix 10-digit cédulas present (1,1)[^pii]; junk `1234566`/`123456`/`^0+$` absent (0,0,0) | PASS |
| SCEN-003 one-token name | rows with `last_name='.'` = 2 (= report `needs_review`) | PASS |
| SCEN-005 idempotent re-run | run 3 inserted=0, `skipped.already_migrated`=10,774, counts unchanged | PASS |
| SCEN-006 cross-type UNIQUE | identification_numbers with >1 row = 0; `conflicts_resolved.cross_type`=17 | PASS |
| SCEN-007 rollback | `rollback.sql` deleted 10,774 marker rows; total → C0=1; dashboard seed survived | PASS |

SCEN-008 (env/connection contract), SCEN-009/011/012/013 (normalization, control-char sanitization, reconciliation, zero-date) are covered by the stdlib unit tests (`test_etl_customers.py`, all green — 88 after the issue #63 follow-ups, which add SCEN-014..017/019). SCEN-010 (range gate) is unit-tested; its scenario text amend (`[50,200]→[1,30]`) is human-applied per the amend protocol.

## Operational notes

- Branch DB password is independent of prod — reset in the dashboard; the connstring uses the Session pooler (IPv4) on port 5432.
- Pooler cold-start > 10s: the ETL's late destination connect (timeout 10s) can exit 2 on a cold pooler. Pre-warm with a `connect_timeout=30` connection immediately before the run.
- A hard ref-guard refuses to run unless the destination ref is the branch (`douqvrnijqhgpjnhmbmq`), never prod.

[^pii]: The two real cédula literals originally recorded here were redacted (issue #63, Ley 1581 hygiene). They were genuine 10-digit 123-prefix cédulas confirmed present in the prod result; the regression is now exercised by clearly-synthetic 123-prefix values in `test_etl_customers.py`.
