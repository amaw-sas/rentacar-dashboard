#!/usr/bin/env python3
"""Legacy customers ETL: MariaDB rentacar_audit.reservations -> Supabase customers.

Extracts unique customers from the legacy MariaDB audit DB (read-only),
deduplicates by TRIM(identification) (the destination's single-column UNIQUE
key), transforms them to the destination shape, and inserts them transactionally
into Supabase public.customers with ON CONFLICT (identification_number) DO NOTHING.

Two modes:
  --dry-run   read everything, compute everything, ROLLBACK at the end. Writes
              nothing to the destination. Use this against a disposable branch
              FIRST to validate the placeholder rule against the real data.
  (commit)    COMMIT only if the gate passes (0 unexpected rejects AND
              inserted == computed_unique_non_placeholder AND the unique
              placeholder count is within [1, 30]); otherwise ROLLBACK the
              whole transaction. The decision is printed.

Idempotent: a re-run inserts 0 (ON CONFLICT DO NOTHING + the _legacy_migrated_at
marker). The marker (migration 048) also scopes the rollback to ETL rows only.

The pure transform functions (split_fullname, map_identification_type,
is_placeholder, dedup_records) and their unit tests import and run on bare
Python with NO pymysql / psycopg2 installed: the DB drivers are imported LAZILY
inside connect_legacy() / connect_destination_tx() only. Do not move them up.

Issue #19. Scaffolding reused from scripts/migration/preflight-check.py (#16):
env validation, masked URL, atomic report writes, exit-code discipline.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

# --------------------------------------------------------------------------- #
# Exit-code contract (consistent with preflight-check.py; see README).
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
# Transform constants (Q1/Q11/P1/P3 decisions — see design / scenarios).
# --------------------------------------------------------------------------- #

# P1 compound-surname stopwords: a token equal (case-insensitive) to one of
# these is glued to the FOLLOWING token before the token-count rule runs, so
# "JUAN DE LA CRUZ" collapses to ["JUAN", "de la cruz"]-style compound surname.
STOPWORDS: frozenset[str] = frozenset({"de", "del", "la", "las", "los"})

# Q11 placeholder identifications. Discarded BEFORE dedup. Matched against the
# NORMALIZED identification (see normalize_identification) so formatting variants
# of a junk id are caught too. Junk = three closed families:
#   1. ^0+$ — all-zeros.
#   2. keyboard ramps — prefixes of "1234567890" with len>=6 (e.g. 123456,
#      1234567, 12345678, 123456789, 1234567890).
#   3. PLACEHOLDER_DENYLIST — a small, eyeballed set of operator/test ids that
#      are not clean ramp prefixes.
#
# HISTORY (why a closed enumeration, not a regex): the original provisional rule
# was `^123\d{4,}$`. The 2026-05-25 branch dry-run PROVED it discarded ~66 REAL
# 10-digit cedulas starting with 123 (matched personal emails + birth-year, and
# several had 3-4 bookings — real repeat customers). Discarding them would lose
# real customers AND cascade-reject their reservations in the downstream
# reservations ETL. A closed enumeration CANNOT over-match a real cedula: no
# real cedula is a prefix of the digit ramp, and the denylist is an explicit,
# verified set.
PLACEHOLDER_ZERO_RE = re.compile(r"^0+$")
_RAMP_SEQUENCE = "1234567890"
_RAMP_MIN_LEN = 6
# Operator/test identifications confirmed junk in the 2026-05-25 dry-run — all
# dc005241@gmail.com / "prueba" reservations — that are NOT clean ramp prefixes.
# Provenance + full eyeball of all 14 discarded ids:
# docs/migration-runs/etl-customers-verification-2026-05-25.md. The sequential
# ramps caught by the rule above were verified as fake ids shared across
# multiple distinct people (123456 = 2 people, 123456789 = 6 distinct emails),
# which is exactly why a ramp can never be a usable per-customer key.
PLACEHOLDER_DENYLIST = frozenset(
    {
        "12345677",  # fat-finger of the ramp
        "1234454",
        "1234558",
        "1234564",
        "1234566",
    }
)

# Decision A: in COMMIT mode the gate FAILS (whole tx rollback, exit 7) if the
# unique discarded-placeholder count falls OUTSIDE this range — a coarse
# anomaly tripwire (the closed rule above cannot over-match, so this is a
# sanity bound, not the primary defense). The corrected rule discards 14 ids
# on the real dump (2026-05-25 dry-run); was [50, 200], calibrated to the
# over-matching ^123\d{4,}$ premise. In --dry-run the range never blocks: the
# run completes and enumerates the full discarded list. Inclusive bounds.
PLACEHOLDER_RANGE_MIN = 1
PLACEHOLDER_RANGE_MAX = 30

# Characters stripped from identifications (Decision B). ONLY formatting
# punctuation — spaces, dots, dashes — so alphanumeric content is preserved
# (passport "AB-12345" -> "AB12345", never corrupted). Applied identically to
# the dedup KEY and the persisted identification_number.
_ID_PUNCT_RE = re.compile(r"[ .\-]")

# Control characters MariaDB text can hold but Postgres text cannot accept
# (NUL especially). Stripped during extraction from free-text fields so a row
# inserts cleanly instead of raising at the DB. C0 controls (ord < 32) plus
# DEL (0x7f); tab/newline/CR are also controls and have no place in a name /
# email / phone, so they go too.
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")

# P3 legacy identification_type -> destination CHECK domain. A value outside
# these three is REJECTED (never guessed).
IDENTIFICATION_TYPE_MAP: dict[str, str] = {
    "Cedula Ciudadania": "CC",
    "Cedula Extranjeria": "CE",
    "Pasaporte": "PP",
}

# Single source-of-truth legacy SELECT. ORDER BY makes the read deterministic
# and gives a stable per-group tiebreak (updated_at DESC, created_at DESC, id
# DESC) so the dedup winner is reproducible run-to-run -> idempotency.
LEGACY_SELECT = (
    "SELECT id, fullname, identification, identification_type, email, phone, "
    "created_at, updated_at "
    "FROM reservations "
    "ORDER BY updated_at DESC, created_at DESC, id DESC"
)

INSERT_SQL = (
    "INSERT INTO public.customers "
    "(first_name, last_name, identification_type, identification_number, "
    "phone, email, notes, status, created_at, updated_at, _legacy_migrated_at) "
    "VALUES %s "
    "ON CONFLICT (identification_number) DO NOTHING "
    "RETURNING id, identification_number"
)

INSERT_BATCH_SIZE = 500


# --------------------------------------------------------------------------- #
# Data structures.
# --------------------------------------------------------------------------- #
@dataclass
class LegacyRow:
    """One legacy reservations row's customer fields (already string-coerced)."""

    row_id: int
    fullname: str
    identification: str
    identification_type: str
    email: str
    phone: str
    created_at: datetime
    updated_at: datetime


