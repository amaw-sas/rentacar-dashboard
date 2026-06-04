#!/usr/bin/env python3
"""Unit tests for the Phase-2 log_veh extraction driver — pure functions only.

Runs on BARE Python: NO pymysql, NO mysqldump, NO ssh imported at module load
(the IO wrappers import them lazily). The hyphenated `extract-log-veh.py` is
imported by path via importlib (the Phase-1 pattern); `_tunnel.py` is imported
normally with scripts/migration on sys.path.

Every test traces to a holdout scenario (issue #45 Phase 2):
  SCEN-002  resume + N2 cold-start            -> Manifest*, ResumeSkip
  SCEN-004  integrity + M9 + N1 counter       -> CountInsertRows, GzipOk, VerifyChunk
  SCEN-006  gitignore + no-argv-pw + builder   -> DefaultsExtraFile, MysqldumpArgv, Status
  SCEN-007  completeness verdict + exit 6 + late arrival -> CompletenessVerdict, LateArrival
  SCEN-008  cred parse + tunnel teardown keying -> ParseLegacyEnv, ParseHandshake, Teardown
  SCEN-009  append-only gate decision           -> AppendOnlyGate
SCEN-001/003/005a/005b are EXECUTION-only (Step 10); their IO wrappers are not
faked green here.

Run:
  cd scripts/migration && python -m unittest test_extract_log_veh -v
"""

from __future__ import annotations

import gzip
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent

# Import the hyphenated-filename module by path (not a legal `import` name).
_SPEC_PATH = _HERE / "extract-log-veh.py"
_spec = importlib.util.spec_from_file_location("extract_log_veh", _SPEC_PATH)
elv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(elv)

# Import _tunnel normally with scripts/migration on sys.path.
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
import _tunnel  # noqa: E402


# --------------------------------------------------------------------------- #
# Fixture helpers.
# --------------------------------------------------------------------------- #
def _verified_chunk(seq, lo, hi, rows, *, range_count=None, sha="a" * 64):
    return {
        "seq": seq, "id_lo": lo, "id_hi": hi,
        "rows": rows, "range_count": rows if range_count is None else range_count,
        "bytes_gz": 100, "sha256": sha, "gzip_ok": True, "status": "verified",
    }


def _manifest(min_id, max_id_frozen, reconciled, chunks):
    return {
        "min_id": min_id, "max_id_frozen": max_id_frozen,
        "reconciled_count": reconciled, "chunks": list(chunks),
    }


def _write_gz(rows_lines: list[bytes]) -> Path:
    """Write a tiny gzipped --skip-extended-insert-style dump to a temp file."""
    fd, name = tempfile.mkstemp(suffix=".sql.gz")
    import os
    os.close(fd)
    with gzip.open(name, "wb") as fh:
        fh.write(b"-- MariaDB dump\n")
        fh.write(b"DROP TABLE IF EXISTS `log_veh_available_rates_queries`;\n")
        for ln in rows_lines:
            fh.write(ln)
    return Path(name)


# =========================================================================== #
# SCEN-002 — PK-range planner (frozen bounds, exact partition).
# =========================================================================== #
class PlanRanges(unittest.TestCase):
    def test_partitions_exactly_no_gap_no_overlap(self):
        ranges = elv.plan_ranges(1, 10, 4)
        self.assertEqual([(r["id_lo"], r["id_hi"]) for r in ranges],
                         [(1, 4), (5, 8), (9, 10)])
        self.assertEqual([r["seq"] for r in ranges], [1, 2, 3])

    def test_single_full_chunk(self):
        self.assertEqual(elv.plan_ranges(100, 124, 25),
                         [{"seq": 1, "id_lo": 100, "id_hi": 124}])

    def test_frozen_min_offset_not_assumed_one(self):
        # Bounds need not start at 1 — the real min_id is 22730.
        ranges = elv.plan_ranges(22730, 22735, 3)
        self.assertEqual(ranges[0]["id_lo"], 22730)
        self.assertEqual(ranges[-1]["id_hi"], 22735)

    def test_empty_when_max_below_min(self):
        self.assertEqual(elv.plan_ranges(10, 5, 4), [])

    def test_chunk_rows_must_be_positive(self):
        with self.assertRaises(ValueError):
            elv.plan_ranges(1, 10, 0)

    def test_contiguity_invariant_holds(self):
        ranges = elv.plan_ranges(1, 1000, 37)
        for prev, cur in zip(ranges, ranges[1:]):
            self.assertEqual(cur["id_lo"], prev["id_hi"] + 1)  # no gap/overlap
        self.assertEqual(ranges[0]["id_lo"], 1)
        self.assertEqual(ranges[-1]["id_hi"], 1000)


