#!/usr/bin/env python3
"""Size the legacy search-history table before any extraction (issue #45, Phase 1).

Read-only. Dimensions the legacy MySQL/MariaDB table
`log_veh_available_rates_queries` so the Phase-2 extraction method can be chosen
against real numbers — WITHOUT risking a blocking scan (a prior `SELECT *` crashed
prod legacy once; the >3-month prune never ran, so the real volume is unknown).

Strategy (tiered, least-invasive first), all under a server-side
`SET SESSION max_statement_time` kill-switch that the SERVER enforces:
  1. metadata     `information_schema` → approx rows + byte size      (zero table access)
  2. temporal span PK proxy: first/last row by `id`                   (two PK seeks, O(1))
  3. exact count  `COUNT(*)`                                          (PK-index scan, time-boxed)
  4. exact range  `MIN/MAX(created_at)`  (opt-in, `--exact-range`)    (full scan, time-boxed)

If the kill-switch does not take effect (old server / unsupported), tiers 3-4 are
SKIPPED — never run unprotected. A tier the server time-boxes is a FINDING (null +
`timed_out_after_s`), not a failure: the run still exits 0.

Connection is via an SSH tunnel to prod legacy; point `LEGACY_DB_HOST=127.0.0.1`
and `LEGACY_DB_PORT=<tunnel local port>`. The destination Supabase is NOT touched —
this script writes nothing anywhere except its own PII-free JSON report.

The pure functions (`validate_env`, `format_bytes`, `build_summary`) import and run
on bare Python with NO pymysql installed: the driver is imported LAZILY inside
`connect_legacy()` only. Issue #45. Scaffolding mirrors `etl-customers.py` (#19).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

# --------------------------------------------------------------------------- #
# Exit-code contract (mirror of etl-customers.py; no commit/gate → no 7).
# --------------------------------------------------------------------------- #
EXIT_OK = 0
EXIT_CONNECTION = 2
EXIT_QUERY_ERROR = 3
EXIT_ENV_MISSING = 4
EXIT_REPORT_FAILED = 5
EXIT_UNEXPECTED = 6

# The four LEGACY_DB_* credential vars. LEGACY_DB_PORT is OPTIONAL (default 3306,
# for the SSH tunnel's local port) and is intentionally NOT required here — a run
# must not fail "env-missing" just because the default port is implicit.
REQUIRED_ENV = [
    "LEGACY_DB_HOST",
    "LEGACY_DB_USER",
    "LEGACY_DB_PASSWORD",
    "LEGACY_DB_NAME",
]

# The table under study (constant, never user input — safe to inline with backticks).
TABLE = "log_veh_available_rates_queries"

# MariaDB statement-timeout error code (ER_STATEMENT_TIMEOUT); MySQL uses 3024.
TIMEOUT_ERRNOS = {1969, 3024}

# The complete allowed key surface of the committable report. Anything outside this
# set would be a structural change; a per-row payload key (PII) can never appear.
ALLOWED_REPORT_KEYS = {
    "table", "schema", "generated_at", "kill_switch",
    "approx_rows", "data_bytes", "index_bytes", "total_bytes",
    "data_free_bytes", "avg_row_bytes", "engine",
    "first_id", "last_id", "first_created_at", "last_created_at", "span_source",
    "exact_rows", "exact_range", "notes",
}


# --------------------------------------------------------------------------- #
# Pure helpers — testable on bare Python.
# --------------------------------------------------------------------------- #
def validate_env() -> list[str]:
    """Return required LEGACY_DB_* vars that are missing OR present-but-empty."""
    return [v for v in REQUIRED_ENV if not os.environ.get(v)]


def format_bytes(n: int | None) -> str:
    """Humanize a byte count (binary units). None → 'n/a'."""
    if n is None:
        return "n/a"
    if n < 1024:
        return f"{n} B"
    units = ["KiB", "MiB", "GiB", "TiB", "PiB"]
    size = float(n)
    for unit in units:
        size /= 1024.0
        if size < 1024.0:
            return f"{size:.1f} {unit}"
    return f"{size:.1f} EiB"


def mask_host(host: str) -> str:
    """Mask a hostname for error output. Local tunnel ends are not secret; a real
    endpoint is reduced to a non-identifying stub. Credentials are NEVER printed."""
    if host in ("127.0.0.1", "localhost", "::1"):
        return host
    if len(host) <= 6:
        return "***"
    return host[:4] + "***"


def build_summary(measured: dict, *, generated_at: str) -> dict:
    """Assemble the committable report dict from the raw measured values.

    Pure: applies the kill-switch gating and timeout/skip shaping, computes derived
    totals, and emits ONLY keys in ALLOWED_REPORT_KEYS (never a row payload). The
    scanning tiers (exact count / exact range) are rendered as skipped when the
    kill-switch is unconfirmed, regardless of any value passed in.
    """
    md = measured.get("metadata") or {}
    span = measured.get("span") or {}
    confirmed = bool(measured.get("kill_switch_confirmed"))
    budget = measured.get("budget_s")
    notes: list[str] = []

    data_bytes = md.get("data_bytes")
    index_bytes = md.get("index_bytes")
    total_bytes = None
    if data_bytes is not None or index_bytes is not None:
        total_bytes = (data_bytes or 0) + (index_bytes or 0)

    # Exact count gating.
    if not confirmed:
        exact_rows = {"skipped": "kill_switch_unconfirmed"}
        notes.append("exact count skipped: kill_switch_unconfirmed (max_statement_time "
                     "did not take effect; refusing an unprotected COUNT)")
    else:
        ec = measured.get("exact_count")
        if ec is None:
            exact_rows = {"skipped": "not_attempted"}
        else:
            exact_rows = ec
            if ec.get("value") is None and "timed_out_after_s" in ec:
                notes.append(f"exact count timed out after {ec['timed_out_after_s']}s "
                             "(table too large for an exact count within budget; rely "
                             "on approx_rows)")

    # Exact range gating.
    if not measured.get("exact_range_requested"):
        exact_range = {"skipped": "not_requested"}
    elif not confirmed:
        exact_range = {"skipped": "kill_switch_unconfirmed"}
    else:
        er = measured.get("exact_range")
        exact_range = er if er is not None else {"skipped": "not_attempted"}
        if isinstance(er, dict) and er.get("min") is None and "timed_out_after_s" in er:
            notes.append(f"exact range timed out after {er['timed_out_after_s']}s")

    if confirmed:
        notes.append(f"kill_switch confirmed: max_statement_time={budget}s in force")

    return {
        "table": measured.get("table", TABLE),
        "schema": measured.get("schema"),
        "generated_at": generated_at,
        "kill_switch": {
            "confirmed": confirmed,
            "budget_s": budget,
            "max_statement_time_readback": measured.get("max_statement_time_readback"),
        },
        "approx_rows": md.get("approx_rows"),
        "data_bytes": data_bytes,
        "index_bytes": index_bytes,
        "total_bytes": total_bytes,
        "data_free_bytes": md.get("data_free_bytes"),
        "avg_row_bytes": md.get("avg_row_bytes"),
        "engine": md.get("engine"),
        "first_id": span.get("first_id"),
        "last_id": span.get("last_id"),
        "first_created_at": span.get("first_created_at"),
        "last_created_at": span.get("last_created_at"),
        "span_source": "pk_proxy",
        "exact_rows": exact_rows,
        "exact_range": exact_range,
        "notes": notes,
    }


def format_summary_table(rep: dict) -> str:
    """Human-readable stdout summary of the report dict."""
    ks = rep.get("kill_switch") or {}
    rows_metric = rep.get("exact_rows") or {}
    if "value" in rows_metric and rows_metric["value"] is not None:
        exact = f"{rows_metric['value']:,}"
    elif "timed_out_after_s" in rows_metric:
        exact = f"TIMED OUT (>{rows_metric['timed_out_after_s']}s) — use approx"
    elif "skipped" in rows_metric:
        exact = f"SKIPPED ({rows_metric['skipped']})"
    else:
        exact = "n/a"

    approx = rep["approx_rows"]
    approx_s = f"~{approx:,}" if isinstance(approx, int) else "n/a"

    lines = [
        f"Legacy table sizing — {rep['schema']}.{rep['table']}",
        f"  engine            : {rep.get('engine') or 'n/a'}",
        f"  approx rows       : {approx_s}   (information_schema.TABLE_ROWS, approximate)",
        f"  exact rows        : {exact}",
        f"  data size         : {format_bytes(rep.get('data_bytes'))}",
        f"  index size        : {format_bytes(rep.get('index_bytes'))}",
        f"  total size        : {format_bytes(rep.get('total_bytes'))}",
        f"  temporal span     : {rep.get('first_created_at')}  →  {rep.get('last_created_at')}"
        f"   (id {rep.get('first_id')} → {rep.get('last_id')}, pk_proxy)",
        f"  kill-switch       : {'CONFIRMED' if ks.get('confirmed') else 'UNCONFIRMED'}"
        f"  (max_statement_time={ks.get('max_statement_time_readback')}s, budget {ks.get('budget_s')}s)",
    ]
    rng = rep.get("exact_range") or {}
    if "timed_out_after_s" in rng:
        lines.append(f"  exact range       : TIMED OUT (>{rng['timed_out_after_s']}s)")
    elif rng.get("min") is not None or rng.get("max") is not None:
        lines.append(f"  exact range       : {rng.get('min')}  →  {rng.get('max')}")
    notes = rep.get("notes") or []
    if notes:
        lines.append("  notes:")
        lines.extend(f"    - {n}" for n in notes)
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Atomic report write — same contract as etl-customers.py (single JSON object).
# --------------------------------------------------------------------------- #
def _atomic_write(target: Path, payload: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(target.parent), prefix=target.name + ".", suffix=".tmp")
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


def report_paths(stamp: str) -> tuple[Path, Path]:
    repo_root = Path(__file__).resolve().parents[2]
    primary = repo_root / "docs" / "migration-runs" / f"size-log-veh-{stamp}.json"
    fallback = Path("/tmp") / f"size-log-veh-{stamp}.json"
    return primary, fallback


def write_report(rep: dict, stamp: str) -> Path | None:
    """Write the report JSON atomically; fall back to /tmp. None if both fail."""
    primary, fallback = report_paths(stamp)
    payload = json.dumps(rep, ensure_ascii=False, indent=2) + "\n"
    for target, label in ((primary, "Report"), (fallback, "Report (fallback)")):
        try:
            _atomic_write(target, payload)
            print(f"{label} written: {target}")
            return target
        except OSError as exc:
            print(f"WARNING: could not write report to {target} ({exc})", file=sys.stderr)
    print("ERROR: could not write report to ANY path", file=sys.stderr)
    return None


# --------------------------------------------------------------------------- #
# DB connection + session safety — LAZY driver import (module imports bare).
# --------------------------------------------------------------------------- #
def connect_legacy(read_timeout: int | None = None):
    """Open the legacy MySQL/MariaDB connection (read-only use). Lazy pymysql.

    Honors optional LEGACY_DB_PORT (default 3306) for the SSH tunnel's local port.
    `read_timeout` is a CLIENT-side per-statement ceiling (seconds): defense in
    depth so no single query can hang the script even if the server-side
    `max_statement_time` kill-switch is unconfirmed (e.g. non-MariaDB). It bounds
    every tier, including the metadata/PK tiers that run before the kill-switch is
    verified. `connect_timeout` only bounds connection establishment, not queries.
    """
    import pymysql  # lazy: keep module importable without the driver.

    port = int(os.environ.get("LEGACY_DB_PORT") or 3306)
    return pymysql.connect(
        host=os.environ["LEGACY_DB_HOST"],
        port=port,
        user=os.environ["LEGACY_DB_USER"],
        password=os.environ["LEGACY_DB_PASSWORD"],
        database=os.environ["LEGACY_DB_NAME"],
        cursorclass=pymysql.cursors.Cursor,
        connect_timeout=10,
        read_timeout=read_timeout,
    )


def configure_session(conn, budget_s: int) -> tuple[bool, float]:
    """Make the session read-only and arm the server-side statement timeout.

    Returns (kill_switch_confirmed, max_statement_time_readback). Confirmed means
    the server accepted `max_statement_time` and it read back at the budget — the
    hard non-blocking guarantee. If the server does not support it (e.g. not
    MariaDB), confirmed is False and the caller skips the scanning tiers.
    """
    cur = conn.cursor()
    try:
        try:
            cur.execute("SET SESSION TRANSACTION READ ONLY")
        except Exception:
            pass  # not fatal — the script issues no writes regardless.
        try:
            # The metadata tier reads information_schema.TABLES; with this ON, that
            # read can trigger an InnoDB stats recompute that opens the table files.
            # On this never-pruned 28.7 GiB table that recompute can be expensive,
            # so disable it for the session. MariaDB ignores an unknown var → no-op.
            cur.execute("SET SESSION innodb_stats_on_metadata = 0")
        except Exception:
            pass  # non-fatal — a server without this var just runs the default.
        try:
            cur.execute(f"SET SESSION max_statement_time = {int(budget_s)}")
            cur.execute("SELECT @@max_statement_time")
            row = cur.fetchone()
            readback = float(row[0]) if row and row[0] is not None else 0.0
        except Exception:
            return False, 0.0
        confirmed = readback > 0 and abs(readback - float(budget_s)) < 0.5
        return confirmed, readback
    finally:
        cur.close()


def _is_timeout(exc) -> bool:
    """True only for a server statement-timeout abort — NOT for other errors.

    The errno check (1969 MariaDB / 3024 MySQL) is authoritative and always
    accompanies a real timeout. The message fallback is deliberately narrow:
    a bare `"exceeded"` would misclassify resource-limit errors like
    `ER_USER_LIMIT_REACHED` ("...has exceeded the 'max_questions' resource...",
    errno 1226) as a benign timeout finding and hide a real failure behind exit 0.
    """
    code = exc.args[0] if getattr(exc, "args", None) else None
    if code in TIMEOUT_ERRNOS:
        return True
    msg = (str(exc) or "").lower()
    return (
        "max_statement_time" in msg
        or "statement timeout" in msg
        or "maximum statement execution time exceeded" in msg
    )


# --------------------------------------------------------------------------- #
# Tiered queries.
# --------------------------------------------------------------------------- #
def query_metadata(conn, schema: str) -> dict:
    """Tier 1 — information_schema only, zero table access."""
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH, DATA_FREE, AVG_ROW_LENGTH, ENGINE "
            "FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s",
            (schema, TABLE),
        )
        row = cur.fetchone()
        if not row:
            raise RuntimeError(f"table {schema}.{TABLE} not found in information_schema")
        return {
            "approx_rows": int(row[0]) if row[0] is not None else None,
            "data_bytes": int(row[1]) if row[1] is not None else None,
            "index_bytes": int(row[2]) if row[2] is not None else None,
            "data_free_bytes": int(row[3]) if row[3] is not None else None,
            "avg_row_bytes": int(row[4]) if row[4] is not None else None,
            "engine": row[5],
        }
    finally:
        cur.close()


def query_span(conn) -> dict:
    """Tier 2 — first/last row by PK (O(1) index seeks). created_at as proxy span."""
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT id, created_at FROM `{TABLE}` ORDER BY id ASC LIMIT 1")
        first = cur.fetchone()
        cur.execute(f"SELECT id, created_at FROM `{TABLE}` ORDER BY id DESC LIMIT 1")
        last = cur.fetchone()
        # Guard the COLUMN value, not just row presence: a present boundary row with
        # a NULL created_at must serialize as JSON null, never the string "None".
        return {
            "first_id": int(first[0]) if first else None,
            "first_created_at": str(first[1]) if first and first[1] is not None else None,
            "last_id": int(last[0]) if last else None,
            "last_created_at": str(last[1]) if last and last[1] is not None else None,
        }
    finally:
        cur.close()


def _run_protected_scan(conn, sql, on_ok, timeout_result):
    """Run one budget-protected scanning query.

    A server statement-timeout becomes a FINDING (returns `timeout_result`); any
    other OperationalError re-raises so the caller surfaces it as exit 3. The
    server-side `max_statement_time` and the client `read_timeout` both bound it —
    this single place owns the load-bearing timeout-vs-error decision.
    """
    import pymysql  # lazy; only for the exception type.
    cur = conn.cursor()
    try:
        cur.execute(sql)
        return on_ok(cur.fetchone())
    except pymysql.err.OperationalError as exc:
        if _is_timeout(exc):
            return timeout_result
        raise
    finally:
        cur.close()


def query_exact_count(conn, budget_s: int) -> dict:
    """Tier 3 — exact COUNT(*), protected by the budget."""
    return _run_protected_scan(
        conn,
        f"SELECT COUNT(*) FROM `{TABLE}`",
        lambda row: {"value": int(row[0])},
        {"value": None, "timed_out_after_s": budget_s},
    )


def query_exact_range(conn, budget_s: int) -> dict:
    """Tier 4 — exact MIN/MAX(created_at), full scan, protected by the budget."""
    return _run_protected_scan(
        conn,
        f"SELECT MIN(created_at), MAX(created_at) FROM `{TABLE}`",
        lambda row: {"min": str(row[0]) if row and row[0] is not None else None,
                     "max": str(row[1]) if row and row[1] is not None else None},
        {"min": None, "max": None, "timed_out_after_s": budget_s},
    )


# --------------------------------------------------------------------------- #
# Orchestration.
# --------------------------------------------------------------------------- #
def run(args) -> int:
    missing = validate_env()
    if missing:
        print(f"ERROR: missing/empty required env var(s): {', '.join(missing)}", file=sys.stderr)
        return EXIT_ENV_MISSING

    schema = os.environ["LEGACY_DB_NAME"]
    host = os.environ["LEGACY_DB_HOST"]
    port = os.environ.get("LEGACY_DB_PORT") or "3306"

    # Client-side per-statement ceiling: defense in depth even if the server-side
    # kill-switch is unconfirmed. A FIXED +60s margin over the budget guarantees the
    # server-side max_statement_time (= budget) always wins the race and aborts a
    # scan with errno 1969/3024 (a timeout FINDING, exit 0) before this socket
    # timeout fires as a CR_SERVER_LOST (2013) the timeout-classifier can't see —
    # which would surface a budgeted scan as a hard query error (exit 3). A genuine
    # connection drop still trips this ceiling and correctly surfaces as an error.
    read_timeout = args.budget + 60
    try:
        conn = connect_legacy(read_timeout=read_timeout)
    except Exception as exc:
        print(f"ERROR: legacy MySQL connection failed (host {mask_host(host)}, port {port}); "
              f"check the SSH tunnel and credentials. [{type(exc).__name__}]", file=sys.stderr)
        return EXIT_CONNECTION

    try:
        confirmed, readback = configure_session(conn, args.budget)

        try:
            metadata = query_metadata(conn, schema)
            span = query_span(conn)
        except Exception as exc:
            print(f"ERROR: sizing query failed [{type(exc).__name__}]", file=sys.stderr)
            return EXIT_QUERY_ERROR

        exact_count = None
        exact_range = None
        if confirmed:
            try:
                exact_count = query_exact_count(conn, args.budget)
                if args.exact_range:
                    exact_range = query_exact_range(conn, args.budget)
            except Exception as exc:
                # A real (non-timeout) error on a scanning tier is a query error.
                print(f"ERROR: scanning query failed [{type(exc).__name__}]", file=sys.stderr)
                return EXIT_QUERY_ERROR
        else:
            print("WARNING: max_statement_time did not take effect — skipping the "
                  "scanning tiers (exact count / range) to stay non-blocking.", file=sys.stderr)

        measured = {
            "table": TABLE,
            "schema": schema,
            "budget_s": args.budget,
            "kill_switch_confirmed": confirmed,
            "max_statement_time_readback": readback,
            "metadata": metadata,
            "span": span,
            "exact_count": exact_count,
            "exact_range_requested": bool(args.exact_range),
            "exact_range": exact_range,
        }
    finally:
        try:
            conn.close()
        except Exception:
            pass

    now = datetime.now(timezone.utc)
    generated_at = now.isoformat()
    stamp = now.strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    rep = build_summary(measured, generated_at=generated_at)

    if write_report(rep, stamp) is None:
        return EXIT_REPORT_FAILED

    print(format_summary_table(rep))
    return EXIT_OK


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Read-only sizing of the legacy log_veh table (issue #45 Phase 1).",
        epilog=("Exit codes: 0 ok · 2 connection · 3 query error · 4 env missing · "
                "5 report not written · 6 unexpected."),
    )
    parser.add_argument("--budget", type=int, default=15,
                        help="server-side max_statement_time in seconds (default 15)")
    parser.add_argument("--exact-range", action="store_true",
                        help="also run exact MIN/MAX(created_at) (full scan, time-boxed); "
                             "default off — the PK proxy span is used instead")
    args = parser.parse_args(argv)

    # Enforce the kill-switch invariant in code, not by convention: MariaDB treats
    # max_statement_time = 0 as UNLIMITED, so a 0/negative budget would disarm the
    # only thing stopping a blocking scan. Cap the upper end too so a fat-fingered
    # huge budget can't quietly defeat the non-blocking guarantee.
    if args.budget < 1 or args.budget > 300:
        print("ERROR: --budget must be between 1 and 300 seconds "
              "(0 disables the MariaDB kill-switch; >300 is never needed for sizing).",
              file=sys.stderr)
        return EXIT_ENV_MISSING

    try:
        return run(args)
    except Exception as exc:  # sanitized — never echo the message body.
        print(f"ERROR: unexpected failure [{type(exc).__name__}]", file=sys.stderr)
        return EXIT_UNEXPECTED


if __name__ == "__main__":
    sys.exit(main())