@dataclass
class CustomerRecord:
    """A deduped, transformed customer ready for insert.

    group_size = number of legacy reservations this record collapses (>=1).
    Used for the SCEN-012 row-level reconciliation invariant.
    """

    first_name: str
    last_name: str
    identification_type: str
    identification_number: str
    phone: str
    email: str
    created_at: datetime
    updated_at: datetime
    needs_review: bool = False
    notes: str = ""
    status: str = "active"
    group_size: int = 1


@dataclass
class RejectedRow:
    """A row rejected by transform (before dedup) — never reaches the DB.

    group_size = number of legacy reservations the rejected group collapses
    (>=1). A rejected group still consumed that many legacy rows, so it counts
    at the row level for reconciliation.
    """

    row_id: int
    identification: str
    reason: str
    group_size: int = 1


@dataclass
class ExtractResult:
    """Output of extract_legacy_rows: usable rows + full accounting (SCEN-012/013).

    Every scanned legacy row has exactly one disposition: it either becomes a
    usable LegacyRow (in `rows`) or is counted in `dropped_no_identification`
    (blank/NULL identification — cannot become a customer). `legacy_rows_total`
    is the raw count scanned; `timestamp_fallback` counts rows whose created_at
    OR updated_at could not be parsed and fell back to a synthetic value.
    """

    rows: list[LegacyRow] = field(default_factory=list)
    legacy_rows_total: int = 0
    dropped_no_identification: int = 0
    timestamp_fallback: int = 0


@dataclass
class DedupResult:
    """Output of dedup_records: winners + observed conflicts + collapse stats."""

    records: list[CustomerRecord] = field(default_factory=list)
    rejected: list[RejectedRow] = field(default_factory=list)
    conflicts_by_name: int = 0
    conflicts_by_email: int = 0
    conflicts_by_phone: int = 0
    conflicts_cross_type: int = 0
    cross_type_detail: list[dict] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Pure transforms (NO DB drivers; unit-tested on bare Python).
# --------------------------------------------------------------------------- #
def normalize_identification(identification: str) -> str:
    """Normalize an identification (Decision B): strip formatting punctuation.

    Removes spaces, dots ('.'), and dashes ('-') ONLY — never alphanumerics.
    So '12.345.678' / '12 345 678' / '12345678' all collapse to '12345678',
    while a passport 'AB-12345' becomes 'AB12345' (letters preserved). Leading/
    trailing whitespace is also stripped.

    Used identically as the dedup KEY and the persisted identification_number,
    so the deduped value is exactly what lands in the column.
    """
    return _ID_PUNCT_RE.sub("", (identification or "").strip())