# =========================================================================== #
# SCEN-002 + N2 — manifest load (cold-start) / merge / resume-skip.
# =========================================================================== #
class ManifestColdStart(unittest.TestCase):
    """N2: missing -> empty; truncated/invalid-JSON -> ZERO verified, never raises."""

    def test_missing_file_is_empty(self):
        self.assertEqual(elv.load_manifest("/nonexistent/path/manifest.json"),
                         {"chunks": []})

    def test_invalid_json_is_zero_verified(self):
        fd, name = tempfile.mkstemp(suffix=".json")
        import os
        os.write(fd, b'{"chunks": [ {"id_lo": 1, "id_hi":')  # truncated mid-object
        os.close(fd)
        m = elv.load_manifest(name)
        self.assertEqual(m, {"chunks": []})

    def test_valid_json_missing_chunks_is_empty(self):
        fd, name = tempfile.mkstemp(suffix=".json")
        import os
        os.write(fd, b'{"min_id": 1}')  # no chunks key
        os.close(fd)
        self.assertEqual(elv.load_manifest(name), {"chunks": []})

    def test_chunks_not_a_list_is_empty(self):
        fd, name = tempfile.mkstemp(suffix=".json")
        import os
        os.write(fd, b'{"chunks": "nope"}')
        os.close(fd)
        self.assertEqual(elv.load_manifest(name), {"chunks": []})

    def test_well_formed_manifest_round_trips(self):
        fd, name = tempfile.mkstemp(suffix=".json")
        import os
        payload = json.dumps(_manifest(1, 4, 4, [_verified_chunk(1, 1, 4, 4)]))
        os.write(fd, payload.encode())
        os.close(fd)
        m = elv.load_manifest(name)
        self.assertEqual(len(m["chunks"]), 1)
        self.assertEqual(m["chunks"][0]["status"], "verified")


class MergeChunk(unittest.TestCase):
    def test_replaces_same_range_no_duplicate(self):
        m = _manifest(1, 8, 8, [_verified_chunk(1, 1, 4, 4)])
        failed = {"seq": 1, "id_lo": 1, "id_hi": 4, "status": "failed"}
        m2 = elv.merge_chunk(m, failed)
        m3 = elv.merge_chunk(m2, _verified_chunk(1, 1, 4, 4))
        ranges = [(c["id_lo"], c["id_hi"]) for c in m3["chunks"]]
        self.assertEqual(ranges.count((1, 4)), 1)  # no duplicate range
        self.assertEqual(m3["chunks"][0]["status"], "verified")

    def test_does_not_mutate_input(self):
        m = _manifest(1, 8, 8, [_verified_chunk(1, 1, 4, 4)])
        before = len(m["chunks"])
        elv.merge_chunk(m, _verified_chunk(2, 5, 8, 4))
        self.assertEqual(len(m["chunks"]), before)  # input unchanged

    def test_keeps_sorted(self):
        m = elv.empty_manifest()
        m = elv.merge_chunk(m, _verified_chunk(2, 5, 8, 4))
        m = elv.merge_chunk(m, _verified_chunk(1, 1, 4, 4))
        self.assertEqual([c["id_lo"] for c in m["chunks"]], [1, 5])

    def test_malformed_prior_entry_does_not_crash(self):
        # Fix #7: a structurally-valid manifest carrying one malformed chunk entry
        # (missing id_lo/id_hi, or a non-dict) must not crash resume; the bad
        # entry is dropped, the good one kept.
        m = {"chunks": [
            {"id_lo": None, "id_hi": None, "status": "verified"},   # malformed
            "not-a-dict",                                            # malformed
            _verified_chunk(2, 5, 8, 4),
        ]}
        out = elv.merge_chunk(m, _verified_chunk(1, 1, 4, 4))
        ranges = [(c["id_lo"], c["id_hi"]) for c in out["chunks"]]
        self.assertEqual(ranges, [(1, 4), (5, 8)])  # malformed dropped, no crash


class ResumeSkip(unittest.TestCase):
    """SCEN-002: skip only on (range present + sha256 + gzip_ok + rows==range_count)."""

    def setUp(self):
        self.pr = {"seq": 1, "id_lo": 1, "id_hi": 4}

    def test_skip_when_fully_verified(self):
        m = _manifest(1, 4, 4, [_verified_chunk(1, 1, 4, 4)])
        self.assertTrue(elv.resume_skip(self.pr, m))

    def test_no_skip_when_absent(self):
        self.assertFalse(elv.resume_skip(self.pr, elv.empty_manifest()))

    def test_no_skip_when_not_verified_status(self):
        c = _verified_chunk(1, 1, 4, 4)
        c["status"] = "failed"
        self.assertFalse(elv.resume_skip(self.pr, _manifest(1, 4, 4, [c])))

    def test_no_skip_when_sha_missing(self):
        c = _verified_chunk(1, 1, 4, 4)
        c["sha256"] = ""
        self.assertFalse(elv.resume_skip(self.pr, _manifest(1, 4, 4, [c])))

    def test_no_skip_when_gzip_flag_not_true(self):
        c = _verified_chunk(1, 1, 4, 4)
        c["gzip_ok"] = False
        self.assertFalse(elv.resume_skip(self.pr, _manifest(1, 4, 4, [c])))

    def test_no_skip_when_rows_ne_range_count(self):
        c = _verified_chunk(1, 1, 4, 4, range_count=5)  # rows 4 != range_count 5
        self.assertFalse(elv.resume_skip(self.pr, _manifest(1, 5, 5, [c])))


