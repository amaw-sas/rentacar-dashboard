---
name: etl-reservations
created_by: claude-opus-4.7-via-brainstorming-skill
created_at: 2026-05-28T00:00:00Z
spec: docs/specs/2026-05-28-issue-20-etl-reservations-design.md
issue: 20
---

# Scenarios — Legacy reservations ETL

Holdout contract for issue #20. Write-once after first commit.

Target: `scripts/migration/etl-reservations.py` — single-file Python ETL that reads the legacy MariaDB `rentacar_audit.reservations` (12,967 rows) and inserts them 1:1 into Supabase `public.reservations`, rewriting every legacy BIGINT FK to its destination UUID/enum. Reads legacy via `pymysql`, writes destination via `psycopg2` (`autocommit=False`, transactional). Reuses scaffolding from `etl-customers.py` (#19): env validation, `mask_db_url`, atomic JSONL report, exit-code contract, late destination connect, SAVEPOINT-per-batch + row-by-row retry, commit gate, reconciliation block. The dedup engine of #19 is DROPPED — reservations are 1:1.

Two validation surfaces:
- **Pure transform / lookup functions** (status map, booking_type derivation, monthly_mileage map, numeric ROUND, FK resolution against in-memory maps) are deterministic and unit-tested in `scripts/migration/test_etl_reservations.py` (stdlib `unittest`, no DB) — encodes SCEN-003/004/005/006 at the unit level before implementation.
- **DB-interaction behavior** (insert / idempotency / rollback / connection contract) is validated by EXECUTION against a disposable Supabase branch with SQL evidence, documented in `docs/migration-runs/etl-reservations-verification-<date>.md` (mirrors the #16/#19 verification-evidence pattern).

Key invariants:
- Reservations are 1:1 — no dedup. One legacy row → one destination row (or one reject), never merged.
- Destination `reservations` has NO natural unique key. Idempotency comes from a NEW `_legacy_id bigint` column (= legacy `reservations.id`) with a UNIQUE index; insert uses `ON CONFLICT (_legacy_id) DO NOTHING`.
- Marker column `_legacy_migrated_at timestamptz` is set on every ETL-inserted row; dashboard-created rows keep it NULL.
- `customer_id` resolves by `normalize_identification(legacy.identification)` ALONE (single-column, same function as #19) against the destination `customers` table — NOT the audit's composite `(identification_type, identification)`.
- All NOT NULL destination FKs (`customer_id`, `rental_company_id`, `pickup_location_id`, `return_location_id`) must resolve or the row is REJECTED with a logged reason — never inserted with a guessed/NULL FK.
- Reconciliation invariant: `inserted + skipped + rejected == 12967`, every legacy row has exactly one disposition.
- Acceptance is the reconciliation invariant + a logged reason per reject + 0 constraint violations — NOT a hardcoded `≥12,212`.

Legacy → destination status map (closed enum, all 13 canonical values; `lower(replace(' ','_'))` happens to resolve them but the map is explicit and reject-outside): `Nueva→nueva`, `Pendiente→pendiente`, `Reservado→reservado`, `Sin disponibilidad→sin_disponibilidad`, `Utilizado→utilizado`, `No Contactado→no_contactado`, `Baneado→baneado`, `No recogido→no_recogido`, `Pendiente Pago→pendiente_pago`, `Pendiente Modificar→pendiente_modificar`, `Cancelado→cancelado`, `Indeterminado→indeterminado`, `Mensualidad→mensualidad`. `Terminado` (legacy initial value, 0 rows in dump) is intentionally NOT in the map → reject if it ever appears.

---

## SCEN-001: happy-path full extract + FK resolution + insert

**Given**: the legacy dump is loaded in MariaDB local (`rentacar_audit`, 12,967 reservations) AND a Supabase branch has migrations through the #20 marker applied (so `reservations._legacy_id` + `_legacy_migrated_at` exist) AND #19 customers + #17 categories are already migrated on that branch (so FK targets exist) AND `reservations` is at a known starting count `R0` (branch seed, all `_legacy_migrated_at IS NULL`).
**When**: the operator runs `python scripts/migration/etl-reservations.py` in commit mode against the branch (`SUPABASE_DB_URL` → branch session pooler).
**Then**: exit code = 0; the report reconciles (`inserted + skipped + rejected == 12967`); every newly inserted row has `_legacy_migrated_at IS NOT NULL` and a non-NULL `_legacy_id`; `SELECT count(*) FROM reservations WHERE _legacy_migrated_at IS NOT NULL` == report `inserted`; the count of rows with `_legacy_migrated_at IS NULL` is unchanged at `R0`; 0 constraint violations.
**Evidence**: `echo $?` → `0`; report JSON `inserted`/`skipped`/`rejected` summing to `12967`; SQL `SELECT count(*) FROM reservations WHERE _legacy_migrated_at IS NOT NULL` == `inserted`; SQL `SELECT count(*) FROM reservations WHERE _legacy_migrated_at IS NULL` == `R0`; SQL `SELECT count(*) FROM reservations WHERE _legacy_id IS NOT NULL AND _legacy_migrated_at IS NULL` == `0`.

---

## SCEN-002: reservation with placeholder customer cascade-rejects

**Given**: a legacy reservation whose `identification` is a placeholder discarded by #19 (e.g. `'0000000'` or a verified ramp/denylist id), so no matching row exists in destination `customers`.
**When**: the ETL runs.
**Then**: the reservation is NOT inserted; it is logged `action="rejected"`, `reason="customer_not_migrated"`; the report aggregate counts it; no row with a NULL or guessed `customer_id` is ever written (the NOT NULL FK is never bypassed).
**Evidence**: report `rejected` includes `customer_not_migrated` with count ≥ 1 (expected ≈121); SQL on branch `SELECT count(*) FROM reservations WHERE _legacy_id = <the placeholder reservation's legacy id>` == `0`; unit test `test_resolve_customer_missing` asserts that a normalized id absent from the in-memory customer map yields a `customer_not_migrated` reject (not an exception, not a NULL insert).

---

## SCEN-003: NULL pickup/return location rejects, never imputed

**Given**: a legacy reservation with `pickup_location IS NULL` (and/or `return_location IS NULL`), with an otherwise-valid customer and category.
**When**: the ETL transforms it.
**Then**: the row is rejected with `reason="pickup_location_null"` (and/or `return_location_null`); no location is imputed or defaulted; no row is inserted with a guessed location FK.
**Evidence**: unit test `test_resolve_location_null` asserts a NULL legacy location yields the corresponding `*_location_null` reject; report `rejected` includes the reason (expected ≤355 pickup / ≤341 return); SQL `SELECT count(*) FROM reservations WHERE _legacy_id = <a NULL-location legacy id>` == `0`.

---

## SCEN-004: status outside the closed map rejects (reject-never-guess)

**Given**: a legacy reservation whose `status` is not one of the 13 canonical values — specifically the historical `Terminado` (0 rows in the real dump, but the rule must hold defensively).
**When**: the ETL maps status.
**Then**: the row is rejected with `reason="status_unmapped"` listing the offending value; the destination CHECK constraint is NEVER reached as a raw SQL error; no status is guessed via blind `lower(replace())`.
**Evidence**: unit test `test_status_map` asserts the 13 canonical values map to their snake_case destination value AND `'Terminado'` (plus any unknown string) raises a `status_unmapped` reject — NOT a silent pass; the run reports 0 rows `rejected` with a SQL CHECK-violation reason (the python guard catches it first).

---

## SCEN-005: booking_type derivation is a total function

**Given**: three legacy reservations — (a) `monthly_mileage='2k_kms'`; (b) `monthly_mileage IS NULL AND total_insurance=true`; (c) `monthly_mileage IS NULL AND total_insurance=false`.
**When**: the ETL derives `booking_type`.
**Then**: (a) → `monthly`; (b) → `standard_with_insurance`; (c) → `standard`. Every legacy row produces exactly one valid `booking_type` — no row is ever rejected for booking_type (total function), and `monthly` takes precedence over the insurance branch.
**Evidence**: unit test `test_booking_type` asserts the three inputs map to `monthly` / `standard_with_insurance` / `standard` respectively, and that `monthly_mileage` non-NULL wins regardless of `total_insurance`; on the branch, `SELECT count(*) FROM reservations WHERE booking_type NOT IN ('standard','standard_with_insurance','monthly')` == `0`.

---

## SCEN-006: FK resolution maps every relation correctly; referral_raw always preserved

**Given**: a legacy reservation with a valid non-placeholder `identification`, a resolvable `pickup_location`/`return_location` (branch code present in `locations`), a `category` in the legacy set, a `franchise` id, and a `user` value that is (i) a known referral code, then a separate row where `user` is (ii) free text not matching any referral code.
**When**: the ETL resolves FKs.
**Then**: `customer_id`/`pickup_location_id`/`return_location_id` are the correct destination UUIDs; `rental_company_id` is Localiza's UUID; `category_code` is the validated text code; `franchise` is the correct enum value; for (i) `referral_id` is the matched UUID and `referral_raw` is the trimmed original; for (ii) `referral_id IS NULL` but `referral_raw` is the trimmed original string (preserved even though unresolved).
**Evidence**: unit tests `test_resolve_referral_match` / `test_resolve_referral_unmatched` assert (i) yields `(referral_id=<uuid>, referral_raw=<trimmed>)` and (ii) yields `(referral_id=None, referral_raw=<trimmed>)`; on the branch, SQL on a known-referral reservation returns a non-NULL `referral_id` with matching `referral_raw`, and a free-text-`user` reservation returns `referral_id IS NULL AND referral_raw IS NOT NULL`; `SELECT count(*) FROM reservations WHERE _legacy_migrated_at IS NOT NULL AND rental_company_id <> <localiza_uuid>` == `0`.

---

## SCEN-007: idempotent re-run inserts zero via ON CONFLICT (_legacy_id)

**Given**: a completed ETL run (branch) where N rows were inserted with `_legacy_id` set and the marker set.
**When**: the operator runs the ETL a second time, unchanged.
**Then**: exit code = 0; the second run's report `inserted` == `0`; no duplicate rows (`_legacy_id` UNIQUE holds, 0 constraint errors); no field on any existing row changes (no `updated_at` churn); skips are classified `reason="already_migrated"`.
**Evidence**: second-run report `inserted` == `0` and `skipped.already_migrated` == N; SQL `SELECT count(*) FROM reservations` identical before and after; SQL `SELECT count(*),count(distinct _legacy_id) FROM reservations WHERE _legacy_id IS NOT NULL` are equal (no dupes); `SELECT max(updated_at) FROM reservations WHERE _legacy_migrated_at IS NOT NULL` identical across the two runs.

---

## SCEN-008: rollback removes only ETL rows, never dashboard-created reservations

**Given**: a completed ETL run on the branch (N marked rows) AND a reservation created with `_legacy_migrated_at IS NULL` simulating a dashboard insert during the migration window.
**When**: the operator runs `docs/data-ops/2026-05-XX-issue-20-etl-reservations/rollback.sql`.
**Then**: all rows with `_legacy_migrated_at IS NOT NULL` are deleted; the count returns to `R0`; the specific marker-NULL reservation still exists; the FK guard aborts with a clear error if any marked reservation has dependent rows in `commissions`/`notification_logs` (rather than orphaning or cascade-deleting them).
**Evidence**: pre-rollback `SELECT count(*) FROM reservations` == `R0 + N`; rollback reports `N` rows deleted; post-rollback `SELECT count(*) FROM reservations` == `R0`; `SELECT count(*) FROM reservations WHERE _legacy_migrated_at IS NOT NULL` == `0`; `SELECT 1 FROM reservations WHERE id=<the marker-NULL id>` returns the row; a seeded dependent row triggers the guard's `RAISE EXCEPTION` (tested separately).

---

## SCEN-009: env / connection failure contract (inherited from #19/preflight)

**Given**: a required env var (`LEGACY_DB_HOST`/`USER`/`PASSWORD`/`NAME` or `SUPABASE_DB_URL`) is missing or empty; OR all env present but `SUPABASE_DB_URL` points at an unreachable host.
**When**: the operator runs the ETL.
**Then**: for missing env → exit code = 4, stderr names the missing var(s), no DB connection opened, no rows written; for unreachable destination → exit code = 2, stderr says the destination connection failed with the URL MASKED (`postgresql://***@host:port/db`, password absent), no partial commit. In both cases `SELECT count(*) FROM reservations WHERE _legacy_migrated_at IS NOT NULL` is unchanged.
**Evidence**: `echo $?` → `4` (missing env) / `2` (unreachable); captured stderr contains the var name / the phrase "destination connection failed"; the literal password substring is absent from all output; destination marker-row count unchanged before/after.

---

## SCEN-010: location code present but unmapped rejects (S2 assumption breach)

**Given**: a legacy reservation whose `pickup_location` (and/or `return_location`) is NOT NULL — it points at a legacy branch whose `branches.code` has NO matching `locations.code` in the destination (the failure mode of assumption S2).
**When**: the ETL resolves the location FK.
**Then**: the row is rejected with `reason="pickup_location_unmapped"` (and/or `return_location_unmapped`) — a reason DISTINCT from the NULL path (SCEN-003); no location is imputed; no row is inserted with a guessed FK. The distinct reason makes a broken `branches.code`↔`locations.code` mapping observable in the report rather than silently lost inside the NULL bucket.
**Evidence**: unit test `test_resolve_location_unmapped` builds an in-memory location map missing a given branch code and asserts a non-NULL legacy location yields `*_location_unmapped` (not `*_location_null`, not an insert); on the branch, if any such row exists the report `rejected` carries the `_unmapped` reason (expected 0 in real data — S2 holds per pre-flight #16, but the path is exercised by the unit test regardless).

---

## SCEN-011: defensive guards reject rather than guess or throw

**Given**: in-memory inputs that violate a closed-domain rule — (a) a legacy `category` whose code is absent from the destination `vehicle_categories.code` set; (b) a legacy `franchise` id whose name maps outside the enum `{alquilatucarro, alquilame, alquicarros}`; (c) a numeric field exceeding `numeric(12,2)` (> 9,999,999,999.99).
**When**: the ETL transforms each.
**Then**: (a) → reject `category_unmapped`; (b) → reject `franchise_unmapped`; (c) → reject `numeric_overflow`. In every case the python guard rejects the row with a logged reason BEFORE the INSERT — the destination CHECK / numeric-range constraint is never reached as a raw SQL error, and no value is silently coerced or truncated. All three are expected 0 in the real dump (audit: 17/17 category codes resolve, 3 franchises 1:1, no price overflow) — the scenarios exist to lock the reject-never-guess contract, not because the data triggers them.
**Evidence**: unit tests `test_resolve_category_unmapped`, `test_resolve_franchise_unmapped`, `test_numeric_overflow` each assert the offending input yields the corresponding reject reason (not an exception, not a pass); the full-run report shows 0 rows `rejected` with a SQL CHECK/numeric-overflow error reason (the python guards catch all of them first).

---

## Verification matrix

| Scenario | Surface | Verification approach | Required state |
|---|---|---|---|
| SCEN-001 | DB exec | Full ETL run against disposable branch, commit mode | Branch w/ #20 marker + #19 customers + #17 categories + reservations seed |
| SCEN-002 | unit + DB | `unittest` for missing-customer map + SQL on branch | Branch + legacy loaded |
| SCEN-003 | unit + DB | `unittest` for NULL location + SQL on branch | Branch + legacy loaded |
| SCEN-004 | unit | `unittest` for status map (reject Terminado/unknown) | none (pure) |
| SCEN-005 | unit + DB | `unittest` for booking_type + SQL aggregate | Branch + legacy loaded |
| SCEN-006 | unit + DB | `unittest` for FK/referral resolution + SQL row reads | Branch + legacy loaded |
| SCEN-007 | DB exec | Run twice, diff counts/report | Branch post SCEN-001 |
| SCEN-008 | DB exec | Run rollback.sql, assert counts + FK guard | Branch post SCEN-001 + a marker-NULL row + a dependent row |
| SCEN-009 | exec | Temp-unset env / temp-break URL, run, restore | `.env` editable |
| SCEN-010 | unit (+ DB if present) | `unittest` for unmapped-location path; report check on branch | none (pure) for unit |
| SCEN-011 | unit | `unittest` for category/franchise/overflow guards | none (pure) |

Unit-level scenarios (003/004/005/006/010/011) run with `python -m unittest` and require no database — they are the deterministic red-green gate authored before the ETL. DB-interaction scenarios (001/002/007/008/009) are validated by branch execution with SQL evidence and captured in the verification doc; the disposable branch is deleted after the run (cost contained), per the #16/#19 precedent. SCEN-010/011 cover defensive reject paths expected to fire 0 times on real data — their unit tests lock the reject-never-guess contract independent of whether the dump triggers them.