def is_placeholder(identification: str) -> bool:
    """True if the NORMALIZED identification is junk (Q11).

    Normalizes first (so '0.0.0' is caught the same as '000'), then tests the
    three closed junk families: all-zeros, keyboard-ramp prefixes of
    "1234567890" (len>=6), and the verified operator/test denylist. A closed
    enumeration — it cannot misclassify a real cedula (see the constants above
    and the 2026-05-25 dry-run that replaced the provisional ^123\\d{4,}$ rule).
    """
    value = normalize_identification(identification)
    if not value:
        return False
    if PLACEHOLDER_ZERO_RE.match(value):
        return True
    if len(value) >= _RAMP_MIN_LEN and _RAMP_SEQUENCE.startswith(value):
        return True
    return value in PLACEHOLDER_DENYLIST


def map_identification_type(legacy_value: str) -> str | None:
    """Map a legacy identification_type to the destination domain (P3).

    Returns 'CC' / 'CE' / 'PP', or None if the value is outside the three
    known legacy values (caller rejects with reason='invalid_identification_type').
    Never guesses.
    """
    return IDENTIFICATION_TYPE_MAP.get((legacy_value or "").strip())


def split_fullname(fullname: str) -> tuple[str, str, bool]:
    """Split a legacy fullname into (first_name, last_name, needs_review) (P1).

    Whitespace is trimmed and internal runs collapsed before tokenizing.
    Stopwords (STOPWORDS, case-insensitive) glue to the FOLLOWING token to
    form a compound surname before the count rule runs.

    Token-count rule (after stopword collapse):
      1 token  -> (token, '.')            needs_review=True   (Q1: never empty)
      2 tokens -> (t0, t1)
      3 tokens -> (t0, t1 + ' ' + t2)
      4+ tokens-> (t0 + ' ' + t1, ' '.join(t2:))

    Raises ValueError if the name is empty/null after trim — caller rejects
    with reason='invalid_first_name'.
    """
    normalized = " ".join((fullname or "").split())
    if not normalized:
        raise ValueError("empty fullname")

    raw_tokens = normalized.split(" ")

    # Collapse stopwords onto the following token (compound surname).
    tokens: list[str] = []
    pending: list[str] = []
    for tok in raw_tokens:
        if tok.lower() in STOPWORDS:
            pending.append(tok)
            continue
        if pending:
            tokens.append(" ".join(pending + [tok]))
            pending = []
        else:
            tokens.append(tok)
    # Trailing stopwords with no following token: keep them as their own token
    # rather than dropping data (degenerate input, still surfaced for review).
    if pending:
        tokens.append(" ".join(pending))

    n = len(tokens)
    if n == 1:
        return tokens[0], ".", True
    if n == 2:
        return tokens[0], tokens[1], False
    if n == 3:
        return tokens[0], f"{tokens[1]} {tokens[2]}", False
    return f"{tokens[0]} {tokens[1]}", " ".join(tokens[2:]), False


def transform_row(row: LegacyRow) -> CustomerRecord | RejectedRow:
    """Transform one legacy row to a CustomerRecord or a RejectedRow.

    Order of rejection checks: identification_type, then fullname, then email.
    Placeholder discard is handled by the caller BEFORE this function (it is a
    'skipped', not a 'rejected'). The persisted identification_number is the
    NORMALIZED value (Decision B), identical to the dedup key.
    """
    normalized_id = normalize_identification(row.identification)
    mapped_type = map_identification_type(row.identification_type)
    if mapped_type is None:
        return RejectedRow(row.row_id, normalized_id, "invalid_identification_type")

    try:
        first_name, last_name, needs_review = split_fullname(row.fullname)
    except ValueError:
        return RejectedRow(row.row_id, normalized_id, "invalid_first_name")

    email = (row.email or "").strip().lower()
    if not email:
        return RejectedRow(row.row_id, normalized_id, "invalid_email")

    return CustomerRecord(
        first_name=first_name,
        last_name=last_name,
        identification_type=mapped_type,
        identification_number=normalized_id,
        phone=(row.phone or "").strip(),
        email=email,
        created_at=row.created_at,
        updated_at=row.updated_at,
        needs_review=needs_review,
    )


