#!/usr/bin/env python3
"""Legacy reservations ETL: MariaDB rentacar_audit.reservations -> Supabase reservations.

Reads the legacy MariaDB audit DB (read-only, 12,967 reservations), rewrites
every legacy BIGINT FK to its destination UUID/enum, transforms each row to the
destination shape, and inserts them 1:1 into Supabase public.reservations with
ON CONFLICT (_legacy_id) DO NOTHING (idempotency key added by migration 050).

Unlike the sibling customers ETL (#19), reservations are 1:1 — there is NO
dedup. One legacy row becomes one destination row, or one logged reject; rows
are never merged. The core new work (#20) is FK RESOLUTION: four in-memory maps
built from the DESTINATION before insert (customer / pickup_location /
return_location / category_code) plus constants (rental_company, franchise,
referral). All NOT NULL destination FKs must resolve or the row is REJECTED with
a logged reason — never inserted with a guessed or NULL FK.

Two modes:
  --dry-run   read everything, compute everything, ROLLBACK at the end. Writes
              nothing to the destination. Run this against a disposable branch
              FIRST to validate the reconciliation + reject taxonomy.
  (commit)    COMMIT only if the gate passes (0 unexpected rejects — only the
              taxonomy reasons — AND the reconciliation invariant
              inserted + skipped + rejected == legacy_rows_total closes);
              otherwise ROLLBACK the whole transaction. The decision is printed.

Idempotent: a re-run inserts 0 (ON CONFLICT (_legacy_id) DO NOTHING + the
_legacy_migrated_at marker). The marker (migration 050) also scopes the rollback
to ETL rows only.

The pure transform functions and their unit tests import and run on bare Python
with NO pymysql / psycopg2 installed: the DB drivers are imported LAZILY inside
connect_legacy() / connect_destination_tx() only. Do not move them up.

Issue #20. Scaffolding reused VERBATIM from scripts/migration/etl-customers.py
(#19): env validation, masked URL, atomic report writes, exit-code discipline,
late destination connect, SAVEPOINT-per-batch insert engine, commit gate,
reconciliation block. The #19 dedup engine is DROPPED (reservations are 1:1).

STATUS — SKELETON (step 2 of 10). The reusable scaffolding + env/connection
contract are complete and exercisable (SCEN-009). The #20-specific pipeline
(extract / FK-map build / FK resolution / transform / insert wiring / commit
gate) is left as NotImplementedError stubs reachable ONLY after a successful
destination connection (steps 3-8). See the run() docstring.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

# --------------------------------------------------------------------------- #
# Exit-code contract (consistent with etl-customers.py / preflight; see README).
# --------------------------------------------------------------------------- #
EXIT_OK = 0
# 1 reserved (preflight uses it for "gaps"); not used here.
EXIT_CONNECTION = 2
EXIT_QUERY_ERROR = 3
EXIT_ENV_MISSING = 4
EXIT_REPORT_FAILED = 5
EXIT_UNEXPECTED = 6
EXIT_GATE_FAILED = 7  # commit mode: gate failed => whole tx ROLLED BACK, nothing written.

REQUIRED_ENV = [
    "LEGACY_DB_HOST",
    "LEGACY_DB_USER",
    "LEGACY_DB_PASSWORD",
    "LEGACY_DB_NAME",
    "SUPABASE_DB_URL",
]

# --------------------------------------------------------------------------- #
# Transform constants.
# --------------------------------------------------------------------------- #

# Characters stripped from identifications (Decision B, reused from #19). ONLY
# formatting punctuation — spaces, dots, dashes — so alphanumeric content is
# preserved (passport "AB-12345" -> "AB12345"). The customer-FK lookup key
# (step 6) MUST normalize the legacy identification with the SAME function #19
# used as its dedup key / persisted identification_number, or the join misses.
_ID_PUNCT_RE = re.compile(r"[ .\-]")

# Control characters MariaDB text can hold but Postgres text cannot accept (NUL
# especially). Stripped during extraction from free-text fields so a row inserts
# cleanly instead of raising at the DB. C0 controls (ord < 32) plus DEL (0x7f).
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")

# Synthetic timestamp sentinel for a zero-date / NULL / unparseable legacy
# timestamp. `_as_aware` returns it (and increments a fallback counter) so the
# fallback is COUNTED. datetime.min (year 1) — a value no real legacy row can
# carry — used as a MARKER that never persists; a fully-fallback row coalesces
# to the run-start stamp at transform time (step 5).
FALLBACK_SENTINEL = datetime.min.replace(tzinfo=timezone.utc)

# P3 legacy identification_type -> destination CHECK domain. Reused verbatim
# from #19; kept here because the reservations row carries identification_type
# too (step 5 may surface it for the customer-not-migrated diagnostics). A value
# outside these three is not guessed.
IDENTIFICATION_TYPE_MAP: dict[str, str] = {
    "Cedula Ciudadania": "CC",
    "Cedula Extranjeria": "CE",
    "Pasaporte": "PP",
}

INSERT_BATCH_SIZE = 500


# --------------------------------------------------------------------------- #
# Data structures.
#
# NOTE: the full LegacyRow / ReservationRecord field sets are #20-specific and
# land in steps 3-5 (the design's field map, docs/audit-workspace/03-mapping.md
# §D2). Here they carry only the fields the SKELETON needs so the module
# imports, the dataclasses resolve, and the insert engine type-checks. The
# row-processing pipeline that would populate them is stubbed in run().
# --------------------------------------------------------------------------- #
@dataclass
class LegacyRow:
    """One legacy reservations row (already string-coerced / sanitized).

    SKELETON shape — only `row_id` (the legacy PK = the _legacy_id idempotency
    key) is fixed here. The full legacy column set (fullname/identification/
    status/locations/category/franchise/user/prices/dates/flags) is added in
    steps 3-5 when extract + transform are implemented.
    """

    row_id: int


@dataclass
class ReservationRecord:
    """A transformed reservation ready for insert (1:1 — no group collapse).

    SKELETON shape — only `legacy_id` is fixed (it becomes _legacy_id on
    insert). The full destination column set (customer_id/pickup_location_id/
    return_location_id/rental_company_id/category_code/franchise/status/
    booking_type/prices/dates/referral_id/referral_raw/flags) lands in steps
    5-8. The insert engine below references `legacy_id` only, so it compiles now
    and the tuple builder is completed alongside the transform.
    """

    legacy_id: int


@dataclass
class RejectedRow:
    """A row rejected by transform / FK resolution — never reaches the DB.

    1:1 (no group_size — reservations are not deduped): one rejected legacy row
    counts as exactly one reject for the reconciliation invariant.
    """

    legacy_id: int
    reason: str


@dataclass
class ExtractResult:
    """Output of extract_legacy_rows: usable rows + full accounting.

    Every scanned legacy row has exactly one disposition for the reconciliation
    invariant (inserted + skipped + rejected == legacy_rows_total).
    `legacy_rows_total` is the raw count scanned; `timestamp_fallback` counts
    rows whose created_at OR updated_at could not be parsed and fell back.
    SKELETON: populated by extract_legacy_rows in step 3.
    """

    rows: list[LegacyRow] = field(default_factory=list)
    legacy_rows_total: int = 0
    timestamp_fallback: int = 0


# --------------------------------------------------------------------------- #
# Pure transforms (NO DB drivers; unit-tested on bare Python).
# --------------------------------------------------------------------------- #
def normalize_identification(identification: str) -> str:
    """Normalize an identification (Decision B): strip formatting punctuation.

    Removes spaces, dots ('.'), and dashes ('-') ONLY — never alphanumerics.
    So '12.345.678' / '12 345 678' / '12345678' all collapse to '12345678',
    while a passport 'AB-12345' becomes 'AB12345' (letters preserved). Leading/
    trailing whitespace is also stripped.

    REUSED VERBATIM from etl-customers.py (#19). Step 6 uses it as the
    customer-FK lookup key — it MUST be byte-identical to the function #19 used
    as its dedup key / persisted identification_number, or the customer join
    silently misses and every reservation cascade-rejects. Do not change it.
    """
    return _ID_PUNCT_RE.sub("", (identification or "").strip())


# --------------------------------------------------------------------------- #
# Shared helpers (mask_db_url, validate_env, atomic write) — same contract as
# etl-customers.py / preflight-check.py. Replicated here (not imported) because
# the source modules have hyphenated filenames which are not legal Python module
# names to `import`. mask_db_url is copied EXACTLY — it is a security boundary.
# --------------------------------------------------------------------------- #
def mask_db_url(url: str) -> str:
    """Return a masked DB URL that NEVER echoes any password byte.

    SECURITY BOUNDARY. The last '@' in the post-scheme string is always the
    userinfo terminator (host/path never contain '@', a password may), so
    keeping only the substring AFTER it drops every password byte. Any
    malformed input falls back to fully-redacted. Copied EXACTLY from
    etl-customers.py / preflight-check.py.
    """
    fully_redacted = "postgresql://***@***/***"
    try:
        scheme_split = url.split("://", 1)
        if len(scheme_split) != 2:
            return fully_redacted
        scheme, rest = scheme_split
        scheme = scheme or "postgresql"

        if "@" in rest:
            host_and_path = rest.rsplit("@", 1)[1]
        else:
            host_and_path = rest
        if "@" in host_and_path:
            return fully_redacted

        delim_idx = len(host_and_path)
        for ch in ("/", "?", "#"):
            i = host_and_path.find(ch)
            if i != -1:
                delim_idx = min(delim_idx, i)
        hostport = host_and_path[:delim_idx]
        tail = host_and_path[delim_idx:]

        db = ""
        if tail.startswith("/"):
            db = tail[1:].split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]

        candidate = f"{scheme}://***@{hostport or '?'}/{db or '?'}"
        if urlparse(candidate).password is not None:
            return fully_redacted
        return candidate
    except Exception:
        return fully_redacted


def validate_env() -> list[str]:
    """Return required env vars that are missing OR present-but-empty."""
    return [v for v in REQUIRED_ENV if not os.environ.get(v)]


def _atomic_write(target: Path, payload: str) -> None:
    """Write payload to target atomically (temp file in same dir + os.replace)."""
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(target.parent), prefix=target.name + ".", suffix=".tmp"
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_path, target)
    except BaseException:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def report_paths(filename_stamp: str) -> tuple[Path, Path]:
    """Return (primary, fallback) JSONL report paths for a filesystem-safe stamp."""
    repo_root = Path(__file__).resolve().parents[2]
    primary = (
        repo_root
        / "docs"
        / "migration-runs"
        / f"etl-reservations-{filename_stamp}.jsonl"
    )
    fallback = Path("/tmp") / f"etl-reservations-{filename_stamp}.jsonl"
    return primary, fallback


def write_jsonl_report(lines: list[dict], filename_stamp: str) -> Path | None:
    """Write the per-row JSONL report atomically; fall back to /tmp.

    Returns the path written to, or None if both paths failed.
    """
    primary, fallback = report_paths(filename_stamp)
    payload = "\n".join(json.dumps(line, ensure_ascii=False) for line in lines)
    if payload:
        payload += "\n"

    for target, label in ((primary, "Report"), (fallback, "Report (fallback)")):
        try:
            _atomic_write(target, payload)
            print(f"{label} written: {target}")
            return target
        except OSError as exc:
            print(
                f"WARNING: could not write report to {target} ({exc})",
                file=sys.stderr,
            )
    print("ERROR: could not write JSONL report to ANY path", file=sys.stderr)
    return None


# --------------------------------------------------------------------------- #
# DB connections — LAZY driver imports (module must import on bare Python).
# --------------------------------------------------------------------------- #
def connect_legacy():
    """Open the legacy MariaDB connection (read-only use). Imports pymysql lazily."""
    import pymysql  # lazy: keep module importable without the driver.

    return pymysql.connect(
        host=os.environ["LEGACY_DB_HOST"],
        user=os.environ["LEGACY_DB_USER"],
        password=os.environ["LEGACY_DB_PASSWORD"],
        database=os.environ["LEGACY_DB_NAME"],
        cursorclass=pymysql.cursors.Cursor,
        connect_timeout=10,
    )


def connect_destination_tx():
    """Open the destination Postgres connection in TRANSACTIONAL mode.

    autocommit=False: the whole ETL is one transaction. TCP keepalives keep the
    session alive against a Supabase pooler idle-reap during the (short) window
    between connecting and inserting; the connect itself is also deferred until
    just before insert (see run()). Imports psycopg2 lazily.
    """
    import psycopg2  # lazy: keep module importable without the driver.

    conn = psycopg2.connect(
        os.environ["SUPABASE_DB_URL"],
        connect_timeout=10,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=3,
    )
    conn.autocommit = False
    return conn


def _close(conn) -> None:
    """Best-effort close; never raises."""
    if conn is None:
        return
    try:
        conn.close()
    except Exception:
        pass


# --------------------------------------------------------------------------- #
# Extract / transform helpers (pure where possible).
# --------------------------------------------------------------------------- #
def _sanitize_text(value) -> str:
    """Coerce a driver value to str and strip control chars.

    NULL -> ''. Removes C0 controls (incl. NUL) and DEL so the text inserts
    cleanly into Postgres. Surrounding whitespace is left to downstream
    trim/collapse. REUSED from #19.
    """
    if value is None:
        return ""
    return _CONTROL_CHARS_RE.sub("", str(value))


def _as_aware(value, fallback: datetime) -> tuple[datetime, bool]:
    """Coerce a driver timestamp to (aware_datetime, fell_back).

    * datetime -> used as-is (UTC-assumed if naive); fell_back=False.
    * string  -> parsed via datetime.fromisoformat (handles 'YYYY-MM-DD
      HH:MM:SS' and ISO forms); a MariaDB zero-date '0000-00-00 00:00:00' or
      any unparseable string -> fallback, fell_back=True.
    * NULL / unexpected type -> fallback, fell_back=True.
    REUSED from #19.
    """
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)), False
    if isinstance(value, str):
        text = value.strip()
        if text and not text.startswith("0000-00-00"):
            try:
                parsed = datetime.fromisoformat(text)
                return (
                    parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
                ), False
            except ValueError:
                pass
        return fallback, True
    # NULL or any unexpected type: synthetic, counted.
    return fallback, True


# --------------------------------------------------------------------------- #
# Load (insert with per-batch SAVEPOINT isolation).
#
# Reused VERBATIM from etl-customers.py as reusable infrastructure. The
# INSERT_SQL and _record_to_tuple are #20-specific (full destination column set
# + ON CONFLICT (_legacy_id)) and are completed in step 8; the engine
# (insert_records / _insert_rows_individually / _rollback_to_savepoint /
# _sql_reason) is copied now so it is reviewed once and wired in step 8.
# --------------------------------------------------------------------------- #

# INSERT target column list + ON CONFLICT key. The full column set + the
# _record_to_tuple builder are #20-specific (step 8). The skeleton documents the
# idempotency contract (ON CONFLICT (_legacy_id) DO NOTHING) so the engine below
# is unambiguous; the SQL itself is left to step 8.
INSERT_SQL: str | None = None  # step 8: build from the design field map.


def _record_to_tuple(rec: ReservationRecord, migrated_at: datetime) -> tuple:
    """Build the INSERT row tuple for a ReservationRecord.

    SKELETON STUB. The full destination column set (FKs + business columns +
    _legacy_id + _legacy_migrated_at) is the #20 field map; built in step 8
    once the transform (steps 5) fixes ReservationRecord's shape. Not reachable
    until run() wires insert_records.
    """
    raise NotImplementedError(
        "step 8: build the destination row tuple from ReservationRecord "
        "(full field map + _legacy_id + _legacy_migrated_at)"
    )


def _rollback_to_savepoint(cur, name: str) -> None:
    """Roll back to and release a named SAVEPOINT. RE-RAISES on failure.

    A failed ROLLBACK TO SAVEPOINT means the transaction is poisoned (SQLSTATE
    25P02). Continuing would record a spurious 25P02 reject on every subsequent
    row and MASK the real poison row, so we let the error propagate: insert_records
    aborts and run() rolls back the whole transaction (exit 3). `name` is always a
    code literal ('etl_batch' / 'etl_row'), never user input — no injection surface.
    REUSED VERBATIM from #19.
    """
    cur.execute(f"ROLLBACK TO SAVEPOINT {name}")
    cur.execute(f"RELEASE SAVEPOINT {name}")


def insert_records(
    conn,
    records: list[ReservationRecord],
    migrated_at: datetime,
) -> tuple[set[int], list[tuple[int, str]]]:
    """Insert records in batches with a SAVEPOINT per batch.

    Returns (inserted_legacy_ids, batch_errors) where:
      * inserted_legacy_ids — _legacy_id values actually inserted (RETURNING),
        i.e. exact inserted count; ids absent here were ON CONFLICT skips.
      * batch_errors — list of (legacy_id, reason) for rows that could not be
        inserted because they raised a psycopg2 error.

    On a batch-level psycopg2 error the batch is rolled back to its SAVEPOINT
    and RE-TRIED ROW-BY-ROW: each row gets its own SAVEPOINT, so a single
    offending row is isolated as 'rejected' while the other rows in the batch
    still insert. One bad row never rolls back up to 500 good rows.

    Imports psycopg2.extras lazily. REUSED VERBATIM from #19 (customers -> the
    int _legacy_id key replaces the str identification_number key); the INSERT
    RETURNING shape is finalized in step 8.
    """
    from psycopg2 import extras  # lazy.

    inserted: set[int] = set()
    batch_errors: list[tuple[int, str]] = []

    for start in range(0, len(records), INSERT_BATCH_SIZE):
        batch = records[start : start + INSERT_BATCH_SIZE]
        values = [_record_to_tuple(r, migrated_at) for r in batch]
        cur = conn.cursor()
        try:
            cur.execute("SAVEPOINT etl_batch")
            returned = extras.execute_values(cur, INSERT_SQL, values, fetch=True)
            for legacy_id, *_ in returned:
                inserted.add(legacy_id)
            cur.execute("RELEASE SAVEPOINT etl_batch")
        except Exception:  # batch failed: roll back, retry row-by-row.
            # Re-raises if the savepoint rollback itself fails (poisoned tx):
            # do not proceed to row-by-row on a broken transaction.
            _rollback_to_savepoint(cur, "etl_batch")
            _insert_rows_individually(cur, batch, migrated_at, inserted, batch_errors)
        finally:
            try:
                cur.close()
            except Exception:
                pass

    return inserted, batch_errors


def _insert_rows_individually(
    cur,
    batch: list[ReservationRecord],
    migrated_at: datetime,
    inserted: set[int],
    batch_errors: list[tuple[int, str]],
) -> None:
    """Insert each row of a failed batch under its own SAVEPOINT.

    A row that still raises is isolated as a single 'rejected' (class+sqlstate);
    every other row in the batch commits. Mutates `inserted` and `batch_errors`.
    Imports psycopg2.extras lazily. REUSED VERBATIM from #19.
    """
    from psycopg2 import extras  # lazy.

    for r in batch:
        try:
            cur.execute("SAVEPOINT etl_row")
            returned = extras.execute_values(
                cur, INSERT_SQL, [_record_to_tuple(r, migrated_at)], fetch=True
            )
            for legacy_id, *_ in returned:
                inserted.add(legacy_id)
            cur.execute("RELEASE SAVEPOINT etl_row")
        except Exception as exc:
            reason = _sql_reason(exc)
            # Re-raises if the savepoint rollback itself fails (poisoned tx):
            # the real poison row must not be masked by spurious 25P02 on every
            # later row. Only the successful-rollback path records the single bad
            # row as a reject and continues isolating the rest.
            _rollback_to_savepoint(cur, "etl_row")
            batch_errors.append((r.legacy_id, reason))


def _sql_reason(exc: Exception) -> str:
    """Build a non-PII reject reason from a psycopg2 exception (class + sqlstate)."""
    sqlstate = getattr(exc, "pgcode", None)
    return f"{type(exc).__name__}:{sqlstate}" if sqlstate else type(exc).__name__


# --------------------------------------------------------------------------- #
# Reconciliation / summary.
#
# The reconciliation INVARIANT scaffolding (every legacy row has exactly one
# disposition: inserted | skipped | rejected, summing to legacy_rows_total) is
# kept. The #20-specific disposition fields (reject reasons taxonomy, FK
# resolution conflict tallies) are stubbed and filled in steps 7-8.
# --------------------------------------------------------------------------- #
def build_summary(
    *,
    dry_run: bool,
    committed: bool,
    extract: ExtractResult,
    inserted_legacy_ids: set[int],
    skip_classification: dict[int, str],
    batch_errors: dict[int, str],
    rejected: list[RejectedRow],
    elapsed_seconds: float,
    timestamp: str,
    dest_masked: str,
    report_path: str | None,
) -> dict:
    """Aggregate, NO-PII summary for stdout.

    SKELETON: the reconciliation INVARIANT is the scaffolding kept now — every
    scanned legacy row has exactly one disposition and the buckets must sum to
    legacy_rows_total. The #20 disposition detail (per-reason reject tallies,
    FK-resolution conflict counts, the inserted band) is filled in steps 7-8.

    1:1 reconciliation (no dedup group collapse, unlike #19):
        legacy_rows_total == inserted + skipped + rejected
    where inserted = |inserted_legacy_ids|, rejected = transform/FK rejects +
    batch_errors, skipped = ON-CONFLICT idempotent skips.
    """
    inserted_count = len(inserted_legacy_ids)
    skipped_count = len(skip_classification)
    rejected_count = len(rejected) + len(batch_errors)

    reconciled_sum = inserted_count + skipped_count + rejected_count
    reconciles = reconciled_sum == extract.legacy_rows_total

    reject_counts: dict[str, int] = {}
    for rej in rejected:
        reject_counts[rej.reason] = reject_counts.get(rej.reason, 0) + 1
    for reason in batch_errors.values():
        reject_counts[reason] = reject_counts.get(reason, 0) + 1

    skip_counts: dict[str, int] = {}
    for reason in skip_classification.values():
        skip_counts[reason] = skip_counts.get(reason, 0) + 1

    return {
        "timestamp": timestamp,
        "mode": "dry-run" if dry_run else "commit",
        "committed": committed,
        "destination": dest_masked,
        "elapsed_seconds": round(elapsed_seconds, 3),
        "report_path": report_path,
        "legacy_rows_total": extract.legacy_rows_total,
        "timestamp_fallback": extract.timestamp_fallback,
        "inserted": inserted_count,
        "skipped_total": skipped_count,
        "rejected_total": rejected_count,
        "skipped": skip_counts,
        "rejected": reject_counts,
        "reconciliation": {
            "inserted": inserted_count,
            "skipped": skipped_count,
            "rejected": rejected_count,
            "sum": reconciled_sum,
            "legacy_rows_total": extract.legacy_rows_total,
            "reconciles": reconciles,
        },
    }


# --------------------------------------------------------------------------- #
# Orchestration.
# --------------------------------------------------------------------------- #
def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="etl-reservations.py",
        description=(
            "Legacy reservations ETL: MariaDB rentacar_audit.reservations -> "
            "Supabase public.reservations (1:1, FK-resolved to destination "
            "UUID/enum, idempotent on _legacy_id)."
        ),
        epilog=(
            "Modes: --dry-run reads + computes + ROLLS BACK (writes nothing); "
            "without it, commit mode COMMITs only if the gate passes "
            "(0 unexpected rejects AND the reconciliation invariant "
            "inserted + skipped + rejected == legacy_rows_total closes). "
            "Exit codes: 0 ok, 2 connection, 3 query error, 4 env missing, "
            "5 report not persisted, 6 unexpected, 7 gate failed (rolled back)."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=_env_truthy("ETL_DRY_RUN"),
        help="Read + compute, then ROLLBACK. Writes nothing. "
        "(Also enabled by env ETL_DRY_RUN=1.)",
    )
    return parser.parse_args(argv)


def _env_truthy(name: str) -> bool:
    return (os.environ.get(name, "") or "").strip().lower() in {"1", "true", "yes", "on"}


def _utc_stamps() -> tuple[str, str]:
    iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return iso, iso.replace(":", "-")


def run(dry_run: bool) -> int:
    """Execute the ETL. Returns an exit code. Never raises to the caller.

    Ordering (inherited from #19): the legacy read + transform happen FIRST,
    holding only the legacy connection; the destination transaction is opened
    LATE, just before insert, so the Postgres session is never held idle during
    the long legacy read (pooler idle-reap risk).

    SKELETON (step 2): the env/connection contract is FULLY exercisable
    (SCEN-009): (1) validate_env runs in main() before this — a missing var
    returns exit 4 naming the var with NO DB opened; (2) the legacy connection
    is opened lazily; (3) the destination connection is opened LATE, and on an
    unreachable host returns exit 2 with the URL passed through mask_db_url (no
    password byte) and no partial commit. Only AFTER a successful destination
    connection does execution reach the steps 3-8 pipeline stub.
    """
    timestamp, _filename_stamp = _utc_stamps()
    dest_masked = mask_db_url(os.environ["SUPABASE_DB_URL"])
    run_started = datetime.now(timezone.utc)
    migrated_at = run_started  # single run-start marker for every inserted row.

    # ---- Extract + transform (legacy only; no destination connection yet). ----
    try:
        legacy_conn = connect_legacy()
    except Exception as exc:
        print(f"legacy connection failed: {type(exc).__name__}", file=sys.stderr)
        return EXIT_CONNECTION

    try:
        try:
            legacy_cur = legacy_conn.cursor()
            try:
                extract = extract_legacy_rows(legacy_cur)
            finally:
                try:
                    legacy_cur.close()
                except Exception:
                    pass
        except Exception as exc:
            print(f"legacy query failed: {type(exc).__name__}", file=sys.stderr)
            return EXIT_QUERY_ERROR
    finally:
        _close(legacy_conn)  # legacy read is done; release it before connecting dest.

    # ---- Connect destination LATE, transact. ----
    try:
        dest_conn = connect_destination_tx()
    except Exception as exc:
        print(
            f"destination connection failed for {dest_masked}: {type(exc).__name__}",
            file=sys.stderr,
        )
        return EXIT_CONNECTION

    try:
        # Only reachable AFTER a successful destination connection. SCEN-009's
        # connection contract (exit 4 env / exit 2 unreachable, masked URL, no
        # partial commit) is fully exercised before this point. Steps 3-8 replace
        # this stub with: build FK maps from the destination -> resolve + transform
        # each legacy row -> insert_records -> classify skips -> commit gate.
        raise NotImplementedError(
            "steps 3-8: extract/resolve/transform/insert pipeline"
        )
    finally:
        # Never leave a partial transaction committed: the skeleton wrote nothing
        # (autocommit=False, no commit() reachable), so roll back defensively.
        try:
            dest_conn.rollback()
        except Exception:
            pass
        _close(dest_conn)


def extract_legacy_rows(legacy_cur) -> ExtractResult:
    """Run the single legacy SELECT and coerce rows to LegacyRow with accounting.

    SKELETON (step 3 fills the body). Will run the #20 legacy SELECT (the full
    reservations column set + JOINs to branches/categories/franchises for
    FK-source codes), sanitize free-text fields (_sanitize_text), parse
    timestamps (_as_aware), and account every scanned legacy row for the
    reconciliation invariant.

    Returns an EMPTY ExtractResult on the skeleton — deliberately NOT a
    NotImplementedError. The single pipeline stub belongs AFTER the destination
    connection (see run()), so that SCEN-009's connection contract — including
    the unreachable-destination exit-2-with-masked-URL path — is fully reachable
    on the skeleton. Raising here would short-circuit run() before the
    destination connect and make that path untestable.
    """
    return ExtractResult()


def main(argv: list[str] | None = None) -> int:
    # dotenv is part of the operator venv; import lazily so the module stays
    # importable on bare Python (the unit tests never call main()).
    try:
        import dotenv

        dotenv.load_dotenv()
    except ModuleNotFoundError:
        pass

    args = parse_args(sys.argv[1:] if argv is None else argv)

    missing = validate_env()
    if missing:
        print(
            "Missing or empty required environment variable(s): " + ", ".join(missing),
            file=sys.stderr,
        )
        return EXIT_ENV_MISSING

    return run(dry_run=args.dry_run)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as exc:
        # A crash must never surface as Python's default exit 1. Sanitize:
        # never print exc body — it may contain a connection string / password.
        print(f"unexpected error: {type(exc).__name__}", file=sys.stderr)
        sys.exit(EXIT_UNEXPECTED)