# =========================================================================== #
# SCEN-004 — chunk integrity: N1 row counter, gzip_ok, M9 empty-range guard.
# =========================================================================== #
class CountInsertRows(unittest.TestCase):
    """N1: count statements, never tuples/substrings — immune to `),(` & quoted text."""

    def test_counts_one_per_row(self):
        rows = [
            b"INSERT INTO `log_veh_available_rates_queries` VALUES (1,'a');\n",
            b"INSERT INTO `log_veh_available_rates_queries` VALUES (2,'b');\n",
            b"INSERT INTO `log_veh_available_rates_queries` VALUES (3,'c');\n",
        ]
        gz = _write_gz(rows)
        self.assertEqual(elv.count_insert_rows(gz), 3)

    def test_immune_to_paren_comma_paren_and_quoted_insert(self):
        # The N1 regression: a text field literally containing `),(` and a quoted
        # `INSERT INTO ...` substring must NOT inflate the count. Two rows only.
        rows = [
            b"INSERT INTO `log_veh_available_rates_queries` VALUES "
            b"(1,'payload with ),( inside and a fake INSERT INTO `x` substring');\n",
            b"INSERT INTO `log_veh_available_rates_queries` VALUES "
            b"(2,'another ),( ),( tuple-looking ),( text');\n",
        ]
        gz = _write_gz(rows)
        self.assertEqual(elv.count_insert_rows(gz), 2)  # NOT inflated by ),( or substring

    def test_other_table_insert_not_counted(self):
        rows = [
            b"INSERT INTO `log_veh_available_rates_queries` VALUES (1,'a');\n",
            b"INSERT INTO `some_other_table` VALUES (9,'z');\n",
        ]
        gz = _write_gz(rows)
        self.assertEqual(elv.count_insert_rows(gz), 1)  # only our table

    def test_zero_rows_for_empty_range(self):
        gz = _write_gz([])  # DDL only, no INSERTs
        self.assertEqual(elv.count_insert_rows(gz), 0)