def dedup_records(rows: list[LegacyRow]) -> DedupResult:
    """Dedup legacy rows by normalize_identification; latest-wins by updated_at.

    Pipeline per group (rows sharing the same normalized identification):
      * the WINNER is the row with MAX updated_at; stable tiebreak is
        created_at DESC then legacy row id DESC (deterministic -> idempotent).
        The winner provides ALL fields (type/name/email/phone).
      * created_at = MIN over the group; updated_at = MAX over the group.
      * field divergence across the group is counted (by_name / by_email /
        by_phone) without blocking.
      * a same-number / different-type group is recorded as cross_type
        (the winner's mapped type is kept; both legacy types are listed).

    Placeholders are assumed already removed by the caller. Rows whose
    transform fails are collected into result.rejected (winner-level: a group
    is rejected based on its WINNER's transform, since the winner supplies all
    persisted fields).

    Pure: no DB, no I/O. Deterministic given the input order.
    """
    result = DedupResult()

    # Group by the normalized identification (== the persisted value).
    groups: dict[str, list[LegacyRow]] = {}
    for r in rows:
        key = normalize_identification(r.identification)
        groups.setdefault(key, []).append(r)

    for key, members in groups.items():
        # Deterministic winner: updated_at DESC, created_at DESC, id DESC.
        ordered = sorted(
            members,
            key=lambda m: (m.updated_at, m.created_at, m.row_id),
            reverse=True,
        )
        winner = ordered[0]

        outcome = transform_row(winner)
        if isinstance(outcome, RejectedRow):
            outcome.group_size = len(members)
            result.rejected.append(outcome)
            continue

        record = outcome
        record.created_at = min(m.created_at for m in members)
        record.updated_at = max(m.updated_at for m in members)
        record.group_size = len(members)
        result.records.append(record)

        # Conflict accounting (divergence across the group, winner as baseline).
        if len({(m.fullname or "").strip() for m in members}) > 1:
            result.conflicts_by_name += 1
        if len({(m.email or "").strip().lower() for m in members}) > 1:
            result.conflicts_by_email += 1
        if len({(m.phone or "").strip() for m in members}) > 1:
            result.conflicts_by_phone += 1

        legacy_types = sorted({(m.identification_type or "").strip() for m in members})
        if len(legacy_types) > 1:
            result.conflicts_cross_type += 1
            result.cross_type_detail.append(
                {
                    "identification_number": key,
                    "legacy_types_seen": legacy_types,
                    "winner_type": record.identification_type,
                }
            )

    return result


