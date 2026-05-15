#!/usr/bin/env python3
"""Migration pre-flight check: legacy MariaDB -> destination Supabase lookups.

Read-only on both sides. Validates that every legacy identifier has an
equivalent in the destination before any ETL runs. Exits with a semantic
code (see EXIT_* below) and writes a JSON report.

Issue #16. Design: docs/specs/2026-05-12-issue-16-preflight-check-design.md
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import dotenv
import pymysql
import psycopg2

EXIT_OK = 0
EXIT_GAPS = 1
EXIT_CONNECTION = 2
EXIT_QUERY_ERROR = 3
EXIT_ENV_MISSING = 4
EXIT_REPORT_FAILED = 5
EXIT_UNEXPECTED = 6


class DestinationConnectionLost(Exception):
    """Fatal: the destination connection died mid-run (not a query error).

    Raised from run_check when a destination-side failure is a dropped/dead
    connection (Supabase pooler idle drop, network blip) rather than a
    query-level fault (relation missing, syntax, permission). main() catches
    this around the per-check loop and converts it to EXIT_CONNECTION,
    aborting the whole run before any report is written -- consistent with
    SCEN-004 semantics (connection failure => no JSON report). NEVER carries
    the exception body or DSN; only the originating exception's class name.
    """

REQUIRED_ENV = [
    "LEGACY_DB_HOST",
    "LEGACY_DB_USER",
    "LEGACY_DB_PASSWORD",
    "LEGACY_DB_NAME",
    "SUPABASE_DB_URL",
]


@dataclass
class Check:
    name: str
    description: str
    legacy_query: str
    destination_query: str | None = None
    static_destination: set[str] | None = None


@dataclass
class CheckResult:
    name: str
    description: str
    legacy_count: int = 0
    destination_count: int = 0
    legacy_values: list[str] = field(default_factory=list)
    destination_values: list[str] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)
    passed: bool = False
    error: str | None = None


CHECKS = [
    Check(
        name="franchises",
        description="legacy franchises.name -> enum destino reservations.franchise",
        legacy_query="SELECT DISTINCT name FROM franchises",
        static_destination={"alquilatucarro", "alquilame", "alquicarros"},
    ),
    Check(
        name="branches",
        description="legacy branches.code -> destino locations.code (filtrado por Localiza)",
        legacy_query="SELECT DISTINCT code FROM branches WHERE code IS NOT NULL",
        destination_query=(
            "SELECT DISTINCT l.code FROM locations l "
            "JOIN rental_companies rc ON l.rental_company_id = rc.id "
            "WHERE rc.code = 'localiza'"
        ),
    ),
    Check(
        name="categories",
        description="legacy categories.identification -> destino vehicle_categories.code (Localiza)",
        legacy_query=(
            "SELECT DISTINCT identification FROM categories "
            "WHERE identification IS NOT NULL"
        ),
        destination_query=(
            "SELECT DISTINCT vc.code FROM vehicle_categories vc "
            "JOIN rental_companies rc ON vc.rental_company_id = rc.id "
            "WHERE rc.code = 'localiza'"
        ),
    ),
    Check(
        name="identification_type",
        description="legacy reservations.identification_type -> mapping a destino CC/CE/PP",
        legacy_query="SELECT DISTINCT identification_type FROM reservations",
        static_destination={"Cedula Ciudadania", "Cedula Extranjeria", "Pasaporte"},
    ),
]


def mask_db_url(url: str) -> str:
    """Return a masked DB URL that NEVER echoes any password byte.

    SECURITY BOUNDARY. The guarantee here does not depend on urlparse
    correctly extracting fields (urlparse silently mis-parses many
    malformed URLs and can leave credentials in `.path`/`.netloc`).

    Strategy (no step trusts urlparse for the security guarantee):
      1. Split scheme from the rest at `://`.
      2. Key invariant: a host name and a URL path never contain `@`,
         but a password legitimately can (and can also contain `/`).
         Therefore the LAST `@` in the post-scheme string is always the
         userinfo terminator. Everything up to and including that last
         `@` is userinfo and is replaced wholesale with `***@`. No
         password byte (even one containing `@`, `/`, `:`, `+`) can
         survive, because we keep only the substring AFTER the last `@`.
      3. From that host/path remainder, split host[:port] from the db
         name at the first `/?#`. If the host region still contains an
         `@`, or urlparse of the reconstruction reports a password, or
         the input is otherwise malformed, return the fully-redacted
         `postgresql://***@***/***`.

    No input (password containing @ / + : , no port, ?sslmode=require,
    IPv6 host, or total garbage) may leak a password byte.
    """
    fully_redacted = "postgresql://***@***/***"
    try:
        scheme_split = url.split("://", 1)
        if len(scheme_split) != 2:
            return fully_redacted
        scheme, rest = scheme_split
        scheme = scheme or "postgresql"

        # The LAST '@' in `rest` is the userinfo terminator: host and
        # path never contain '@', a password may. Keep only what's
        # after it -> no password byte can survive.
        if "@" in rest:
            host_and_path = rest.rsplit("@", 1)[1]
        else:
            host_and_path = rest

        if "@" in host_and_path:  # defensive; rsplit guarantees none
            return fully_redacted

        # host[:port] = up to the first path/query/fragment delimiter.
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
        # Independent verification: the masked reconstruction must not
        # surface a password under urlparse either.
        if urlparse(candidate).password is not None:
            return fully_redacted
        return candidate
    except Exception:
        return fully_redacted


def validate_env() -> list[str]:
    """Return required env vars that are missing OR present-but-empty.

    Present-but-empty is treated as missing: safer for a gate. All five
    are required; no legacy var is exempted from the non-empty rule.
    """
    return [v for v in REQUIRED_ENV if not os.environ.get(v)]


def connect_legacy() -> "pymysql.connections.Connection":
    """Open the legacy MariaDB connection from LEGACY_DB_* env vars."""
    return pymysql.connect(
        host=os.environ["LEGACY_DB_HOST"],
        user=os.environ["LEGACY_DB_USER"],
        password=os.environ["LEGACY_DB_PASSWORD"],
        database=os.environ["LEGACY_DB_NAME"],
        cursorclass=pymysql.cursors.Cursor,
        connect_timeout=10,
    )


def connect_destination():
    """Open the destination Postgres connection from SUPABASE_DB_URL.

    autocommit=True so a failed statement on one check does not poison
    the connection for subsequent checks (no aborted-transaction state).
    """
    conn = psycopg2.connect(os.environ["SUPABASE_DB_URL"], connect_timeout=10)
    conn.autocommit = True
    return conn


def _fetch_values(cursor, query: str) -> list[str]:
    """Run query, return trimmed non-empty string values.

    Uniform normalization across ALL checks (legacy + destination):
    skip None, str()-coerce, .strip(), skip anything empty after strip.
    Prevents phantom "" gaps and whitespace-variant false gaps against
    dirty legacy data.
    """
    cursor.execute(query)
    out: list[str] = []
    for row in cursor.fetchall():
        value = row[0]
        if value is None:
            continue
        text = str(value).strip()
        if not text:
            continue
        out.append(text)
    return out


def _is_fatal_dest_connection_loss(exc: Exception, dest_conn) -> bool:
    """True if a destination-side exception means the connection is dead.

    Fatal = a dropped/dead Postgres connection (pooler idle drop, network
    blip), NOT a query-level fault. Query faults (UndefinedTable, syntax,
    permission) are psycopg2.ProgrammingError subclasses and stay per-check
    errors so SCEN-006-style isolation is preserved.

    Signals:
      - psycopg2.OperationalError / psycopg2.InterfaceError (connection-level)
      - the connection object reports itself closed (conn.closed != 0)
    psycopg2.ProgrammingError is explicitly NOT fatal even though it can be a
    subclass relationship in some drivers -- check it first and bail out.
    """
    if isinstance(exc, psycopg2.ProgrammingError):
        return False
    if isinstance(exc, (psycopg2.OperationalError, psycopg2.InterfaceError)):
        return True
    try:
        if getattr(dest_conn, "closed", 0):
            return True
    except Exception:
        # A connection object that raises even on .closed is itself dead.
        return True
    return False


def run_check(check: Check, legacy_cur, dest_conn) -> CheckResult:
    """Run both sides of a check in isolation. A query-level failure on
    either side populates result.error and does NOT abort the run. A FATAL
    destination connection loss raises DestinationConnectionLost so main()
    can abort with EXIT_CONNECTION (the connection is dead for every
    remaining DB-backed check; per-check isolation no longer applies)."""
    result = CheckResult(name=check.name, description=check.description)

    try:
        legacy_values = sorted(set(_fetch_values(legacy_cur, check.legacy_query)))
    except Exception as exc:
        result.error = f"legacy query failed for '{check.name}': {exc}"
        result.passed = False
        return result

    if check.static_destination is not None:
        dest_values = sorted(check.static_destination)
    else:
        try:
            # cursor() itself can raise on a dead connection; keep it
            # inside the try so a query-level fault is recorded as this
            # check's error rather than propagating as an uncaught
            # exception. A FATAL connection loss is re-raised below.
            dest_cur = dest_conn.cursor()
            try:
                dest_values = sorted(
                    set(_fetch_values(dest_cur, check.destination_query))
                )
            finally:
                try:
                    dest_cur.close()
                except Exception:
                    pass
        except Exception as exc:
            if _is_fatal_dest_connection_loss(exc, dest_conn):
                # Not this check's fault: the destination is gone for every
                # remaining DB-backed check. Abort the whole run. Carry only
                # the exception class name -- never the body or DSN.
                raise DestinationConnectionLost(type(exc).__name__) from None
            result.error = f"destination query failed for '{check.name}': {exc}"
            result.passed = False
            return result

    legacy_set = set(legacy_values)
    dest_set = set(dest_values)
    gaps = sorted(legacy_set - dest_set)

    result.legacy_values = legacy_values
    result.destination_values = dest_values
    result.legacy_count = len(legacy_values)
    result.destination_count = len(dest_values)
    result.gaps = gaps
    result.passed = len(gaps) == 0 and result.error is None
    return result


def output_path(filename_stamp: str) -> tuple[Path, Path]:
    """Return (primary, fallback) report paths for a filesystem-safe stamp."""
    repo_root = Path(__file__).resolve().parents[2]
    primary = repo_root / "docs" / "migration-runs" / f"preflight-{filename_stamp}.json"
    fallback = Path("/tmp") / f"preflight-{filename_stamp}.json"
    return primary, fallback


def build_report(
    results: list[CheckResult], timestamp: str, dest_source_masked: str
) -> dict:
    legacy_name = os.environ.get("LEGACY_DB_NAME", "?")
    legacy_host = os.environ.get("LEGACY_DB_HOST", "?")
    return {
        "timestamp": timestamp,
        "legacy_source": f"mariadb://{legacy_host}/{legacy_name}",
        "destination_source": dest_source_masked,
        "passed": all(r.passed for r in results),
        "checks": [asdict(r) for r in results],
    }


def _atomic_write(target: Path, payload: str) -> None:
    """Write payload to target atomically (temp file in same dir + os.replace).

    A reader or a crash never observes a partial/corrupt JSON.
    """
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


def write_json_report(report: dict, filename_stamp: str) -> bool:
    """Write the report to the primary path, falling back to /tmp.

    Both writes are atomic. Returns True if written somewhere, False if
    both paths failed.
    """
    primary, fallback = output_path(filename_stamp)
    payload = json.dumps(report, indent=2, ensure_ascii=False, sort_keys=False)

    try:
        _atomic_write(primary, payload)
        print(f"Report written: {primary}")
        return True
    except OSError as exc:
        print(
            f"WARNING: could not write report to {primary} ({exc}); "
            f"falling back to {fallback}",
            file=sys.stderr,
        )

    try:
        _atomic_write(fallback, payload)
        print(f"Report written (fallback): {fallback}")
        return True
    except OSError as exc:
        print(
            f"ERROR: could not write report to fallback {fallback} ({exc})",
            file=sys.stderr,
        )
        return False


def print_stdout_summary(results: list[CheckResult]) -> None:
    header = f"{'name':<22} {'legacy':>7} {'dest':>6} {'gaps':>5}  status"
    print(header)
    print("-" * len(header))
    for r in results:
        if r.error is not None:
            status = "ERROR"
        elif r.passed:
            status = "PASS"
        else:
            status = "FAIL"
        print(
            f"{r.name:<22} {r.legacy_count:>7} {r.destination_count:>6} "
            f"{len(r.gaps):>5}  {status}"
        )


def _close(conn) -> None:
    """Best-effort close; never raises."""
    if conn is None:
        return
    try:
        conn.close()
    except Exception:
        pass


def _connect_both(dest_source_masked: str):
    """Connect legacy first, then destination.

    Returns (legacy_conn, dest_conn) on success, or None on the first
    failure (legacy-first ordering; destination is never attempted if
    legacy failed). The destination message uses the MASKED url.
    """
    try:
        legacy_conn = connect_legacy()
    except Exception as exc:
        # Sanitized: a driver's exception body can echo the DSN
        # (LEGACY_DB_PASSWORD). Print only the exception type.
        print(
            f"legacy connection failed: {type(exc).__name__}",
            file=sys.stderr,
        )
        return None

    try:
        dest_conn = connect_destination()
    except Exception as exc:
        # Sanitized: psycopg2's OperationalError body contains the full
        # unmasked SUPABASE_DB_URL incl. password. Print only the masked
        # URL and the exception type -- never the exception body.
        print(
            f"destination connection failed for {dest_source_masked}: "
            f"{type(exc).__name__}",
            file=sys.stderr,
        )
        _close(legacy_conn)
        return None

    return legacy_conn, dest_conn


def main() -> int:
    dotenv.load_dotenv()

    missing = validate_env()
    if missing:
        print(
            "Missing or empty required environment variable(s): "
            + ", ".join(missing),
            file=sys.stderr,
        )
        return EXIT_ENV_MISSING

    dest_source_masked = mask_db_url(os.environ["SUPABASE_DB_URL"])

    conns = _connect_both(dest_source_masked)
    if conns is None:
        return EXIT_CONNECTION
    legacy_conn, dest_conn = conns

    try:
        legacy_cur = legacy_conn.cursor()
        try:
            results = [run_check(c, legacy_cur, dest_conn) for c in CHECKS]
        except DestinationConnectionLost as exc:
            # Destination died mid-run: every remaining DB-backed check
            # would fail the same way. Abort with EXIT_CONNECTION BEFORE
            # any report is written (SCEN-004 semantics: connection
            # failure => no JSON). Sanitized: only the class name.
            print(
                f"destination connection lost during checks: {exc}",
                file=sys.stderr,
            )
            return EXIT_CONNECTION
        finally:
            try:
                legacy_cur.close()
            except Exception:
                pass
    finally:
        _close(legacy_conn)
        _close(dest_conn)

    now = datetime.now(timezone.utc)
    # Microsecond precision so two back-to-back runs never collide.
    iso = now.isoformat().replace("+00:00", "Z")
    timestamp = iso  # JSON keeps standard ISO form with ':'
    filename_stamp = iso.replace(":", "-")  # filesystem-safe across OSes
    report = build_report(results, timestamp, dest_source_masked)
    report_written = write_json_report(report, filename_stamp)
    print_stdout_summary(results)

    any_error = any(r.error is not None for r in results)
    any_gaps = any(len(r.gaps) > 0 for r in results)

    # Report-write failure DOMINATES: without durable gating evidence the
    # operator cannot trust any pass/fail conclusion ("ningún silencio").
    # A successful /tmp fallback counts as written (report_written True) and
    # does NOT trip this; code 5 fires only when BOTH paths failed.
    if not report_written:
        return EXIT_REPORT_FAILED
    if any_error:
        return EXIT_QUERY_ERROR
    if any_gaps:
        return EXIT_GAPS
    return EXIT_OK


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as exc:
        # A crash must never surface as Python's default exit 1
        # (== EXIT_GAPS). Sanitize: never print exc body -- it may
        # contain a connection string / password.
        print(f"unexpected error: {type(exc).__name__}", file=sys.stderr)
        sys.exit(EXIT_UNEXPECTED)