class GzipOk(unittest.TestCase):
    def test_valid_gz_passes(self):
        gz = _write_gz([b"INSERT INTO `log_veh_available_rates_queries` VALUES (1,'a');\n"])
        self.assertTrue(elv.gzip_ok(gz))

    def test_truncated_gz_fails(self):
        gz = _write_gz([b"INSERT INTO `log_veh_available_rates_queries` VALUES (1,'a');\n"])
        raw = gz.read_bytes()
        gz.write_bytes(raw[: len(raw) // 2])  # truncate to corrupt CRC/length
        self.assertFalse(elv.gzip_ok(gz))

    def test_non_gzip_fails(self):
        fd, name = tempfile.mkstemp(suffix=".gz")
        import os
        os.write(fd, b"this is not gzip data at all")
        os.close(fd)
        self.assertFalse(elv.gzip_ok(name))


class VerifyChunkDecision(unittest.TestCase):
    """SCEN-004 + M9: row==range_count, and 0-row verified ONLY when range_count==0."""

    def test_verified_when_counts_match(self):
        self.assertEqual(elv.verify_chunk_decision(gzip_ok=True, rows=24930, range_count=24930),
                         (True, None))

    def test_rejected_on_gzip_failure(self):
        ok, reason = elv.verify_chunk_decision(gzip_ok=False, rows=10, range_count=10)
        self.assertFalse(ok)
        self.assertEqual(reason, "gzip_failed")

    def test_rejected_on_count_mismatch(self):
        ok, reason = elv.verify_chunk_decision(gzip_ok=True, rows=9, range_count=10)
        self.assertFalse(ok)
        self.assertEqual(reason, "row_count_mismatch")

    def test_empty_range_verified_only_when_range_count_zero(self):
        # M9: a genuine prune gap — 0 rows AND range_count 0 -> verified.
        self.assertEqual(elv.verify_chunk_decision(gzip_ok=True, rows=0, range_count=0),
                         (True, None))

    def test_empty_dump_over_nonempty_range_rejected(self):
        # M9: 0 rows but the source says the range has 5 -> silently-failed dump.
        ok, reason = elv.verify_chunk_decision(gzip_ok=True, rows=0, range_count=5)
        self.assertFalse(ok)
        self.assertEqual(reason, "empty_dump_nonempty_range")


# =========================================================================== #
# SCEN-007 — completeness verdict (exact 3-part rule) + late-arrival accounting.
# =========================================================================== #
class CompletenessVerdict(unittest.TestCase):
    def test_all_verified_partitioned_reconciled_is_true_exit0(self):
        m = _manifest(1, 8, 8, [_verified_chunk(1, 1, 4, 4), _verified_chunk(2, 5, 8, 4)])
        self.assertEqual(elv.completeness_verdict(m), (True, elv.EXIT_OK))

    def test_dropped_range_is_false_exit6(self):
        # Only [1,4] present; [5,8] dropped -> last hi != max_id_frozen.
        m = _manifest(1, 8, 8, [_verified_chunk(1, 1, 4, 4)])
        self.assertEqual(elv.completeness_verdict(m), (False, elv.EXIT_COMPLETENESS))

    def test_internal_gap_is_false_exit6(self):
        # [1,4] then [9,12] — gap at 5..8 (cur.lo 9 != prev.hi 4 + 1).
        m = _manifest(1, 12, 8, [_verified_chunk(1, 1, 4, 4), _verified_chunk(2, 9, 12, 4)])
        self.assertEqual(elv.completeness_verdict(m), (False, elv.EXIT_COMPLETENESS))

    def test_overlap_is_rejected_exit6(self):
        # [1,5] and [4,8] overlap at id 4..5 (cur.lo 4 <= prev.hi 5).
        m = _manifest(1, 8, 8, [_verified_chunk(1, 1, 5, 5), _verified_chunk(2, 4, 8, 5)])
        self.assertEqual(elv.completeness_verdict(m), (False, elv.EXIT_COMPLETENESS))

    def test_sum_rows_ne_reconciled_is_false_exit6(self):
        # Partition perfect, but sum(rows)=8 != reconciled 9.
        m = _manifest(1, 8, 9, [_verified_chunk(1, 1, 4, 4), _verified_chunk(2, 5, 8, 4)])
        self.assertEqual(elv.completeness_verdict(m), (False, elv.EXIT_COMPLETENESS))

    def test_unverified_chunk_is_false_exit6(self):
        c2 = _verified_chunk(2, 5, 8, 4)
        c2["status"] = "failed"
        m = _manifest(1, 8, 8, [_verified_chunk(1, 1, 4, 4), c2])
        self.assertEqual(elv.completeness_verdict(m), (False, elv.EXIT_COMPLETENESS))

    def test_no_chunks_is_false(self):
        self.assertEqual(elv.completeness_verdict(_manifest(1, 8, 8, [])),
                         (False, elv.EXIT_COMPLETENESS))

    def test_empty_range_chunk_counts_toward_partition(self):
        # A 0-row gap chunk [5,8] with range_count 0 still partitions the interval.
        m = _manifest(1, 8, 4, [_verified_chunk(1, 1, 4, 4),
                                _verified_chunk(2, 5, 8, 0, range_count=0)])
        self.assertEqual(elv.completeness_verdict(m), (True, elv.EXIT_OK))


class LateArrival(unittest.TestCase):
    """SCEN-007: id > max_id_frozen -> rows_arrived_during_run, never total_rows."""

    def test_late_arrival_count(self):
        self.assertEqual(elv.late_arrival_count(686903, 686855), 48)

    def test_no_late_arrivals_is_zero(self):
        self.assertEqual(elv.late_arrival_count(686855, 686855), 0)

    def test_never_negative(self):
        self.assertEqual(elv.late_arrival_count(686800, 686855), 0)

    def test_finalize_keeps_late_arrivals_out_of_total_rows(self):
        m = _manifest(1, 8, 8, [_verified_chunk(1, 1, 4, 4), _verified_chunk(2, 5, 8, 4)])
        out = elv.finalize_manifest(m, max_id_at_completion=20)
        self.assertEqual(out["total_rows"], 8)              # only the frozen range
        self.assertEqual(out["rows_arrived_during_run"], 12)  # 20 - 8, separate
        self.assertTrue(out["complete"])


class EmptyTableDisposition(unittest.TestCase):
    """Fix #8: an empty source table is complete:true/total_rows:0 (exit 0), NOT a
    completeness shortfall (exit 6) — "nothing to archive" != "missing data"."""

    def test_empty_table_manifest_is_complete_zero_rows(self):
        m = elv.build_empty_table_manifest(
            schema="rentacar_audit", generated_at="2026-06-04T00:00:00Z",
            charset="utf8mb4", source_ip_type="varchar(45)", chunk_rows=25000,
            updated_after=0, consistency="point-in-time")
        self.assertTrue(m["complete"])
        self.assertEqual(m["total_rows"], 0)
        self.assertTrue(m["empty_table"])
        self.assertIsNone(m["min_id"])
        self.assertIsNone(m["max_id_frozen"])
        self.assertEqual(m["chunks"], [])


# =========================================================================== #
# SCEN-006 — secrets hygiene: no password on argv, defaults-file builder, status.
# =========================================================================== #
class DefaultsExtraFile(unittest.TestCase):
    def test_password_under_mysqldump_section(self):
        content = elv.build_defaults_extra_file_content({
            "DB_USERNAME": "legacyuser", "DB_PASSWORD": "s3cr3t#pw",
            "DB_HOST": "127.0.0.1", "DB_PORT": "3307",
        })
        self.assertIn("[mysqldump]", content)
        self.assertIn("user=legacyuser", content)
        self.assertIn("password=s3cr3t#pw", content)  # hash preserved, not stripped

    def test_password_with_space_preserved_unquoted(self):
        content = elv.build_defaults_extra_file_content({
            "DB_USERNAME": "u", "DB_PASSWORD": "two words",
        })
        self.assertIn("password=two words", content)


class MysqldumpArgv(unittest.TestCase):
    """SCEN-006 + flag-construction guard: required flags present, NO -p<pass>."""

    def setUp(self):
        self.argv = elv.build_mysqldump_argv(
            defaults_file="/run/.defaults-extra.cnf", database="rentacar_audit",
            charset="utf8mb4", id_lo=22730, id_hi=47729,
        )

    def test_no_password_anywhere_on_argv(self):
        joined = " ".join(self.argv)
        self.assertNotIn("-p", " ".join(a for a in self.argv if a.startswith("-p")))
        for a in self.argv:
            self.assertFalse(a.startswith("-p"), f"password-style flag on argv: {a}")
        self.assertNotIn("password", joined.lower())

    def test_required_flags_present(self):
        for flag in ("--single-transaction", "--quick", "--no-tablespaces",
                     "--skip-lock-tables", "--hex-blob", "--skip-extended-insert"):
            self.assertIn(flag, self.argv)

    def test_runtime_charset_not_hardcoded(self):
        self.assertIn("--default-character-set=utf8mb4", self.argv)
        # A different detected charset flows through verbatim.
        argv = elv.build_mysqldump_argv(
            defaults_file="/x", database="d", charset="latin1", id_lo=1, id_hi=2)
        self.assertIn("--default-character-set=latin1", argv)

    def test_where_clause_bounds_the_range(self):
        self.assertIn("--where=id BETWEEN 22730 AND 47729", self.argv)

    def test_defaults_extra_file_is_first_option(self):
        self.assertTrue(self.argv[1].startswith("--defaults-extra-file="))

    def test_table_and_database_present(self):
        self.assertIn("rentacar_audit", self.argv)
        self.assertIn(elv.TABLE, self.argv)


class StatusShaping(unittest.TestCase):
    """SCEN-006: status is PII-free metadata only."""

    def test_status_keys_are_metadata_only(self):
        st = elv.build_status(chunks_done=3, chunks_total=27, bytes_written=500_000_000,
                              current_id=92730, last_advance_at="2026-06-04T01:00:00Z")
        self.assertEqual(set(st), {"chunks_done", "chunks_total", "bytes",
                                   "current_id", "last_advance"})
        for forbidden in ("source_ip", "response_raw", "request_parameters", "password"):
            self.assertNotIn(forbidden, st)

    def test_current_id_optional(self):
        st = elv.build_status(chunks_done=0, chunks_total=27, bytes_written=0,
                              current_id=None, last_advance_at="2026-06-04T01:00:00Z")
        self.assertIsNone(st["current_id"])


# =========================================================================== #
# SCEN-008 — credential extraction (parse only) + tunnel teardown keying.
# =========================================================================== #
class ParseLegacyEnv(unittest.TestCase):
    """Extracts ONLY the 5 DB_* keys; the blob is never returned whole."""

    BLOB = (
        "APP_NAME=Rentacar\n"
        "APP_KEY=base64:supersecretappkey==\n"
        "# database\n"
        "DB_CONNECTION=mysql\n"
        "DB_HOST=10.0.5.20\n"
        "DB_PORT=3306\n"
        "DB_DATABASE=rentacar_audit\n"
        "DB_USERNAME=legacy_ro\n"
        'DB_PASSWORD="p@ss word#1"\n'
        "MAIL_PASSWORD=anothersecret\n"
        "export DB_EXTRA=ignored\n"
    )

    def test_extracts_only_five_db_keys(self):
        creds = elv.parse_legacy_env(self.BLOB)
        self.assertEqual(set(creds), set(elv.LEGACY_ENV_KEYS))

    def test_values_correct_and_quotes_stripped(self):
        creds = elv.parse_legacy_env(self.BLOB)
        self.assertEqual(creds["DB_HOST"], "10.0.5.20")
        self.assertEqual(creds["DB_PORT"], "3306")
        self.assertEqual(creds["DB_DATABASE"], "rentacar_audit")
        self.assertEqual(creds["DB_USERNAME"], "legacy_ro")
        self.assertEqual(creds["DB_PASSWORD"], "p@ss word#1")  # quoted, space+hash kept

    def test_unrelated_secrets_never_leak(self):
        creds = elv.parse_legacy_env(self.BLOB)
        flat = json.dumps(creds)
        self.assertNotIn("supersecretappkey", flat)
        self.assertNotIn("anothersecret", flat)
        self.assertNotIn("DB_CONNECTION", creds)

    def test_inline_comment_on_unquoted_value_stripped(self):
        creds = elv.parse_legacy_env("DB_HOST=1.2.3.4 # primary\nDB_PORT=3306\n")
        self.assertEqual(creds["DB_HOST"], "1.2.3.4")


class ParseHandshake(unittest.TestCase):
    """SCEN-003 probe: True for a MariaDB greeting, False for dead/garbage."""

    def _greeting(self):
        # 3-byte length + seq 0 + protocol 10 + version "10.11.15-MariaDB"
        version = b"10.11.15-MariaDB\x00"
        payload = bytes([_tunnel.PROTOCOL_VERSION_10]) + version
        header = bytes([len(payload) & 0xFF, 0, 0, 0])
        return header + payload

    def test_true_for_mariadb_greeting(self):
        self.assertTrue(_tunnel.parse_handshake(self._greeting()))

    def test_false_for_empty(self):
        self.assertFalse(_tunnel.parse_handshake(b""))

    def test_false_for_short(self):
        self.assertFalse(_tunnel.parse_handshake(b"\x00\x00"))

    def test_false_for_garbage(self):
        self.assertFalse(_tunnel.parse_handshake(b"HTTP/1.1 200 OK\r\n"))

    def test_false_for_err_packet(self):
        # 0xFF payload byte = server ERR packet (alive but not a usable greeting).
        pkt = bytes([5, 0, 0, 0, _tunnel.ERR_PACKET_MARKER, 0x15, 0x04, 0x23, 0x30])
        self.assertFalse(_tunnel.parse_handshake(pkt))

    def test_false_for_protocol_10_without_version_byte(self):
        # protocol 10 but the next byte is a control char (noise, not a version).
        pkt = bytes([2, 0, 0, 0, _tunnel.PROTOCOL_VERSION_10, 0x01])
        self.assertFalse(_tunnel.parse_handshake(pkt))


class TunnelTeardownKeying(unittest.TestCase):
    """SCEN-008: teardown only a forwarder THIS driver created + tracked."""

    def test_should_teardown_own_tracked_tunnel(self):
        st = _tunnel.TunnelState(local_port=3307, created_by_us=True, pid=4242)
        self.assertTrue(_tunnel.should_teardown(st))

    def test_no_teardown_for_preexisting_operator_tunnel(self):
        st = _tunnel.TunnelState(local_port=3307, created_by_us=False, pid=4242)
        self.assertFalse(_tunnel.should_teardown(st))

    def test_no_teardown_without_pid(self):
        st = _tunnel.TunnelState(local_port=3307, created_by_us=True, pid=None)
        self.assertFalse(_tunnel.should_teardown(st))

    def test_teardown_noop_for_preexisting_returns_false(self):
        # teardown must NOT touch a pre-existing tunnel; returns False (no action).
        st = _tunnel.TunnelState(local_port=3307, created_by_us=False, pid=99999)
        self.assertFalse(_tunnel.teardown(st))


class SshForwardArgv(unittest.TestCase):
    def test_forces_loopback_and_keepalives(self):
        argv = _tunnel.build_ssh_forward_argv(3307, "10.0.5.20", 3306, "rentacar")
        joined = " ".join(argv)
        self.assertIn("127.0.0.1:3307:10.0.5.20:3306", joined)
        self.assertIn("ServerAliveInterval=30", joined)
        self.assertIn("ExitOnForwardFailure=yes", joined)
        self.assertIn("rentacar", argv)


# =========================================================================== #
# SCEN-009 — append-only gate decision (point-in-time / abort / eventual).
# =========================================================================== #
class AppendOnlyGate(unittest.TestCase):
    def test_zero_is_point_in_time(self):
        self.assertEqual(elv.append_only_gate_decision(0, allow_eventual=False),
                         "point-in-time")

    def test_positive_without_flag_aborts(self):
        self.assertEqual(elv.append_only_gate_decision(5, allow_eventual=False), "abort")

    def test_positive_with_flag_is_eventual(self):
        self.assertEqual(elv.append_only_gate_decision(5, allow_eventual=True), "eventual")

    def test_flag_irrelevant_when_zero(self):
        self.assertEqual(elv.append_only_gate_decision(0, allow_eventual=True),
                         "point-in-time")


# =========================================================================== #
# detect_schema parser (charset + source_ip storage type) — Step 7.
# =========================================================================== #
class DetectSchema(unittest.TestCase):
    SHOW_CREATE_VARCHAR = (
        "CREATE TABLE `log_veh_available_rates_queries` (\n"
        "  `id` bigint unsigned NOT NULL AUTO_INCREMENT,\n"
        "  `request_parameters` json NOT NULL,\n"
        "  `response_status` int NOT NULL,\n"
        "  `response_raw` longtext DEFAULT NULL,\n"
        "  `processed_data` json DEFAULT NULL,\n"
        "  `source_ip` varchar(45) DEFAULT NULL,\n"
        "  `created_at` timestamp NOT NULL,\n"
        "  `updated_at` timestamp NOT NULL,\n"
        "  PRIMARY KEY (`id`)\n"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    )
    SHOW_CREATE_INET6 = SHOW_CREATE_VARCHAR.replace(
        "`source_ip` varchar(45)", "`source_ip` inet6"
    ).replace("CHARSET=utf8mb4", "CHARSET=latin1")

    def test_extracts_charset_and_varchar_source_ip(self):
        charset, ip_type = elv.detect_schema(self.SHOW_CREATE_VARCHAR)
        self.assertEqual(charset, "utf8mb4")
        self.assertEqual(ip_type, "varchar(45)")

    def test_extracts_inet6_and_latin1(self):
        charset, ip_type = elv.detect_schema(self.SHOW_CREATE_INET6)
        self.assertEqual(charset, "latin1")
        self.assertEqual(ip_type, "inet6")

    def test_absent_fields_are_none(self):
        charset, ip_type = elv.detect_schema("CREATE TABLE `x` (`id` int)")
        self.assertIsNone(charset)
        self.assertIsNone(ip_type)

    def test_missing_charset_returns_none_for_caller_to_fail_loud(self):
        # Fix #6: detect_schema returns charset=None when DEFAULT CHARSET is absent
        # so the CALLER fails loud (exit 3) instead of assuming utf8mb4. This test
        # pins the None contract the caller relies on (no silent fallback).
        no_charset = (
            "CREATE TABLE `log_veh_available_rates_queries` (\n"
            "  `source_ip` varchar(45) DEFAULT NULL\n"
            ") ENGINE=InnoDB"
        )
        charset, ip_type = elv.detect_schema(no_charset)
        self.assertIsNone(charset)            # caller must NOT default this to utf8mb4
        self.assertEqual(ip_type, "varchar(45)")


class UnlinkDefaultsFile(unittest.TestCase):
    """Fix #2: the 0600 creds file is removed on exit; the helper is idempotent."""

    def test_removes_existing_file(self):
        fd, name = tempfile.mkstemp(suffix=".cnf")
        import os
        os.write(fd, b"[mysqldump]\npassword=secret\n")
        os.close(fd)
        self.assertTrue(Path(name).exists())
        self.assertTrue(elv.unlink_defaults_file(name))
        self.assertFalse(Path(name).exists())  # gone

    def test_idempotent_on_missing_file(self):
        # Callable from finally AND atexit without raising even if already gone.
        self.assertTrue(elv.unlink_defaults_file("/nonexistent/path/.defaults.cnf"))


# =========================================================================== #
# Watchdog / deadline / stall loop — INJECTED clock + INJECTED chunk-runner.
# =========================================================================== #
class _FakeClock:
    """Monotonic clock that advances a fixed step on each call."""

    def __init__(self, start=0.0, step=1.0):
        self.t = start
        self.step = step

    def __call__(self):
        v = self.t
        self.t += self.step
        return v


class ChunkLoopHappyPath(unittest.TestCase):
    """SCEN-002 end-to-end (stubbed): every range dumped+verified -> complete."""

    def test_all_chunks_verified_reaches_complete(self):
        planned = elv.plan_ranges(1, 8, 4)  # [1,4],[5,8]
        manifest = _manifest(1, 8, 8, [])

        def runner(pr):
            return _verified_chunk(pr["seq"], pr["id_lo"], pr["id_hi"], 4)

        clock = _FakeClock(step=1.0)
        out = elv.run_chunk_loop(
            planned, manifest, chunk_runner=runner, clock=clock,
            run_deadline_at=10_000, max_retries=3)
        out = elv.finalize_manifest(out, max_id_at_completion=8)
        self.assertEqual(elv.completeness_verdict(out), (True, elv.EXIT_OK))

    def test_resume_does_not_redump_verified(self):
        planned = elv.plan_ranges(1, 8, 4)
        manifest = _manifest(1, 8, 8, [_verified_chunk(1, 1, 4, 4)])  # [1,4] already done
        dumped = []

        def runner(pr):
            dumped.append((pr["id_lo"], pr["id_hi"]))
            return _verified_chunk(pr["seq"], pr["id_lo"], pr["id_hi"], 4)

        out = elv.run_chunk_loop(
            planned, manifest, chunk_runner=runner, clock=_FakeClock(),
            run_deadline_at=10_000, max_retries=3)
        self.assertEqual(dumped, [(5, 8)])  # only the missing range re-dumped
        self.assertEqual(elv.finalize_manifest(out)["total_rows"], 8)


class ChunkLoopRetryAndShortfall(unittest.TestCase):
    """SCEN-004/007: a range failing all retries stays unverified -> shortfall."""

    def test_retry_then_succeed(self):
        planned = elv.plan_ranges(1, 4, 4)
        manifest = _manifest(1, 4, 4, [])
        attempts = {"n": 0}

        def runner(pr):
            attempts["n"] += 1
            if attempts["n"] < 2:
                return {"seq": pr["seq"], "id_lo": pr["id_lo"], "id_hi": pr["id_hi"],
                        "status": "failed", "reason": "row_count_mismatch"}
            return _verified_chunk(pr["seq"], pr["id_lo"], pr["id_hi"], 4)

        out = elv.run_chunk_loop(
            planned, manifest, chunk_runner=runner, clock=_FakeClock(),
            run_deadline_at=10_000, max_retries=3)
        self.assertEqual(attempts["n"], 2)
        self.assertEqual(elv.completeness_verdict(out), (True, elv.EXIT_OK))

    def test_persistent_failure_leaves_range_unverified(self):
        planned = elv.plan_ranges(1, 8, 4)
        manifest = _manifest(1, 8, 8, [])

        def runner(pr):
            if pr["id_lo"] == 5:  # [5,8] never succeeds
                return {"seq": pr["seq"], "id_lo": pr["id_lo"], "id_hi": pr["id_hi"],
                        "status": "failed", "reason": "timeout"}
            return _verified_chunk(pr["seq"], pr["id_lo"], pr["id_hi"], 4)

        out = elv.run_chunk_loop(
            planned, manifest, chunk_runner=runner, clock=_FakeClock(),
            run_deadline_at=10_000, max_retries=3)
        complete, exit_code = elv.completeness_verdict(out)
        self.assertFalse(complete)
        self.assertEqual(exit_code, elv.EXIT_COMPLETENESS)  # shortfall, not deadline


class ChunkLoopDeadline(unittest.TestCase):
    """RUN_DEADLINE breach -> RunDeadlineExceeded (caller exits 5), not 6."""

    def test_deadline_raises_before_exhausting_loop(self):
        planned = elv.plan_ranges(1, 1000, 4)  # many chunks
        manifest = _manifest(1, 1000, 1000, [])

        def runner(pr):
            return _verified_chunk(pr["seq"], pr["id_lo"], pr["id_hi"], 4)

        # Clock advances 1/call; deadline at 5 trips after a couple of chunks.
        with self.assertRaises(elv.RunDeadlineExceeded):
            elv.run_chunk_loop(
                planned, manifest, chunk_runner=runner, clock=_FakeClock(step=1.0),
                run_deadline_at=5, max_retries=3)

    def test_verified_chunks_persisted_before_deadline_raise(self):
        # Incremental persist (fix #3): chunks verified BEFORE the deadline are
        # already on disk via the persist callback, so a deadline raise (or any
        # interrupt) never loses them.
        planned = elv.plan_ranges(1, 1000, 4)
        manifest = _manifest(1, 1000, 1000, [])
        persisted = {"last": None}

        def runner(pr):
            return _verified_chunk(pr["seq"], pr["id_lo"], pr["id_hi"], 4)

        def persist(m):
            persisted["last"] = [(c["id_lo"], c["id_hi"]) for c in m["chunks"]]

        with self.assertRaises(elv.RunDeadlineExceeded):
            elv.run_chunk_loop(
                planned, manifest, chunk_runner=runner, clock=_FakeClock(step=1.0),
                run_deadline_at=5, max_retries=3, persist=persist)
        # At least one chunk was persisted before the deadline tripped.
        self.assertIsNotNone(persisted["last"])
        self.assertGreaterEqual(len(persisted["last"]), 1)


class ChunkLoopHealthySlowChunk(unittest.TestCase):
    """CRITICAL fix #1: a verified chunk whose wall-time exceeds the old
    stall window is STILL merged — the loop never discards a healthy slow chunk.
    The old code measured the chunk's OWN duration and discarded a 12-min chunk;
    that was the bug. A ~1.1 GiB chunk over the tunnel routinely runs many minutes.
    """

    def test_slow_verified_chunks_all_merged_run_completes(self):
        planned = elv.plan_ranges(1, 8, 4)  # [1,4],[5,8]
        manifest = _manifest(1, 8, 8, [])

        def runner(pr):
            return _verified_chunk(pr["seq"], pr["id_lo"], pr["id_hi"], 4)

        # A clock that jumps 1000s per call simulates each chunk taking ~16 min —
        # far past any plausible old stall window. The run MUST still complete.
        out = elv.run_chunk_loop(
            planned, manifest, chunk_runner=runner, clock=_FakeClock(step=1000.0),
            run_deadline_at=10_000_000, max_retries=3)
        self.assertEqual(len(out["chunks"]), 2)  # both slow chunks merged
        out = elv.finalize_manifest(out, max_id_at_completion=8)
        self.assertEqual(elv.completeness_verdict(out), (True, elv.EXIT_OK))

    def test_verified_runner_called_once_per_range_no_spurious_retry(self):
        # A verified result is trusted on the first attempt — no retry storm just
        # because the chunk was slow.
        planned = elv.plan_ranges(1, 4, 4)
        manifest = _manifest(1, 4, 4, [])
        calls = {"n": 0}

        def runner(pr):
            calls["n"] += 1
            return _verified_chunk(pr["seq"], pr["id_lo"], pr["id_hi"], 4)

        elv.run_chunk_loop(
            planned, manifest, chunk_runner=runner, clock=_FakeClock(step=1000.0),
            run_deadline_at=10_000_000, max_retries=3)
        self.assertEqual(calls["n"], 1)  # called once, merged, not retried


class ChunkLoopIncrementalPersist(unittest.TestCase):
    """Fix #3: an exception escaping mid-loop still leaves verified chunks on disk."""

    def test_raise_midloop_leaves_persisted_progress(self):
        planned = elv.plan_ranges(1, 12, 4)  # [1,4],[5,8],[9,12]
        manifest = _manifest(1, 12, 12, [])
        snapshots = []

        def persist(m):
            snapshots.append([(c["id_lo"], c["id_hi"]) for c in m["chunks"]])

        class _Boom(RuntimeError):
            pass

        def runner(pr):
            if pr["id_lo"] == 9:  # third range blows up (simulated tunnel error)
                raise _Boom("tunnel relaunch failed")
            return _verified_chunk(pr["seq"], pr["id_lo"], pr["id_hi"], 4)

        with self.assertRaises(_Boom):
            elv.run_chunk_loop(
                planned, manifest, chunk_runner=runner, clock=_FakeClock(),
                run_deadline_at=10_000, max_retries=3, persist=persist)
        # The two ranges verified before the raise were persisted incrementally.
        self.assertEqual(snapshots[-1], [(1, 4), (5, 8)])


# =========================================================================== #
# No-PII manifest surface (defensive parity with Phase 1).
# =========================================================================== #
class ManifestPiiFree(unittest.TestCase):
    PII_KEYS = {"request_parameters", "processed_data", "source_ip", "response_raw"}

    def test_finalized_manifest_has_no_row_payload_keys(self):
        m = _manifest(1, 8, 8, [_verified_chunk(1, 1, 4, 4), _verified_chunk(2, 5, 8, 4)])
        out = elv.finalize_manifest(m, max_id_at_completion=8)
        self.assertEqual(self.PII_KEYS & set(out), set())
        for c in out["chunks"]:
            self.assertEqual(self.PII_KEYS & set(c), set())


if __name__ == "__main__":
    unittest.main(verbosity=2)