# --------------------------------------------------------------------------- #
# Shared helpers (mask_db_url, validate_env, atomic write) — same contract as
# preflight-check.py. Replicated here (not imported) because the source module
# has a hyphenated filename (scripts/migration/preflight-check.py) which is not
# a legal Python module name to `import`. See preflight-check.py for the full
# rationale on the masking strategy.
# --------------------------------------------------------------------------- #
def mask_db_url(url: str) -> str:
    """Return a masked DB URL that NEVER echoes any password byte.

    SECURITY BOUNDARY. The last '@' in the post-scheme string is always the
    userinfo terminator (host/path never contain '@', a password may), so
    keeping only the substring AFTER it drops every password byte. Any
    malformed input falls back to fully-redacted. Mirrors preflight-check.py.
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
        repo_root / "docs" / "migration-runs" / f"etl-customers-{filename_stamp}.jsonl"
    )
    fallback = Path("/tmp") / f"etl-customers-{filename_stamp}.jsonl"
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
# Extract.
# --------------------------------------------------------------------------- #
def extract_legacy_rows(legacy_cur) -> ExtractResult:
    """Run the single legacy SELECT and coerce rows to LegacyRow with accounting.

    Every scanned row has exactly one disposition (SCEN-012):
      * blank/NULL identification (after normalization) -> counted in
        dropped_no_identification, NOT turned into a customer.
      * otherwise -> a usable LegacyRow.

    Free-text fields (fullname/email/phone) are control-char sanitized during
    coercion (SCEN-011) so a NUL byte or other C0 control never reaches Postgres
    text. Timestamps are parsed where possible; a NULL / zero-date / unparseable
    value falls back to a synthetic epoch-min and is counted in timestamp_fallback
    (SCEN-013) — a fallback is surfaced, never silently written as year 0001.
    """
    legacy_cur.execute(LEGACY_SELECT)
    result = ExtractResult()
    epoch_min = datetime.min.replace(tzinfo=timezone.utc)
    for raw in legacy_cur.fetchall():
        result.legacy_rows_total += 1
        row_id, fullname, identification, id_type, email, phone, created, updated = raw

        # Identification: normalize to decide the blank-id disposition. (The
        # LegacyRow keeps the raw value; transform/dedup re-normalize so the
        # persisted value and key stay the single source of truth.)
        if normalize_identification(identification if identification is not None else ""):
            ident_raw = str(identification)
        else:
            result.dropped_no_identification += 1
            continue

        created_at, created_fb = _as_aware(created, epoch_min)
        updated_at, updated_fb = _as_aware(updated, epoch_min)
        if created_fb or updated_fb:
            result.timestamp_fallback += 1

        result.rows.append(
            LegacyRow(
                row_id=int(row_id),
                fullname=_sanitize_text(fullname),
                identification=ident_raw,
                identification_type=_sanitize_text(id_type),
                email=_sanitize_text(email),
                phone=_sanitize_text(phone),
                created_at=created_at,
                updated_at=updated_at,
            )
        )
    return result


def _sanitize_text(value) -> str:
    """Coerce a driver value to str and strip control chars (SCEN-011).

    NULL -> ''. Removes C0 controls (incl. NUL) and DEL so the text inserts
    cleanly into Postgres. Surrounding whitespace is left to downstream
    trim/collapse (split_fullname collapses; email/phone .strip()).
    """
    if value is None:
        return ""
    return _CONTROL_CHARS_RE.sub("", str(value))


def _as_aware(value, fallback: datetime) -> tuple[datetime, bool]:
    """Coerce a driver timestamp to (aware_datetime, fell_back) (SCEN-013).

    * datetime -> used as-is (UTC-assumed if naive); fell_back=False.
    * string  -> parsed via datetime.fromisoformat (handles 'YYYY-MM-DD
      HH:MM:SS' and ISO forms); a MariaDB zero-date '0000-00-00 00:00:00' or
      any unparseable string -> fallback, fell_back=True.
    * NULL / unexpected type -> fallback, fell_back=True.
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
# Placeholder partition (BEFORE dedup).
# --------------------------------------------------------------------------- #
def partition_placeholders(
    rows: list[LegacyRow],
) -> tuple[list[LegacyRow], list[LegacyRow]]:
    """Split rows into (kept, placeholder) by is_placeholder on TRIM(identification)."""
    kept: list[LegacyRow] = []
    placeholders: list[LegacyRow] = []
    for r in rows:
        (placeholders if is_placeholder(r.identification) else kept).append(r)
    return kept, placeholders


# --------------------------------------------------------------------------- #
# Load (insert with per-batch SAVEPOINT isolation).
# --------------------------------------------------------------------------- #
def _record_to_tuple(rec: CustomerRecord, migrated_at: datetime) -> tuple:
    return (
        rec.first_name,
        rec.last_name,
        rec.identification_type,
        rec.identification_number,
        rec.phone,
        rec.email,
        rec.notes,
        rec.status,
        rec.created_at,
        rec.updated_at,
        migrated_at,
    )


def insert_records(
    conn,
    records: list[CustomerRecord],
    migrated_at: datetime,
) -> tuple[set[str], list[tuple[str, str]]]:
    """Insert records in batches with a SAVEPOINT per batch.

    Returns (inserted_numbers, batch_errors) where:
      * inserted_numbers — identification_numbers actually inserted (RETURNING),
        i.e. exact inserted count; numbers absent here were ON CONFLICT skips.
      * batch_errors — list of (identification_number, reason) for rows that
        could not be inserted because they raised a psycopg2 error.

    On a batch-level psycopg2 error the batch is rolled back to its SAVEPOINT
    and RE-TRIED ROW-BY-ROW (SCEN-011): each row gets its own SAVEPOINT, so a
    single offending row is isolated as 'rejected' while the other rows in the
    batch still insert. One bad row never rolls back up to 500 good rows.

    Imports psycopg2.extras lazily.
    """
    from psycopg2 import extras  # lazy.

    inserted: set[str] = set()
    batch_errors: list[tuple[str, str]] = []

    for start in range(0, len(records), INSERT_BATCH_SIZE):
        batch = records[start : start + INSERT_BATCH_SIZE]
        values = [_record_to_tuple(r, migrated_at) for r in batch]
        cur = conn.cursor()
        try:
            cur.execute("SAVEPOINT etl_batch")
            returned = extras.execute_values(cur, INSERT_SQL, values, fetch=True)
            for _id, number in returned:
                inserted.add(number)
            cur.execute("RELEASE SAVEPOINT etl_batch")
        except Exception:  # batch failed: roll back, retry row-by-row.
            try:
                cur.execute("ROLLBACK TO SAVEPOINT etl_batch")
                cur.execute("RELEASE SAVEPOINT etl_batch")
            except Exception:
                pass
            _insert_rows_individually(cur, batch, migrated_at, inserted, batch_errors)
        finally:
            try:
                cur.close()
            except Exception:
                pass

    return inserted, batch_errors


def _insert_rows_individually(
    cur,
    batch: list[CustomerRecord],
    migrated_at: datetime,
    inserted: set[str],
    batch_errors: list[tuple[str, str]],
) -> None:
    """Insert each row of a failed batch under its own SAVEPOINT (SCEN-011).

    A row that still raises is isolated as a single 'rejected' (class+sqlstate);
    every other row in the batch commits. Mutates `inserted` and `batch_errors`.
    Imports psycopg2.extras lazily.
    """
    from psycopg2 import extras  # lazy.

    for r in batch:
        try:
            cur.execute("SAVEPOINT etl_row")
            returned = extras.execute_values(
                cur, INSERT_SQL, [_record_to_tuple(r, migrated_at)], fetch=True
            )
            for _id, number in returned:
                inserted.add(number)
            cur.execute("RELEASE SAVEPOINT etl_row")
        except Exception as exc:
            reason = _sql_reason(exc)
            try:
                cur.execute("ROLLBACK TO SAVEPOINT etl_row")
                cur.execute("RELEASE SAVEPOINT etl_row")
            except Exception:
                pass
            batch_errors.append((r.identification_number, reason))


def _sql_reason(exc: Exception) -> str:
    """Build a non-PII reject reason from a psycopg2 exception (class + sqlstate)."""
    sqlstate = getattr(exc, "pgcode", None)
    return f"{type(exc).__name__}:{sqlstate}" if sqlstate else type(exc).__name__


def classify_skips(
    conn,
    skipped_numbers: list[str],
) -> dict[str, str]:
    """For ON-CONFLICT-skipped numbers, classify by the existing row's marker.

    Returns {identification_number: reason} where reason is:
      * 'already_migrated'  — existing row has _legacy_migrated_at NOT NULL
        (a prior ETL run inserted it).
      * 'conflict_existing' — existing row has _legacy_migrated_at NULL
        (dashboard-owned; never overwrite).
    Numbers not found in the destination at all (shouldn't happen after a
    conflict) are reported 'conflict_unknown'.
    """
    classification: dict[str, str] = {}
    if not skipped_numbers:
        return classification

    cur = conn.cursor()
    try:
        for start in range(0, len(skipped_numbers), INSERT_BATCH_SIZE):
            chunk = skipped_numbers[start : start + INSERT_BATCH_SIZE]
            cur.execute(
                "SELECT identification_number, _legacy_migrated_at "
                "FROM public.customers WHERE identification_number = ANY(%s)",
                (chunk,),
            )
            found = {num: marker for num, marker in cur.fetchall()}
            for num in chunk:
                if num not in found:
                    classification[num] = "conflict_unknown"
                elif found[num] is not None:
                    classification[num] = "already_migrated"
                else:
                    classification[num] = "conflict_existing"
    finally:
        try:
            cur.close()
        except Exception:
            pass
    return classification


# --------------------------------------------------------------------------- #
# Report assembly.
# --------------------------------------------------------------------------- #
def build_report_lines(
    *,
    records: list[CustomerRecord],
    inserted_numbers: set[str],
    skip_classification: dict[str, str],
    batch_errors: dict[str, str],
    transform_rejected: list[RejectedRow],
    placeholders: list[LegacyRow],
    cross_type_detail: list[dict],
) -> list[dict]:
    """Build the per-row JSONL report lines (one object per logged event).

    NOTE: per-row lines carry identification_number (PII-adjacent) and the
    JSONL is gitignored. The stdout summary is the no-PII evidence. The full
    discarded-placeholder list and cross-type detail live HERE (in the JSONL)
    only — never on the stdout summary.
    """
    lines: list[dict] = []

    # Cross-type collisions (SCEN-006): one resolved line per collision, with
    # the legacy types seen and the winner. The summary keeps only the count.
    for detail in cross_type_detail:
        lines.append(
            {
                "action": "resolved",
                "reason": "cross_type_id",
                "identification_number": detail["identification_number"],
                "legacy_types_seen": detail["legacy_types_seen"],
                "winner_type": detail["winner_type"],
            }
        )

    for ph in placeholders:
        lines.append(
            {
                "action": "skipped",
                "reason": "placeholder",
                "identification_number": normalize_identification(ph.identification),
                "legacy_row_id": ph.row_id,
            }
        )

    for rej in transform_rejected:
        lines.append(
            {
                "action": "rejected",
                "reason": rej.reason,
                "identification_number": rej.identification,
                "legacy_row_id": rej.row_id,
            }
        )

    for rec in records:
        number = rec.identification_number
        if number in batch_errors:
            lines.append(
                {
                    "action": "rejected",
                    "reason": batch_errors[number],
                    "identification_number": number,
                }
            )
        elif number in inserted_numbers:
            lines.append(
                {
                    "action": "inserted",
                    "identification_number": number,
                    "identification_type": rec.identification_type,
                    "needs_review": rec.needs_review,
                }
            )
        else:
            lines.append(
                {
                    "action": "skipped",
                    "reason": skip_classification.get(number, "conflict_unknown"),
                    "identification_number": number,
                }
            )

    return lines


def placeholder_within_range(unique_count: int) -> bool:
    """True if the unique-placeholder count is within the commit gate range (Decision A)."""
    return PLACEHOLDER_RANGE_MIN <= unique_count <= PLACEHOLDER_RANGE_MAX


def build_summary(
    *,
    dry_run: bool,
    committed: bool,
    extract: ExtractResult,
    placeholders: list[LegacyRow],
    dedup: DedupResult,
    inserted_numbers: set[str],
    skip_classification: dict[str, str],
    batch_errors: dict[str, str],
    computed_unique_non_placeholder: int,
    elapsed_seconds: float,
    timestamp: str,
    dest_masked: str,
    report_path: str | None,
) -> dict:
    """Aggregate, NO-PII summary for stdout.

    The full discarded-id list and cross-type ids are PII-adjacent and live in
    the gitignored JSONL ONLY — this summary keeps just counts. SCEN-012: the
    five disposition buckets reconcile against legacy_rows_total.
    """
    placeholder_unique = {normalize_identification(p.identification) for p in placeholders}
    skip_counts: dict[str, int] = {}
    for reason in skip_classification.values():
        skip_counts[reason] = skip_counts.get(reason, 0) + 1

    needs_review_inserted = sum(
        1 for r in dedup.records if r.needs_review and r.identification_number in inserted_numbers
    )

    reject_counts: dict[str, int] = {}
    for rej in dedup.rejected:
        reject_counts[rej.reason] = reject_counts.get(rej.reason, 0) + 1
    for reason in batch_errors.values():
        reject_counts[reason] = reject_counts.get(reason, 0) + 1

    within_range = placeholder_within_range(len(placeholder_unique))

    # SCEN-012: every scanned legacy ROW has exactly one disposition. The
    # buckets are reported at the ROW level (summing each deduped group's size)
    # so the literal invariant holds despite dedup collapse:
    #   legacy_rows_total == inserted + skipped_total + rejected_total
    #                        + placeholder_reservations + dropped_no_identification
    # where inserted/skipped/rejected each sum the group_size of the records in
    # that disposition (a record collapsing 3 reservations contributes 3).
    placeholder_reservations = len(placeholders)
    dropped_no_identification = extract.dropped_no_identification

    inserted_rows = 0
    skipped_rows = 0
    rejected_rows = 0
    for rec in dedup.records:
        number = rec.identification_number
        if number in batch_errors:
            rejected_rows += rec.group_size
        elif number in inserted_numbers:
            inserted_rows += rec.group_size
        else:
            skipped_rows += rec.group_size
    for rej in dedup.rejected:  # transform-rejected groups.
        rejected_rows += rej.group_size

    reconciled_sum = (
        inserted_rows
        + skipped_rows
        + rejected_rows
        + placeholder_reservations
        + dropped_no_identification
    )
    reconciles = reconciled_sum == extract.legacy_rows_total

    # Also expose the deduped-record-level counts (what the operator usually
    # reasons about): distinct customers inserted / skipped / rejected.
    inserted_count = len(inserted_numbers)
    skipped_total = sum(skip_counts.values())
    rejected_total = len(dedup.rejected) + len(batch_errors)

    return {
        "timestamp": timestamp,
        "mode": "dry-run" if dry_run else "commit",
        "committed": committed,
        "destination": dest_masked,
        "elapsed_seconds": round(elapsed_seconds, 3),
        "report_path": report_path,
        "legacy_rows_total": extract.legacy_rows_total,
        "dropped_no_identification": dropped_no_identification,
        "timestamp_fallback": extract.timestamp_fallback,
        "placeholders_discarded": {
            "unique_ids": len(placeholder_unique),
            "reservations": placeholder_reservations,
            # NO discarded_identifications list here (PII): see the JSONL report.
            # Corrected expectation (2026-05-25 dry-run): zeros+ramps+denylist
            # discard 14 ids / 121 reservations (incl. the 6-digit ramp 123456,
            # a fake id shared by 2 people). Was {90, 215}, the over-matching
            # ^123\d{4,}$ premise that swept up real cedulas.
            "audit_expectation": {"unique_ids": 14, "reservations": 121},
            "expected_range": [PLACEHOLDER_RANGE_MIN, PLACEHOLDER_RANGE_MAX],
            "within_expected_range": within_range,
        },
        "computed_unique_non_placeholder": computed_unique_non_placeholder,
        "inserted": inserted_count,
        "skipped_total": skipped_total,
        "rejected_total": rejected_total,
        "needs_review": needs_review_inserted,
        "conflicts_resolved": {
            "by_name": dedup.conflicts_by_name,
            "by_email": dedup.conflicts_by_email,
            "by_phone": dedup.conflicts_by_phone,
            "cross_type": dedup.conflicts_cross_type,
        },
        "skipped": skip_counts,
        "rejected": reject_counts,
        "reconciliation": {
            "row_level": {
                "inserted": inserted_rows,
                "skipped": skipped_rows,
                "rejected": rejected_rows,
                "placeholder_reservations": placeholder_reservations,
                "dropped_no_identification": dropped_no_identification,
                "sum": reconciled_sum,
                "legacy_rows_total": extract.legacy_rows_total,
            },
            "reconciles": reconciles,
        },
    }


# --------------------------------------------------------------------------- #
# Orchestration.
# --------------------------------------------------------------------------- #
def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="etl-customers.py",
        description=(
            "Legacy customers ETL: MariaDB rentacar_audit.reservations -> "
            "Supabase public.customers (deduped by TRIM(identification))."
        ),
        epilog=(
            "Modes: --dry-run reads + computes + ROLLS BACK (writes nothing); "
            "without it, commit mode COMMITs only if the gate passes "
            "(0 unexpected rejects AND inserted == computed_unique_non_placeholder "
            "AND the unique placeholder count is within [1, 30]). "
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

    Ordering (fix #7): the legacy read + dedup happen FIRST, holding only the
    legacy connection; the destination transaction is opened LATE, just before
    insert, so the Postgres session is never held idle during the long legacy
    read/dedup (pooler idle-reap risk).
    """
    timestamp, filename_stamp = _utc_stamps()
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

    kept, placeholders = partition_placeholders(extract.rows)
    dedup = dedup_records(kept)
    computed_unique_non_placeholder = len(dedup.records)
    placeholder_unique_count = len(
        {normalize_identification(p.identification) for p in placeholders}
    )
    within_range = placeholder_within_range(placeholder_unique_count)

    # ---- Connect destination LATE, transact. ----
    try:
        dest_conn = connect_destination_tx()
    except Exception as exc:
        print(
            f"destination connection failed for {dest_masked}: {type(exc).__name__}",
            file=sys.stderr,
        )
        return EXIT_CONNECTION

    inserted_numbers: set[str] = set()
    batch_errors: dict[str, str] = {}
    skip_classification: dict[str, str] = {}
    committed = False
    try:
        # ---- Load. ----
        try:
            inserted_numbers, batch_error_list = insert_records(
                dest_conn, dedup.records, migrated_at
            )
        except Exception as exc:
            print(f"destination insert failed: {type(exc).__name__}", file=sys.stderr)
            try:
                dest_conn.rollback()
            except Exception:
                pass
            return EXIT_QUERY_ERROR
        batch_errors = dict(batch_error_list)

        # ---- Classify ON CONFLICT skips (existing rows). ----
        skipped_numbers = [
            r.identification_number
            for r in dedup.records
            if r.identification_number not in inserted_numbers
            and r.identification_number not in batch_errors
        ]
        try:
            skip_classification = classify_skips(dest_conn, skipped_numbers)
        except Exception as exc:
            print(f"skip classification failed: {type(exc).__name__}", file=sys.stderr)
            try:
                dest_conn.rollback()
            except Exception:
                pass
            return EXIT_QUERY_ERROR

        # ---- Gate decision. ----
        unexpected_rejects = len(batch_errors)  # transform rejects are EXPECTED.
        gate_inserted_ok = len(inserted_numbers) == computed_unique_non_placeholder
        # In a clean first run all computed records insert. On a re-run, conflicts
        # mean inserted < computed; that is a LEGITIMATE idempotent outcome, not a
        # gate failure. So the gate also passes when every non-inserted record is
        # an explained skip (already_migrated / conflict_existing).
        all_non_inserted_explained = all(
            num in batch_errors or num in skip_classification or num in inserted_numbers
            for num in (r.identification_number for r in dedup.records)
        )
        # Decision A: in COMMIT mode the placeholder count MUST be within range.
        gate_pass = (
            unexpected_rejects == 0
            and within_range
            and (gate_inserted_ok or all_non_inserted_explained)
        )

        if dry_run:
            dest_conn.rollback()
            print("DRY-RUN: transaction ROLLED BACK (nothing written).")
        elif gate_pass:
            dest_conn.commit()
            committed = True
            print(
                f"COMMIT: gate passed (inserted={len(inserted_numbers)}, "
                f"unexpected_rejects={unexpected_rejects}, "
                f"placeholders_unique={placeholder_unique_count})."
            )
        else:
            dest_conn.rollback()
            reasons = []
            if unexpected_rejects:
                reasons.append(f"unexpected_rejects={unexpected_rejects}")
            if not within_range:
                reasons.append(
                    f"placeholders_unique={placeholder_unique_count} "
                    f"outside [{PLACEHOLDER_RANGE_MIN},{PLACEHOLDER_RANGE_MAX}]"
                )
            if not (gate_inserted_ok or all_non_inserted_explained):
                reasons.append(
                    f"inserted={len(inserted_numbers)} != "
                    f"computed={computed_unique_non_placeholder} and unexplained"
                )
            print(
                "GATE FAILED: ROLLED BACK whole transaction ("
                + "; ".join(reasons)
                + "). Nothing written.",
                file=sys.stderr,
            )
    finally:
        _close(dest_conn)

    # ---- Report (per-row JSONL + stdout summary). ----
    elapsed = (datetime.now(timezone.utc) - run_started).total_seconds()
    lines = build_report_lines(
        records=dedup.records,
        inserted_numbers=inserted_numbers,
        skip_classification=skip_classification,
        batch_errors=batch_errors,
        transform_rejected=dedup.rejected,
        placeholders=placeholders,
        cross_type_detail=dedup.cross_type_detail,
    )
    report_path = write_jsonl_report(lines, filename_stamp)

    summary = build_summary(
        dry_run=dry_run,
        committed=committed,
        extract=extract,
        placeholders=placeholders,
        dedup=dedup,
        inserted_numbers=inserted_numbers,
        skip_classification=skip_classification,
        batch_errors=batch_errors,
        computed_unique_non_placeholder=computed_unique_non_placeholder,
        elapsed_seconds=elapsed,
        timestamp=timestamp,
        dest_masked=dest_masked,
        report_path=str(report_path) if report_path else None,
    )
    print(json.dumps(summary, indent=2, ensure_ascii=False))

    if report_path is None:
        return EXIT_REPORT_FAILED
    if not dry_run and not committed:
        return EXIT_GATE_FAILED
    return EXIT_OK


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
            "Missing or empty required environment variable(s): "
            + ", ".join(missing),
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
