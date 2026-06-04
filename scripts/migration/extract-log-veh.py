#!/usr/bin/env python3
"""Autonomous, resumable raw extraction of legacy `log_veh` (issue #45, Phase 2).

Produces a faithful 1:1 raw archive of `log_veh_available_rates_queries`
(~657,984 rows / 28.7 GiB, Aurora MariaDB 10.11.15) as gzipped per-PK-range
`mysqldump` chunks plus a PII-free manifest, reached over a driver-owned SSH
tunnel through the EC2 `rentacar`. Read-only on the source; never writes to
`public.search_logs`.

Structure (the testability contract — see the plan/design):
  * PURE functions at module top — range planning over a FROZEN
    `[min_id, max_id_frozen]`, manifest read/merge + resume-skip, the exact
    three-part completeness verdict, the `^INSERT INTO` row counter, the
    `--defaults-extra-file` builder (password never on argv), the mysqldump
    command builder, the `SHOW CREATE TABLE` parser, the append-only gate
    decision, host masking, status-file shaping, and the watchdog/deadline loop
    (driven by an INJECTED clock + INJECTED chunk-runner). All unit-tested on
    bare Python (NO pymysql / NO mysqldump / NO ssh).
  * Thin IO wrappers below — `fetch_legacy_creds`, `connect_legacy`, the live
    `dump_chunk`, `run` orchestration — validated against prod legacy in Step 10.

Reuses Phase-1 scaffolding (`size-log-veh.py`): lazy pymysql import, atomic
writes, host masking, exit-code style. The mysqldump subprocess + tunnel
ownership (`_tunnel.py`) are new.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

# --------------------------------------------------------------------------- #
# Exit-code contract (from the design §6 — distinct codes so an unattended
# monitor can act on each without parsing the manifest).
# --------------------------------------------------------------------------- #
EXIT_OK = 0
EXIT_CONNECTION = 2          # connection / credential-fetch (ssh/sudo) failure
EXIT_TUNNEL_OR_QUERY = 3     # tunnel unrecoverable after N relaunches OR real query error
EXIT_APPEND_ONLY = 4         # append-only precondition failed, no --allow-eventual
EXIT_RUN_DEADLINE = 5        # global RUN_DEADLINE breached (resumable)
EXIT_COMPLETENESS = 6        # ran to the end, verdict complete:false (investigate)

# The table under study (constant, never user input — safe to inline with backticks).
TABLE = "log_veh_available_rates_queries"

# The five DB_* keys the driver extracts from the legacy Laravel .env. The fetch
# discards everything else immediately — the .env blob is never logged/returned whole.
LEGACY_ENV_KEYS = ("DB_HOST", "DB_PORT", "DB_DATABASE", "DB_USERNAME", "DB_PASSWORD")

# One INSERT statement per row because the dump uses --skip-extended-insert. This
# matches a statement START anchored at line start, so a `),(` or a quoted
# `INSERT INTO` substring INSIDE a value can never inflate the count (N1).
_INSERT_LINE_RE = re.compile(rb"^INSERT INTO `" + re.escape(TABLE.encode()) + rb"`")


# =========================================================================== #
# Pure: PK-range planner over a FROZEN [min_id, max_id_frozen].
# =========================================================================== #
def plan_ranges(min_id: int, max_id_frozen: int, chunk_rows: int) -> list[dict]:
    """Partition the inclusive id interval [min_id, max_id_frozen] into windows.

    Each window spans `chunk_rows` ID VALUES (not row counts — id gaps from the
    historical prune simply yield sparser/empty windows). The windows partition
    the interval EXACTLY: contiguous, no gap, no overlap, covering every id from
    `min_id` to `max_id_frozen` inclusive. Returns `[{seq, id_lo, id_hi}]`,
    1-based seq. The plan is computed once from the frozen bounds and is stable
    across resumes (never re-sampled mid-run).
    """
    if chunk_rows < 1:
        raise ValueError("chunk_rows must be >= 1")
    if max_id_frozen < min_id:
        return []
    ranges: list[dict] = []
    seq = 1
    lo = min_id
    while lo <= max_id_frozen:
        hi = min(lo + chunk_rows - 1, max_id_frozen)
        ranges.append({"seq": seq, "id_lo": lo, "id_hi": hi})
        seq += 1
        lo = hi + 1
    return ranges


# =========================================================================== #
# Pure: manifest model (load / merge / resume-skip) — N2 cold-start.
# =========================================================================== #
def empty_manifest() -> dict:
    """A manifest with ZERO verified chunks. The shape resume relies on."""
    return {"chunks": []}


def load_manifest(path) -> dict:
    """Read the manifest; on ANY problem return an empty manifest (never raise).

    Cold-start contract (N2): a missing file -> empty manifest; a truncated or
    invalid-JSON file -> ZERO verified chunks. The manifest is the SOLE source of
    verified-ness, so partial/corrupt content is NEVER trusted — resume then
    re-dumps every range via `.partial` + atomic rename. A structurally valid
    JSON that is missing `chunks`, or whose `chunks` is not a list, is also
    treated as empty rather than guessed.
    """
    p = Path(path)
    try:
        raw = p.read_text(encoding="utf-8")
    except (OSError, FileNotFoundError):
        return empty_manifest()
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return empty_manifest()
    if not isinstance(data, dict) or not isinstance(data.get("chunks"), list):
        return empty_manifest()
    return data


def _chunk_index(manifest: dict) -> dict:
    """Map (id_lo, id_hi) -> chunk entry for the verified chunks in the manifest."""
    idx: dict[tuple[int, int], dict] = {}
    for c in manifest.get("chunks", []):
        if not isinstance(c, dict):
            continue
        lo, hi = c.get("id_lo"), c.get("id_hi")
        if lo is None or hi is None:
            continue
        idx[(int(lo), int(hi))] = c
    return idx


def merge_chunk(manifest: dict, chunk: dict) -> dict:
    """Return a new manifest with `chunk` replacing any same-range entry.

    Keyed on `(id_lo, id_hi)` so a retried range overwrites its prior (failed or
    superseded) entry rather than appending a duplicate. Pure: does not mutate
    the input manifest.
    """
    key = (int(chunk["id_lo"]), int(chunk["id_hi"]))
    kept = []
    for c in manifest.get("chunks", []):
        # None-guard a malformed prior entry (mirror of _chunk_index) so a
        # structurally-valid manifest with one bad chunk never crashes resume
        # (fix #7). A bad entry is dropped (it could never have been verified).
        if not isinstance(c, dict) or c.get("id_lo") is None or c.get("id_hi") is None:
            continue
        if (int(c["id_lo"]), int(c["id_hi"])) != key:
            kept.append(c)
    kept.append(chunk)
    kept.sort(key=lambda c: (int(c["id_lo"]), int(c["id_hi"])))
    out = dict(manifest)
    out["chunks"] = kept
    return out


def resume_skip(planned_range: dict, manifest: dict) -> bool:
    """Skip a planned range ONLY if a fully-verified chunk already covers it.

    Returns True iff the manifest has an entry for the exact `(id_lo, id_hi)`
    with status == "verified" AND a present sha256 AND gzip_ok True AND
    `rows == range_count` (the recorded reconciliation). Anything short of that —
    missing entry, status != verified, sha256 absent, gzip flag false, or a row
    count that does not equal the recorded range_count — forces a clean re-dump.
    The manifest is the sole source of verified-ness (N2/SCEN-002).
    """
    entry = _chunk_index(manifest).get(
        (int(planned_range["id_lo"]), int(planned_range["id_hi"]))
    )
    if entry is None:
        return False
    if entry.get("status") != "verified":
        return False
    if not entry.get("sha256"):
        return False
    if entry.get("gzip_ok") is not True:
        return False
    rows, range_count = entry.get("rows"), entry.get("range_count")
    if rows is None or range_count is None:
        return False
    return int(rows) == int(range_count)


# =========================================================================== #
# Pure: per-chunk verification decision + empty-range guard (M9).
# =========================================================================== #
def verify_chunk_decision(
    *, gzip_ok: bool, rows: int, range_count: int
) -> tuple[bool, str | None]:
    """Decide whether a freshly-dumped chunk is verifiable. Returns (ok, reason).

    A chunk is verified ONLY when the gzip stream is intact AND its row count
    equals the live `range_count` for that id window. The empty-range guard (M9):
    a 0-row chunk is verified ONLY when `range_count == 0` too — a 0-row dump over
    a range the source says is non-empty is a silently-failed dump (emitted DDL,
    no INSERTs), NOT a real prune gap, and is rejected. On failure the reason is a
    no-PII tag for the log.
    """
    if not gzip_ok:
        return False, "gzip_failed"
    if rows == 0 and range_count != 0:
        return False, "empty_dump_nonempty_range"
    if rows != range_count:
        return False, "row_count_mismatch"
    return True, None


# =========================================================================== #
# Pure: completeness verdict (the exact three-part rule) — SCEN-007.
# =========================================================================== #
def completeness_verdict(manifest: dict) -> tuple[bool, int]:
    """Return (complete, exit_code) from the manifest's verified chunks.

    `complete:true` (-> (True, EXIT_OK)) requires ALL of:
      (a) every entry status == "verified" (and there is at least one planned range),
      (b) the verified ranges PARTITION [min_id, max_id_frozen] exactly:
          sorted, contiguous (next lo == prev hi + 1), first lo == min_id,
          last hi == max_id_frozen, NO gap and NO overlap,
      (c) sum(chunk.rows) == reconciled_count
          (== COUNT(*) WHERE id BETWEEN min_id AND max_id_frozen).
    Any shortfall -> (False, EXIT_COMPLETENESS). Rows with id > max_id_frozen are
    NOT part of this verdict (they are `rows_arrived_during_run`, accounted
    separately and never folded into total_rows).
    """
    min_id = manifest.get("min_id")
    max_id_frozen = manifest.get("max_id_frozen")
    reconciled = manifest.get("reconciled_count")
    chunks = manifest.get("chunks", [])

    if min_id is None or max_id_frozen is None or reconciled is None:
        return False, EXIT_COMPLETENESS
    if not chunks:
        return False, EXIT_COMPLETENESS

    # (a) every chunk verified.
    if any(c.get("status") != "verified" for c in chunks):
        return False, EXIT_COMPLETENESS

    ordered = sorted(chunks, key=lambda c: (int(c["id_lo"]), int(c["id_hi"])))

    # (b) exact partition: boundaries + contiguity (rejects gap AND overlap).
    if int(ordered[0]["id_lo"]) != int(min_id):
        return False, EXIT_COMPLETENESS
    if int(ordered[-1]["id_hi"]) != int(max_id_frozen):
        return False, EXIT_COMPLETENESS
    for prev, cur in zip(ordered, ordered[1:]):
        # A gap leaves cur.lo > prev.hi + 1; an overlap leaves cur.lo <= prev.hi.
        if int(cur["id_lo"]) != int(prev["id_hi"]) + 1:
            return False, EXIT_COMPLETENESS

    # (c) exact reconciliation, no tolerance band.
    total_rows = sum(int(c["rows"]) for c in ordered)
    if total_rows != int(reconciled):
        return False, EXIT_COMPLETENESS

    return True, EXIT_OK


def late_arrival_count(max_id_at_completion: int, max_id_frozen: int) -> int:
    """Rows that ARRIVED during the run = ids beyond the frozen ceiling.

    Reported as `rows_arrived_during_run`; NEVER folded into `total_rows`. This is
    an id-delta proxy (the exact post-run count is a live query in Step 10); it is
    never negative.
    """
    return max(0, int(max_id_at_completion) - int(max_id_frozen))


def build_empty_table_manifest(
    *, schema, generated_at, charset, source_ip_type, chunk_rows, updated_after,
    consistency,
) -> dict:
    """Manifest for an empty source table — a DISTINCT disposition (fix #8).

    An empty table is "nothing to archive", NOT a completeness shortfall (which
    means missing data). It is stamped `complete:true, total_rows:0,
    empty_table:true` so the caller returns exit 0, not exit 6. Pure: no IO.
    """
    return {
        "table": TABLE,
        "schema": schema,
        "generated_at": generated_at,
        "table_charset": charset,
        "source_ip_storage_type": source_ip_type,
        "min_id": None,
        "max_id_frozen": None,
        "chunk_rows": int(chunk_rows),
        "append_only_precondition": {"rows_updated_after_insert": updated_after},
        "consistency": consistency,
        "reconciled_count": 0,
        "chunks": [],
        "total_rows": 0,
        "complete": True,
        "empty_table": True,
    }


def finalize_manifest(manifest: dict, *, max_id_at_completion: int | None = None) -> dict:
    """Stamp totals + the completeness verdict onto a copy of the manifest.

    Computes `total_rows` (sum of verified chunk rows), the `complete` flag, and
    `rows_arrived_during_run` (when `max_id_at_completion` is known). Pure: does
    not mutate the input.
    """
    out = dict(manifest)
    chunks = out.get("chunks", [])
    out["total_rows"] = sum(int(c["rows"]) for c in chunks if c.get("status") == "verified")
    complete, _exit = completeness_verdict(out)
    out["complete"] = complete
    if max_id_at_completion is not None and out.get("max_id_frozen") is not None:
        out["max_id_at_completion"] = int(max_id_at_completion)
        out["rows_arrived_during_run"] = late_arrival_count(
            int(max_id_at_completion), int(out["max_id_frozen"])
        )
    return out


# =========================================================================== #
# Pure: integrity primitives (row counter, gzip check, sha256) — SCEN-004 / N1.
# =========================================================================== #
def count_insert_rows(gz_path) -> int:
    """Count `^INSERT INTO \\`TABLE\\`` lines in the gunzip stream (O(1) memory).

    With `--skip-extended-insert` the dump emits exactly ONE such INSERT statement
    per row, so this is the unambiguous row count. Anchored at line start (the
    regex matches a statement START), it is IMMUNE to a `response_raw` value
    containing the literal `),(` or a quoted `INSERT INTO ...` substring — those
    live inside a value on the same logical line and never start a line. Streams
    line-by-line; never loads the chunk into memory.
    """
    n = 0
    with gzip.open(gz_path, "rb") as fh:
        for line in fh:
            if _INSERT_LINE_RE.match(line):
                n += 1
    return n


def gzip_ok(path) -> bool:
    """True iff the gzip file decompresses cleanly to its end (the `gzip -t` check).

    Reads the whole stream in bounded chunks so a CRC/length error at the tail
    (a truncated `.partial`) is detected. `gzip` raises `BadGzipFile` (OSError)
    for a bad header and `EOFError` for a stream that ends before its end-of-stream
    marker (the truncation case) — both -> False, so a truncated chunk is REJECTED,
    never crashes the verify.
    """
    try:
        with gzip.open(path, "rb") as fh:
            while fh.read(1024 * 1024):
                pass
        return True
    except (OSError, EOFError):
        return False


def sha256_file(path) -> str:
    """Hex SHA-256 of a file, streamed in bounded chunks (O(1) memory)."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


# =========================================================================== #
# Pure: host masking + credentials (I5) — SCEN-006 / SCEN-008.
# =========================================================================== #
def mask_host(host: str) -> str:
    """Mask a hostname for error output (mirror of Phase 1). Creds NEVER printed."""
    if host in ("127.0.0.1", "localhost", "::1"):
        return host
    if len(host) <= 6:
        return "***"
    return host[:4] + "***"


def parse_legacy_env(env_blob: str) -> dict:
    """Extract ONLY the five DB_* keys from a Laravel .env blob; discard the rest.

    The blob (whole secrets file) is never returned or logged — only the five
    `DB_*` values escape this function. Handles `KEY=value`, surrounding quotes,
    inline `# comment` on unquoted values, and `export KEY=...`. A missing key is
    simply absent from the result (the caller validates completeness).
    """
    out: dict[str, str] = {}
    wanted = set(LEGACY_ENV_KEYS)
    for line in env_blob.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if s.startswith("export "):
            s = s[len("export "):].strip()
        if "=" not in s:
            continue
        key, _, val = s.partition("=")
        key = key.strip()
        if key not in wanted:
            continue
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            val = val[1:-1]
        else:
            # Strip an inline comment from an UNQUOTED value (Laravel convention).
            hash_at = val.find(" #")
            if hash_at != -1:
                val = val[:hash_at].rstrip()
        out[key] = val
    return out


def build_defaults_extra_file_content(creds: dict) -> str:
    """Build the `[mysqldump]` ini for `--defaults-extra-file` (written 0600).

    The password reaches `mysqldump` ONLY through this file — NEVER as `-p<pass>`
    on argv (which `ps` would expose). Emits user/password (and host/port/database
    when present). Values are not quoted: a MySQL option file reads the rest of
    the line verbatim, so a `#` or space in the password is preserved (quoting
    would corrupt it). `host`/`port` point at the local tunnel end.
    """
    user = creds.get("DB_USERNAME") or creds.get("user") or ""
    password = creds.get("DB_PASSWORD")
    if password is None:
        password = creds.get("password", "")
    lines = ["[mysqldump]", f"user={user}", f"password={password}"]
    host = creds.get("DB_HOST") or creds.get("host")
    port = creds.get("DB_PORT") or creds.get("port")
    if host:
        lines.append(f"host={host}")
    if port:
        lines.append(f"port={port}")
    return "\n".join(lines) + "\n"


# =========================================================================== #
# Pure: mysqldump command builder (no secret on argv) — SCEN-005b flags / Step 6.
# =========================================================================== #
def build_mysqldump_argv(
    *, defaults_file: str, database: str, charset: str, id_lo: int, id_hi: int
) -> list[str]:
    """Build the `mysqldump` argv for one PK-range chunk. NO password on argv.

    Carries the non-blocking + faithful flags: `--single-transaction --quick`
    (MVCC snapshot, streamed rows — no buffering, no LOCK TABLES),
    `--no-tablespaces --skip-lock-tables --hex-blob`, `--skip-extended-insert`
    (one INSERT per row -> the unambiguous N1 row count), and the RUNTIME
    `--default-character-set=<charset>` (no utf8mb4 assumption — byte fidelity for
    response_raw/json). The password is supplied only via
    `--defaults-extra-file=<path>`, placed FIRST so it parses before any option
    it overrides.
    """
    return [
        "mysqldump",
        f"--defaults-extra-file={defaults_file}",
        "--single-transaction",
        "--quick",
        "--no-tablespaces",
        "--skip-lock-tables",
        "--hex-blob",
        "--skip-extended-insert",
        f"--default-character-set={charset}",
        f"--where=id BETWEEN {int(id_lo)} AND {int(id_hi)}",
        database,
        TABLE,
    ]


# =========================================================================== #
# Pure: SHOW CREATE TABLE parser (charset + source_ip storage type) — SCEN/Step 7.
# =========================================================================== #
def detect_schema(show_create_text: str) -> tuple[str | None, str | None]:
    """Parse `SHOW CREATE TABLE` text -> (table_charset, source_ip_storage_type).

    The table charset is the `DEFAULT CHARSET=<x>` of the table options; it drives
    the runtime `--default-character-set` (I6 — never assumed utf8mb4). The
    `source_ip` storage type is the declared column type (`varchar(45)` vs
    `inet6`) verified at runtime (M10) and recorded in the manifest. Either is
    None if absent from the text.
    """
    charset = None
    m = re.search(r"DEFAULT CHARSET\s*=\s*([A-Za-z0-9_]+)", show_create_text)
    if m:
        charset = m.group(1)

    source_ip_type = None
    # The column line: backtick-quoted name, then the type up to a comma/newline.
    m = re.search(
        r"`source_ip`\s+([A-Za-z0-9_]+(?:\([^)]*\))?)",
        show_create_text,
    )
    if m:
        source_ip_type = m.group(1).lower()

    return charset, source_ip_type


# =========================================================================== #
# Pure: append-only gate decision (point-in-time / abort / eventual) — SCEN-009.
# =========================================================================== #
def append_only_gate_decision(
    count_updated_ne_created: int, allow_eventual: bool
) -> str:
    """Decide the consistency posture from the precondition count + the flag.

    `COUNT(*) WHERE updated_at <> created_at`:
      * 0                         -> "point-in-time" (clean append-only; proceed)
      * > 0  and not allow_eventual -> "abort"        (exit 4 before any dump)
      * > 0  and allow_eventual     -> "eventual"     (proceed, stamp consistency)
    """
    if count_updated_ne_created <= 0:
        return "point-in-time"
    return "eventual" if allow_eventual else "abort"


# =========================================================================== #
# Pure: status-file shaping (PII-free progress) — SCEN-006.
# =========================================================================== #
def build_status(
    *,
    chunks_done: int,
    chunks_total: int,
    bytes_written: int,
    current_id: int | None,
    last_advance_at: str,
) -> dict:
    """Shape the progress status dict. PII-free: ids/bytes/timestamps only.

    The unattended monitor reads `current_id` / `bytes` / `last_advance` to enforce
    the stall rule. No `source_ip`, no row payload — only metadata.
    """
    return {
        "chunks_done": int(chunks_done),
        "chunks_total": int(chunks_total),
        "bytes": int(bytes_written),
        "current_id": None if current_id is None else int(current_id),
        "last_advance": last_advance_at,
    }


# =========================================================================== #
# Pure: the chunk loop under watchdog + deadline + stall — INJECTED clock/runner.
# =========================================================================== #
class RunDeadlineExceeded(Exception):
    """Raised inside the loop when the global RUN_DEADLINE is breached -> exit 5."""


def run_chunk_loop(
    planned,
    manifest,
    *,
    chunk_runner,
    clock,
    run_deadline_at: float,
    max_retries: int,
    persist=None,
):
    """Drive the resumable chunk loop with INJECTED dependencies (no real IO).

    Parameters are dependency-injected so this loop is unit-testable offline:
      * `chunk_runner(planned_range) -> dict` performs one dump+verify attempt and
        returns either a verified chunk entry (`status == "verified"`) or a failed
        attempt (`status != "verified"`). A `status == "verified"` result is
        TRUSTED unconditionally: it already survived its own per-chunk subprocess
        timeout AND the stall watchdog INSIDE `dump_chunk` (the `.partial`
        byte-growth check), and it is row-count-reconciled against the live
        `range_count`. The loop does NOT second-guess a chunk's wall-time — a
        healthy ~1.1 GiB chunk routinely runs many minutes; discarding it for
        being "slow" would fail an entirely successful run.
      * `clock()` returns a monotonic seconds value (real or fake).
      * `run_deadline_at` is the absolute monotonic deadline; breaching it raises
        `RunDeadlineExceeded` (caller -> exit 5), tunnel torn down by the caller,
        verified chunks already persisted (see `persist`).
      * `persist(manifest)` (optional) is called after EVERY verified merge so the
        on-disk manifest reflects in-session progress immediately. This makes
        resume robust to ANY interruption — a tunnel-relaunch error, a stale-conn
        error, a SIGKILL — not just the clean deadline path. Without it the loop
        still works (in-memory only), but progress is lost if the caller never
        gets to write the manifest.

    Returns the merged manifest with every successfully-verified chunk recorded.
    A range that fails all `max_retries` attempts is left UNverified (its last
    failed attempt is NOT merged as verified) so the final completeness verdict
    reports the shortfall (exit 6) rather than a silent gap.

    Stall protection: NOT here. The genuine stall guard (a `.partial` that stops
    growing while the subprocess is alive) lives INSIDE `dump_chunk`, which
    SIGKILLs the wedged dump and returns a `status != "verified"` failed attempt —
    which this loop then retries under `max_retries`.
    """
    out = manifest
    for prange in planned:
        if resume_skip(prange, out):
            continue
        if clock() >= run_deadline_at:
            raise RunDeadlineExceeded()

        for _attempt in range(max_retries):
            if clock() >= run_deadline_at:
                raise RunDeadlineExceeded()
            result = chunk_runner(prange)
            # Trust a verified result unconditionally — it survived dump_chunk's
            # own timeout + stall watchdog and is row-count-reconciled.
            if result.get("status") == "verified":
                out = merge_chunk(out, result)
                if persist is not None:
                    persist(out)  # incremental — resume-safe against any interrupt
                break
            # Failed attempt (timeout/stall/mismatch/io): retry under max_retries.
        # If still not verified after max_retries, leave the range unverified;
        # the completeness verdict will catch the shortfall (exit 6).
    return out


# =========================================================================== #
# Atomic write — reused contract from Phase 1 (etl-customers / size-log-veh).
# =========================================================================== #
def _atomic_write(target: Path, payload: str | bytes, *, mode: int | None = None) -> None:
    """Write `payload` to `target` atomically (temp file + fsync + os.replace).

    Optional `mode` (e.g. 0o600 for the creds file) is applied to the temp file
    BEFORE the rename so the final file is never world-readable for an instant.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(target.parent), prefix=target.name + ".", suffix=".tmp")
    tmp_path = Path(tmp_name)
    binary = isinstance(payload, bytes)
    try:
        if mode is not None:
            os.chmod(tmp_path, mode)
        with os.fdopen(fd, "wb" if binary else "w", encoding=None if binary else "utf-8") as fh:
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


def unlink_defaults_file(path) -> bool:
    """Best-effort remove the 0600 `--defaults-extra-file` (the live DB password).

    Returns True if the file is absent afterwards (removed now or already gone).
    Idempotent and exception-safe so it is callable from a `finally` AND an
    `atexit` hook without ever raising. Design §4.1 — the creds file must not
    outlive the run (fix #2).
    """
    try:
        Path(path).unlink(missing_ok=True)
        return True
    except OSError:
        return False


def write_manifest(manifest: dict, run_dir: Path) -> Path:
    """Atomically write the PII-free manifest.json into the run dir."""
    target = run_dir / "manifest.json"
    _atomic_write(target, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return target


def write_status(status: dict, run_dir: Path) -> Path:
    """Atomically write the PII-free status.json into the run dir."""
    target = run_dir / "status.json"
    _atomic_write(target, json.dumps(status, ensure_ascii=False) + "\n")
    return target


def chunk_filename(seq: int, id_lo: int, id_hi: int) -> str:
    """`chunk-NNNNN-<lo>-<hi>.sql.gz` (zero-padded seq for lexical sort)."""
    return f"chunk-{int(seq):05d}-{int(id_lo)}-{int(id_hi)}.sql.gz"


def run_dir_for(stamp: str, repo_root: Path | None = None) -> Path:
    """The gitignored run dir `docs/migration-runs/log-veh-extract-<stamp>/`."""
    root = repo_root or Path(__file__).resolve().parents[2]
    return root / "docs" / "migration-runs" / f"log-veh-extract-{stamp}"


# =========================================================================== #
# Thin IO wrappers — LAZY imports; validated live in Step 10, not in unit tests.
# =========================================================================== #
def fetch_legacy_creds(ssh_host: str = "rentacar", env_path: str = "/home/rentacar/.env") -> dict:
    """Fetch the 5 DB_* creds via `ssh <host> 'sudo cat <env_path>'`. SSH IO.

    Runs the remote `sudo cat`, pipes the WHOLE .env over stdout, and immediately
    discards everything except the five DB_* keys via `parse_legacy_env` — the
    blob is never logged or returned whole. Raises on a non-zero ssh/sudo exit so
    the caller surfaces EXIT_CONNECTION. Lazy subprocess import.
    """
    import subprocess

    proc = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", ssh_host, f"sudo -n cat {env_path}"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        # Never echo the blob or stderr body (could carry secrets). Log ONLY the
        # integer return code as a diagnostic (fix #11) — e.g. 255 ssh failure vs
        # 1 sudo denial — so a failed run is not a total black box.
        raise RuntimeError(
            f"legacy credential fetch failed (ssh/sudo exit {proc.returncode})"
        )
    creds = parse_legacy_env(proc.stdout)
    # Do NOT keep a reference to proc.stdout (the blob) past here.
    missing = [k for k in LEGACY_ENV_KEYS if not creds.get(k)]
    if missing:
        raise RuntimeError(f"legacy .env missing keys: {', '.join(missing)}")
    return creds


def connect_legacy(creds: dict, local_port: int):
    """Open the pymysql connection (metadata SELECTs only). Lazy pymysql import.

    Connects to the LOCAL tunnel end (127.0.0.1:<local_port>), never the remote
    host directly. Used for the append-only gate, schema detect, id-bounds freeze,
    and per-range COUNT(*) reconciliation — NOT for the dump (that is mysqldump).
    """
    import pymysql

    return pymysql.connect(
        host="127.0.0.1",
        port=int(local_port),
        user=creds["DB_USERNAME"],
        password=creds["DB_PASSWORD"],
        database=creds["DB_DATABASE"],
        cursorclass=pymysql.cursors.Cursor,
        connect_timeout=10,
    )


def query_id_bounds(conn) -> tuple[int | None, int | None]:
    """Freeze (min_id, max_id_frozen) ONCE at run start (two PK seeks, O(1))."""
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT MIN(id), MAX(id) FROM `{TABLE}`")
        row = cur.fetchone()
        lo = int(row[0]) if row and row[0] is not None else None
        hi = int(row[1]) if row and row[1] is not None else None
        return lo, hi
    finally:
        cur.close()


def query_range_count(conn, id_lo: int, id_hi: int) -> int:
    """`COUNT(*) WHERE id BETWEEN lo AND hi` — the per-chunk reconciliation count."""
    cur = conn.cursor()
    try:
        cur.execute(
            f"SELECT COUNT(*) FROM `{TABLE}` WHERE id BETWEEN %s AND %s",
            (int(id_lo), int(id_hi)),
        )
        return int(cur.fetchone()[0])
    finally:
        cur.close()


def query_reconciled_count(conn, min_id: int, max_id_frozen: int) -> int:
    """`COUNT(*) WHERE id BETWEEN min_id AND max_id_frozen` over the frozen range."""
    return query_range_count(conn, min_id, max_id_frozen)


def query_append_only_count(conn) -> int:
    """`COUNT(*) WHERE updated_at <> created_at` — the append-only precondition."""
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT COUNT(*) FROM `{TABLE}` WHERE updated_at <> created_at")
        return int(cur.fetchone()[0])
    finally:
        cur.close()


def query_show_create(conn) -> str:
    """`SHOW CREATE TABLE` text — parsed by the pure `detect_schema`."""
    cur = conn.cursor()
    try:
        cur.execute(f"SHOW CREATE TABLE `{TABLE}`")
        row = cur.fetchone()
        return row[1] if row and len(row) > 1 else ""
    finally:
        cur.close()


def _reap(proc, *, grace: float = 5.0) -> None:
    """SIGKILL then reap a subprocess so no zombie is left behind."""
    import subprocess

    try:
        proc.kill()
    except OSError:
        pass
    try:
        proc.wait(timeout=grace)
    except (subprocess.TimeoutExpired, OSError):
        pass


def dump_chunk(prange, *, defaults_file, database, charset, run_dir, conn,
               chunk_timeout, stall_seconds=None, poll_interval=2.0):
    """Live dump+verify of ONE chunk: mysqldump | gzip -> .partial, verify, rename.

    Subprocess IO (validated in Step 10). ONE attempt — the live retry path is
    `run_chunk_loop` under `max_retries`; there is no inner retry loop here
    (fix #9). Builds argv via `build_mysqldump_argv` (no password on argv), streams
    through gzip into `<name>.partial`, then verifies with the PURE primitives
    (`gzip_ok`, `count_insert_rows`, `verify_chunk_decision` against the live
    `range_count`). Only a verified chunk is atomically renamed off `.partial`.

    Watchdogs (fix #4 + the real stall guard for fix #1):
      * a SINGLE shared deadline of `chunk_timeout` seconds bounds the whole
        pipeline (not `2x` — a wedged dump cannot block for two full windows);
      * a `.partial` byte-growth stall guard: if the file stops growing for
        `stall_seconds` while the pipeline is alive, the dump is SIGKILLed and the
        attempt fails (this is the genuine stall protection — a HEALTHY slow chunk
        keeps the `.partial` growing and is NOT killed);
      * `gz.returncode` is checked (a disk-full gzip is a failure, not a success);
      * both processes are reaped after any kill (no zombies).
    On any failure the `.partial` is discarded and a `status == "failed"` result
    with a no-PII reason is returned for the loop to retry.
    """
    import subprocess
    import time

    seq, lo, hi = int(prange["seq"]), int(prange["id_lo"]), int(prange["id_hi"])
    final = Path(run_dir) / chunk_filename(seq, lo, hi)
    partial = final.with_suffix(final.suffix + ".partial")
    range_count = query_range_count(conn, lo, hi)
    argv = build_mysqldump_argv(
        defaults_file=defaults_file, database=database, charset=charset,
        id_lo=lo, id_hi=hi,
    )

    def _fail(reason):
        partial.unlink(missing_ok=True)
        return {"seq": seq, "id_lo": lo, "id_hi": hi, "range_count": range_count,
                "status": "failed", "reason": reason}

    try:
        with open(partial, "wb") as out_fh:
            dump = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            gz = subprocess.Popen(["gzip"], stdin=dump.stdout, stdout=out_fh)
            dump.stdout.close()  # gz owns the read end now.

            deadline = time.monotonic() + float(chunk_timeout)
            last_size = -1
            last_growth = time.monotonic()
            # Poll until gzip (the pipeline tail) exits, or a watchdog trips.
            while gz.poll() is None:
                now = time.monotonic()
                if now >= deadline:
                    _reap(dump)
                    _reap(gz)
                    return _fail("timeout")
                if stall_seconds is not None:
                    try:
                        size = partial.stat().st_size
                    except OSError:
                        size = last_size
                    if size > last_size:
                        last_size = size
                        last_growth = now
                    elif (now - last_growth) > float(stall_seconds):
                        # .partial stopped growing while alive -> genuine stall.
                        _reap(dump)
                        _reap(gz)
                        return _fail("stall")
                time.sleep(poll_interval)

            # gzip finished; reap the dump head too (it should be done).
            try:
                dump.wait(timeout=5.0)
            except subprocess.TimeoutExpired:
                _reap(dump)
                return _fail("dump_hung_after_gzip")

        # Pipeline exit-status checks (fix #4a/4d): a still-running (None) or
        # non-zero return on EITHER process is a failure, never a success.
        if dump.returncode is None or dump.returncode != 0:
            return _fail("mysqldump_nonzero")
        if gz.returncode is None or gz.returncode != 0:
            return _fail("gzip_nonzero")  # e.g. disk full

        ok_gz = gzip_ok(partial)
        rows = count_insert_rows(partial) if ok_gz else 0
        ok, reason = verify_chunk_decision(gzip_ok=ok_gz, rows=rows, range_count=range_count)
        if not ok:
            return _fail(reason or "verify_failed")
        digest = sha256_file(partial)
        os.replace(partial, final)
        return {
            "seq": seq, "id_lo": lo, "id_hi": hi,
            "rows": rows, "range_count": range_count,
            "bytes_gz": final.stat().st_size, "sha256": digest,
            "gzip_ok": True, "status": "verified",
        }
    except OSError:
        return _fail("io_error")


# =========================================================================== #
# Orchestration (Step 8) — thin glue; the live run is Step 10.
# =========================================================================== #
def run(args) -> int:
    """Connect (metadata) -> append-only gate -> schema -> freeze bounds -> plan ->
    chunk loop (resume + tunnel relaunch + dump) -> finalize -> verdict -> exit.

    The heavy decisions are the pure functions above; this is the IO glue, run for
    real in Step 10. Lazy `_tunnel` import keeps the module importable on bare
    Python.
    """
    import time

    import _tunnel  # local module; scripts/migration on sys.path at runtime.

    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    run_dir = run_dir_for(stamp)
    run_dir.mkdir(parents=True, exist_ok=True)

    # --- credentials (exit 2 on ssh/sudo failure) ---
    try:
        creds = fetch_legacy_creds()
    except Exception as exc:
        print(f"ERROR: credential fetch failed [{type(exc).__name__}]", file=sys.stderr)
        return EXIT_CONNECTION

    defaults_path = run_dir / ".defaults-extra.cnf"
    _atomic_write(defaults_path, build_defaults_extra_file_content(creds), mode=0o600)
    # The 0600 creds file carries the live DB password. Design §4.1 mandates it be
    # unlinked on exit. Register an atexit hook as belt-and-suspenders (covers a
    # hard process exit); the `finally` below is the primary path (fix #2).
    import atexit
    atexit.register(unlink_defaults_file, defaults_path)

    db_host = creds["DB_HOST"]
    db_port = int(creds.get("DB_PORT") or 3306)
    local_port = int(args.local_port)
    tunnel = None
    conn = None
    conn_cell = {"conn": None}
    try:
        # --- tunnel (exit 3 if it never comes up) ---
        try:
            tunnel = _tunnel.ensure_tunnel(local_port, db_host, db_port, "rentacar")
        except Exception as exc:
            print(f"ERROR: tunnel could not be established [{type(exc).__name__}]", file=sys.stderr)
            return EXIT_TUNNEL_OR_QUERY

        try:
            conn = connect_legacy(creds, local_port)
            conn_cell["conn"] = conn
        except Exception as exc:
            print(f"ERROR: legacy connection failed (host {mask_host(db_host)}) "
                  f"[{type(exc).__name__}]", file=sys.stderr)
            return EXIT_CONNECTION

        # --- append-only gate (exit 4 unless --allow-eventual) ---
        try:
            updated_after = query_append_only_count(conn)
            charset, source_ip_type = detect_schema(query_show_create(conn))
            min_id, max_id_frozen = query_id_bounds(conn)
        except Exception as exc:
            print(f"ERROR: metadata query failed [{type(exc).__name__}]", file=sys.stderr)
            return EXIT_TUNNEL_OR_QUERY

        decision = append_only_gate_decision(updated_after, args.allow_eventual)
        if decision == "abort":
            print(f"ERROR: append-only precondition failed: {updated_after} row(s) with "
                  "updated_at <> created_at. Re-run with --allow-eventual to proceed.",
                  file=sys.stderr)
            return EXIT_APPEND_ONLY

        # Charset must be DETECTED, never assumed (I6). A None charset means the
        # SHOW CREATE TABLE parse failed — proceeding with a guessed utf8mb4 could
        # silently corrupt response_raw/json bytes, defeating the whole "faithful
        # 1:1" goal. Fail loud (exit 3) rather than archive with a wrong charset.
        if charset is None:
            print("ERROR: could not detect the table charset from SHOW CREATE TABLE; "
                  "refusing to dump with an assumed charset (byte-fidelity risk).",
                  file=sys.stderr)
            return EXIT_TUNNEL_OR_QUERY

        if min_id is None or max_id_frozen is None:
            # Empty table: nothing to archive. Distinct disposition (exit 0,
            # complete:true, total_rows:0, empty_table:true) — NOT a completeness
            # shortfall (which means MISSING data). See the early-return below.
            manifest = build_empty_table_manifest(
                schema=creds["DB_DATABASE"], generated_at=now.isoformat(),
                charset=charset, source_ip_type=source_ip_type,
                chunk_rows=int(args.chunk_rows), updated_after=updated_after,
                consistency=decision,
            )
            write_manifest(manifest, run_dir)
            print("OK: source table is empty (no id bounds) — nothing to archive; "
                  "complete:true, total_rows:0.")
            return EXIT_OK

        manifest = {
            "table": TABLE,
            "schema": creds["DB_DATABASE"],
            "generated_at": now.isoformat(),
            "table_charset": charset,
            "source_ip_storage_type": source_ip_type,
            "min_id": min_id,
            "max_id_frozen": max_id_frozen,
            "chunk_rows": int(args.chunk_rows),
            "append_only_precondition": {"rows_updated_after_insert": updated_after},
            "consistency": decision,
            "chunks": [],
        }
        # Reconciliation count over the frozen range (the exact gate denominator).
        manifest["reconciled_count"] = query_reconciled_count(conn, min_id, max_id_frozen)
        # Resume: merge any verified chunks from a prior run's manifest on disk.
        prior = load_manifest(run_dir / "manifest.json")
        for c in prior.get("chunks", []):
            if c.get("status") == "verified":
                manifest = merge_chunk(manifest, c)

        planned = plan_ranges(min_id, max_id_frozen, int(args.chunk_rows))

        run_deadline_at = time.monotonic() + float(args.run_deadline) * 60.0
        stall_seconds = float(args.stall_minutes) * 60.0

        # `conn` is a single long-lived metadata connection (~2h). After a tunnel
        # relaunch it is bound to a DEAD forwarder; the per-chunk COUNT(*) inside
        # dump_chunk would then raise a pymysql OperationalError (NOT an OSError,
        # so it would escape dump_chunk's guard and abort the run). The mutable
        # `conn_cell` (seeded above) lets the runner reconnect on relaunch/failure
        # while the outer `finally` always closes the live connection.
        def _runner(prange):
            # Re-probe + relaunch the tunnel before each chunk (SCEN-003).
            nonlocal tunnel
            before = tunnel
            tunnel = _tunnel.relaunch_if_dead(tunnel, db_host, db_port, "rentacar")
            if tunnel is not before or tunnel.pid != getattr(before, "pid", None):
                # Tunnel was (re)launched -> the old metadata conn is stale. Drop
                # it and reconnect through the fresh forwarder.
                try:
                    conn_cell["conn"].close()
                except Exception:
                    pass
                conn_cell["conn"] = connect_legacy(creds, local_port)
            try:
                return dump_chunk(
                    prange, defaults_file=str(defaults_path),
                    database=creds["DB_DATABASE"], charset=charset, run_dir=run_dir,
                    conn=conn_cell["conn"], stall_seconds=stall_seconds,
                    chunk_timeout=float(args.chunk_timeout) * 60.0,
                )
            except Exception:
                # Any metadata-query failure (stale conn, etc.) -> reconnect and
                # surface as a chunk failure so the loop retries under M (fix #5).
                try:
                    conn_cell["conn"].close()
                except Exception:
                    pass
                try:
                    conn_cell["conn"] = connect_legacy(creds, local_port)
                except Exception:
                    pass
                return {"seq": int(prange["seq"]), "id_lo": int(prange["id_lo"]),
                        "id_hi": int(prange["id_hi"]), "status": "failed",
                        "reason": "metadata_query_error"}

        try:
            manifest = run_chunk_loop(
                planned, manifest,
                chunk_runner=_runner, clock=time.monotonic,
                run_deadline_at=run_deadline_at,
                max_retries=int(args.max_retries),
                persist=lambda m: write_manifest(m, run_dir),  # incremental (fix #3)
            )
        except RunDeadlineExceeded:
            # Verified chunks were persisted incrementally inside the loop; finalize
            # the verdict flag and re-persist.
            manifest = finalize_manifest(manifest)
            write_manifest(manifest, run_dir)
            print("ERROR: RUN_DEADLINE breached; verified chunks preserved, resume to "
                  "continue.", file=sys.stderr)
            return EXIT_RUN_DEADLINE

        conn = conn_cell["conn"]  # adopt whatever the loop reconnected to.

        # Late-arrival accounting + final verdict. A failed re-check is recorded
        # explicitly (fix #10) rather than silently reading 0 late arrivals.
        max_recheck_failed = False
        try:
            _, max_at_completion = query_id_bounds(conn)
        except Exception:
            max_at_completion = max_id_frozen
            max_recheck_failed = True
        manifest = finalize_manifest(manifest, max_id_at_completion=max_at_completion)
        if max_recheck_failed:
            manifest["max_id_recheck_failed"] = True
        write_manifest(manifest, run_dir)

        complete, exit_code = completeness_verdict(manifest)
        if complete:
            print(f"OK: complete archive — {manifest['total_rows']} rows == "
                  f"{manifest['reconciled_count']} reconciled; {len(manifest['chunks'])} chunks.")
            return EXIT_OK
        print("ERROR: completeness shortfall — verdict complete:false. Investigate the "
              "manifest (failed range / gap / overlap / sum != reconciled).", file=sys.stderr)
        return exit_code
    finally:
        # Close whichever connection is currently live (the runner may have
        # reconnected `conn_cell` after a relaunch).
        live_conn = conn_cell.get("conn") or conn
        if live_conn is not None:
            try:
                live_conn.close()
            except Exception:
                pass
        if tunnel is not None:
            try:
                _tunnel.teardown(tunnel)
            except Exception:
                pass
        # Unlink the 0600 creds file on EVERY exit path — success, deadline,
        # exception, abort (fix #2). The atexit hook is a fallback for hard exits.
        unlink_defaults_file(defaults_path)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Autonomous resumable raw extraction of legacy log_veh (issue #45 Phase 2).",
        epilog=("Exit codes: 0 ok · 2 connection/cred-fetch · 3 tunnel-unrecoverable or "
                "query-error · 4 append-only precondition · 5 run-deadline · "
                "6 completeness-shortfall."),
    )
    parser.add_argument("--chunk-rows", type=int, default=25_000,
                        help="id-window size per chunk (default 25000)")
    parser.add_argument("--allow-eventual", action="store_true",
                        help="proceed even if rows were updated after insert "
                             "(stamps consistency=eventual instead of aborting exit 4)")
    parser.add_argument("--run-deadline", type=float, default=180.0,
                        help="global run deadline in MINUTES (default 180); breach -> exit 5")
    parser.add_argument("--chunk-timeout", type=float, default=20.0,
                        help="per-chunk subprocess timeout in MINUTES (default 20)")
    parser.add_argument("--stall-minutes", type=float, default=10.0,
                        help="kill an in-flight chunk if its .partial stops GROWING for "
                             "this many MINUTES (a healthy slow chunk keeps growing and "
                             "is not killed)")
    parser.add_argument("--max-retries", type=int, default=3,
                        help="per-chunk dump retries before leaving the range unverified")
    parser.add_argument("--local-port", type=int, default=3307,
                        help="local end of the SSH tunnel (default 3307)")
    args = parser.parse_args(argv)

    if args.chunk_rows < 1:
        print("ERROR: --chunk-rows must be >= 1", file=sys.stderr)
        return EXIT_TUNNEL_OR_QUERY

    try:
        return run(args)
    except Exception as exc:  # sanitized — never echo the message body.
        print(f"ERROR: unexpected failure [{type(exc).__name__}]", file=sys.stderr)
        return EXIT_TUNNEL_OR_QUERY


if __name__ == "__main__":
    sys.exit(main())
