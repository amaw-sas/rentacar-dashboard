# ETL run summary — legacy customers (issue #19)

No-PII aggregate evidence of an `etl-customers.py` run. Fill in after the run
from the script's stdout summary object (the per-row JSONL report stays
gitignored — it carries identification numbers). One block per run; keep the
dry-run AND the eventual commit run.

> The full discarded-identifications list and the cross-type ids live in the
> gitignored JSONL report ONLY (PII). The stdout summary is already PII-free —
> it carries only counts. Do NOT paste any identification number here; this
> file is committed.

---

## Run: <YYYY-MM-DDThh:mm:ssZ>

| Field | Value |
|---|---|
| Mode | `dry-run` / `commit` |
| Committed | `true` / `false` |
| Exit code | `0` / `7` (gate failed) / other |
| Destination (masked) | `postgresql://***@<host>:<port>/<db>` |
| Elapsed (s) | |
| Legacy rows total | |
| Dropped — no identification | |
| Timestamp fallbacks | |
| Placeholders discarded — unique ids | |
| Placeholders discarded — reservations | |
| Within expected range [50, 200]? | `true` / `false` |
| Computed unique non-placeholder | |
| Inserted | |
| Needs review (one-token names) | |
| Conflicts — by_name / by_email / by_phone | / / |
| Conflicts — cross_type | |
| Skipped — already_migrated | |
| Skipped — conflict_existing | |
| Rejected total (should be 0) | |
| Reconciliation reconciles? | `true` / `false` |

### Placeholder regex validation
- Audit expectation: ~90 unique ids / ~215 reservations.
- Observed: <unique_ids> / <reservations>.
- `within_expected_range`: <true/false>.
- Decision: <regex confirmed OK> / <re-tune PLACEHOLDER_PATTERNS — list the
  legitimate-looking ids that matched `^123\d{4,}$` and were wrongly discarded>.

### Gate outcome
- <commit committed N rows> / <dry-run rolled back, nothing written> /
  <gate failed: rolled back, reason>.

### Notes / anomalies
- <anything operator-relevant: rejected reasons, conflicts worth a human look>.
