---
name: etl-customers-followups
created_by: claude-opus-4.7-via-sdd-skill
created_at: 2026-05-25T00:00:00Z
spec: issue #63 (pre-PR quality-gate follow-ups on the #19 customers ETL)
issue: 63
---

# Scenarios — Legacy customers ETL (issue #63 follow-ups)

Third holdout for the #19 ETL, extending `etl-customers.scenarios.md` (SCEN-001..008)
and `etl-customers-hardening.scenarios.md` (SCEN-009..013). These encode the
**latent** robustness findings surfaced by the pre-PR quality gate (code-reviewer
+ security-reviewer + edge-case-detector + performance-engineer), filed as issue
#63. They did NOT trigger in the verified prod run (`timestamp_fallback=0`, no
`conflict_unknown`, no duplicates) — they harden the code for any *future* re-run
of this ETL shape. New scenarios; they do NOT modify the prior holdouts.

Same target: `scripts/migration/etl-customers.py` + `test_etl_customers.py`, plus
the `supabase/migrations/` 048/049 filenames (#5) and PII-hygiene of the fixtures
(#6).

User decisions (2026-05-25): finding #4 → REJECT all-stopword names (no schema
change); migration 049 (drop marker) → NOT executed in this work (the marker stays
so `rollback.sql` remains usable).

---

## SCEN-014: fully-fallback timestamps persist as the run timestamp, never year 0001

**Given**: a deduped customer whose legacy reservations ALL carry an unparseable /
zero-date (`0000-00-00 00:00:00`) `created_at` AND `updated_at`, so every timestamp
routed to the synthetic fallback sentinel; AND a second customer whose group mixes
one real `2020-06-01` timestamp with one fallback row; AND a third whose only real
`created_at` (`2025-01-01`) and only real `updated_at` (`2020-01-01`) live on different
rows because the sentinel split the columns.
**When**: `dedup_records` runs with `run_started = 2026-05-25T12:00:00Z`.
**Then**: the all-fallback customer persists `created_at == updated_at == run_started`
(2026-05-25) — NOT `datetime.min` / year 0001 — so the operator never silently writes
a year-1 row (the SCEN-013 promise, now also true of the PERSISTED value, not just the
counter); the mixed customer persists `created_at == updated_at == 2020-06-01` (the real
timestamp wins because the sentinel is EXCLUDED from the reduction, never year 0001 and
never the run timestamp); the column-split customer persists `created_at == 2020-01-01`
and `updated_at == 2025-01-01` — i.e. `created_at <= updated_at` ALWAYS holds, because
both bounds are drawn from the same real-timestamp set across BOTH columns (a per-field
sentinel divergence can never produce `created_at > updated_at`); `timestamp_fallback`
still counts every row that fell back, for visibility.
**Evidence**: unit test — `dedup_records([all-sentinel group], run_started=R)` yields a
record with `created_at == updated_at == R`; `dedup_records([real-2020 + sentinel], run_started=R)`
yields `created_at == updated_at == 2020-06-01` (sentinel excluded); a column-split group
yields `created_at == 2020-01-01 <= updated_at == 2025-01-01` (invariant preserved);
`extract_legacy_rows` of a zero-date row still increments `timestamp_fallback`; no
persisted record ever equals `datetime.min`.

---

## SCEN-015: a `conflict_unknown` skip blocks the commit gate (not silently committed)

**Given**: commit mode (not `--dry-run`); after insert, a non-inserted record is
classified `conflict_unknown` by `classify_skips` (ON CONFLICT DO NOTHING fired, yet the
row is not found on re-read — a "shouldn't happen" anomaly), while other non-inserted
records are legitimately `already_migrated` / `conflict_existing`.
**When**: the gate decision runs.
**Then**: the gate FAILS — `conflict_unknown` is treated as UNEXPLAINED (only
`already_migrated`, `conflict_existing`, and `batch_error` count as explained); the whole
transaction is rolled back, exit code = 7, nothing written; the gate-fail reasons surface
the `conflict_unknown` count. A run whose only non-inserted records are `already_migrated`
/ `conflict_existing` still PASSES (the legitimate idempotent re-run of SCEN-005 is
unaffected).
**Evidence**: unit test — the explained-skip predicate returns `False` when any non-inserted
record maps to `conflict_unknown`, and `True` when every non-inserted record maps to
`already_migrated`/`conflict_existing`/`batch_error`; a run with a `conflict_unknown`
classification yields `gate_pass == False`, `committed == false`, exit 7; the stderr reason
string contains `conflict_unknown=<n>`.

---

## SCEN-016: a failed SAVEPOINT rollback aborts the run instead of masking the poison row

**Given**: during the per-batch / per-row insert, a batch raises and the recovery
`ROLLBACK TO SAVEPOINT` statement ITSELF raises (the transaction is poisoned, SQLSTATE
`25P02`).
**When**: `insert_records` processes the batch.
**Then**: the failure PROPAGATES (re-raised) so `run()` rolls back the whole transaction
and returns exit 3 (`EXIT_QUERY_ERROR`) — the code does NOT swallow the rollback failure
and continue, which would record a spurious `25P02` reject on every subsequent row and mask
the real poison row. The happy fallback (a single bad row isolated as one `rejected` while
the rest of the batch inserts, SCEN-011) is UNCHANGED.
**Evidence**: unit test — a fake cursor whose `ROLLBACK TO SAVEPOINT` raises makes
`insert_records` raise (it does not return a list of spurious per-row rejects); the existing
SCEN-011 row-by-row test (rollback succeeds → exactly one reject, rest inserted) stays green.

---

## SCEN-017: an all-stopword fullname is rejected, never inserted with a stopword-only name

**Given**: a legacy `fullname` consisting ONLY of stopwords — e.g. `"de la"`, `"DE LA"`,
`"los"` — with an otherwise valid (non-placeholder identification, mapped type, present
email) row.
**When**: the ETL transforms the row.
**Then**: `split_fullname` raises `ValueError` → `transform_row` returns
`RejectedRow(reason="invalid_first_name")`; NO customer is inserted with `first_name="de la"`
and `last_name="."`; the discard is logged in the JSONL as `rejected`. The single-REAL-token
case is UNCHANGED: `"MARIA"` → `("MARIA", ".", needs_review=True)` and IS inserted (SCEN-003);
a real name with a trailing stopword (`"JUAN de"`) still yields a real `first_name="JUAN"`.
**Evidence**: unit test — `split_fullname("de la")` raises `ValueError`; `split_fullname("DE LA")`
raises (case-insensitive); `split_fullname("los")` raises; `transform_row` of an all-stopword
name returns `RejectedRow` with `reason == "invalid_first_name"`; `split_fullname("MARIA") ==
("MARIA", ".", True)` still holds; `split_fullname("JUAN de")` yields `first_name == "JUAN"`.

---

## SCEN-018: the 048 migration filename reconciles with the remote schema_migrations version

**Given**: migration 048 (`add column _legacy_migrated_at`) was applied to prod via MCP
`apply_migration`, which recorded `version = 20260525201336` (name
`customers_legacy_migrated_marker`) in `supabase_migrations.schema_migrations`; the committed
file was `20260522000048_048_customers_legacy_migrated_marker.sql` (a synthetic prefix that is
NOT in `schema_migrations`).
**When**: a maintainer inspects `supabase/migrations/` or runs `supabase db push`.
**Then**: the 048 file is named `20260525201336_048_customers_legacy_migrated_marker.sql` — its
version prefix string-equals the remote-recorded version, so a `db push` treats it as already
applied and does NOT re-run it; the deferred 049 (drop marker) file is renamed to sort STRICTLY
AFTER 048 (`20260525201337_049_drop_customers_legacy_migrated_marker.sql`) so push ordering can
never place the drop before the add.
**Evidence**: `ls supabase/migrations/` lists `20260525201336_048_customers_legacy_migrated_marker.sql`
and `20260525201337_049_drop_customers_legacy_migrated_marker.sql`; the 048 version prefix equals
`select version from supabase_migrations.schema_migrations where name='customers_legacy_migrated_marker'`
(= `20260525201336`); 049's version prefix > 048's version prefix.

---

## SCEN-019: regression fixtures exercise the rule with synthetic, not real, cédulas

**Given**: `test_etl_customers.py` and the verification doc previously embedded two REAL
10-digit 123-prefix cédulas (the literal digits are deliberately NOT reproduced here — that
would re-introduce the PII this scenario removes) as regression guards proving the closed rule
keeps real 123-prefixed cédulas (Ley 1581 hygiene).
**When**: a maintainer greps the repo for those two original literals.
**Then**: neither literal appears in `test_etl_customers.py` nor in
`docs/migration-runs/etl-customers-verification-2026-05-25.md`; the same regression is exercised
by clearly-synthetic 123-prefix 10-digit values (e.g. `1239999999`, `1238888888`) that the OLD
over-matching `^123\d{4,}$` rule WOULD have discarded but the closed zeros+ramps+denylist rule
KEEPS, so the regression intent is preserved without persisting real PII.
**Evidence**: grepping `scripts/` and the verification doc for the two original real-cédula
literals returns no matches (they survive nowhere in test code or run evidence); unit test asserts
`is_placeholder("1239999999") is False` and `is_placeholder("1238888888") is False`; the synthetic
values match `^123\d{4,}$` (so they genuinely exercise the over-match regression) yet are not
assigned cédulas.

---

## Verification matrix

| Scenario | Surface | Verification |
|---|---|---|
| SCEN-014 | unit | `unittest` on `dedup_records` (sentinel exclusion + run_started fallback) + extract counter |
| SCEN-015 | unit | `unittest` on the explained-skip predicate; gate `gate_pass == False` on `conflict_unknown` |
| SCEN-016 | unit | `unittest` with a fake cursor whose savepoint rollback raises → `insert_records` raises |
| SCEN-017 | unit | `unittest` on `split_fullname` / `transform_row` for all-stopword input |
| SCEN-018 | file + SQL | `ls` filenames + read-only `schema_migrations.version` equality |
| SCEN-019 | file + unit | `grep` returns no real cédulas + `is_placeholder` False on synthetic 123-cédulas |

Unit-level coverage is the deterministic gate authored before the fixes. SCEN-018/019 are
file-state / hygiene assertions verified by directory listing, a read-only `schema_migrations`
query, and `grep` — no destination mutation (049 is deferred per the user decision).
