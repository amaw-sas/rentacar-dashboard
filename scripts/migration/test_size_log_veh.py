#!/usr/bin/env python3
"""Unit tests for size-log-veh.py pure functions.

Runs on bare Python — NO pymysql / no DB. The DB driver is imported lazily inside
connect_legacy() only, so importing this module (and the script) never needs it.

Encodes the unit-level surface of the issue #45 Phase-1 holdout scenarios:
  SCEN-002 (validate_env), SCEN-004 (timed-out count branch),
  SCEN-006 (PII-free report key set), SCEN-007 (kill-switch-unconfirmed branch).

Run:  python scripts/migration/test_size_log_veh.py
  or:  python -m unittest scripts.migration.test_size_log_veh -v
"""

from __future__ import annotations

import importlib.util
import os
import unittest
from pathlib import Path

# Import the hyphenated-filename module by path (not a legal `import` name).
_SPEC_PATH = Path(__file__).resolve().parent / "size-log-veh.py"
_spec = importlib.util.spec_from_file_location("size_log_veh", _SPEC_PATH)
slv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(slv)


# Forbidden keys that would indicate a row payload (PII) leaked into the report.
PII_KEYS = {
    "request_parameters",
    "processed_data",
    "source_ip",
    "response_raw",
    "response_status",
}


def _metadata():
    return {
        "approx_rows": 503123,
        "data_bytes": 1_073_741_824,
        "index_bytes": 16_777_216,
        "data_free_bytes": 0,
        "avg_row_bytes": 2048,
        "engine": "InnoDB",
    }


def _span():
    return {
        "first_id": 1,
        "first_created_at": "2022-03-01 10:00:00",
        "last_id": 503123,
        "last_created_at": "2026-06-03 09:00:00",
    }


def _measured(**over):
    base = {
        "table": "log_veh_available_rates_queries",
        "schema": "rentacar_audit",
        "budget_s": 15,
        "kill_switch_confirmed": True,
        "max_statement_time_readback": 15.0,
        "metadata": _metadata(),
        "span": _span(),
        "exact_count": {"value": 503123},
        "exact_range_requested": False,
        "exact_range": None,
    }
    base.update(over)
    return base


class ValidateEnv(unittest.TestCase):
    """SCEN-002: missing/empty LEGACY_DB_* is reported; LEGACY_DB_PORT is optional."""

    def setUp(self):
        self._saved = {k: os.environ.get(k) for k in slv.REQUIRED_ENV + ["LEGACY_DB_PORT"]}
        for k in slv.REQUIRED_ENV:
            os.environ[k] = "x"
        os.environ.pop("LEGACY_DB_PORT", None)

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_all_present_returns_empty(self):
        self.assertEqual(slv.validate_env(), [])

    def test_blank_password_is_missing(self):
        os.environ["LEGACY_DB_PASSWORD"] = ""
        self.assertEqual(slv.validate_env(), ["LEGACY_DB_PASSWORD"])

    def test_unset_host_is_missing(self):
        os.environ.pop("LEGACY_DB_HOST", None)
        self.assertIn("LEGACY_DB_HOST", slv.validate_env())

    def test_port_is_never_required(self):
        # LEGACY_DB_PORT absent AND blank must never appear in the missing list.
        os.environ.pop("LEGACY_DB_PORT", None)
        self.assertNotIn("LEGACY_DB_PORT", slv.validate_env())
        os.environ["LEGACY_DB_PORT"] = ""
        self.assertNotIn("LEGACY_DB_PORT", slv.validate_env())


class FormatBytes(unittest.TestCase):
    def test_humanizes(self):
        self.assertEqual(slv.format_bytes(0), "0 B")
        self.assertEqual(slv.format_bytes(1023), "1023 B")
        self.assertEqual(slv.format_bytes(1024), "1.0 KiB")
        self.assertEqual(slv.format_bytes(1536), "1.5 KiB")
        self.assertEqual(slv.format_bytes(1_073_741_824), "1.0 GiB")

    def test_none_passthrough(self):
        self.assertEqual(slv.format_bytes(None), "n/a")


class BuildSummaryHappy(unittest.TestCase):
    """SCEN-001 unit surface + SCEN-006 PII-free key set."""

    def test_exact_count_value_present(self):
        rep = slv.build_summary(_measured(), generated_at="2026-06-03T00:00:00Z")
        self.assertEqual(rep["exact_rows"], {"value": 503123})
        self.assertEqual(rep["approx_rows"], 503123)
        self.assertEqual(rep["total_bytes"], 1_073_741_824 + 16_777_216)
        self.assertEqual(rep["span_source"], "pk_proxy")
        self.assertTrue(rep["kill_switch"]["confirmed"])

    def test_report_is_pii_free(self):
        rep = slv.build_summary(_measured(), generated_at="2026-06-03T00:00:00Z")
        self.assertEqual(PII_KEYS & set(rep.keys()), set())
        # And the whole key set is within the declared allowed surface.
        self.assertTrue(set(rep.keys()).issubset(slv.ALLOWED_REPORT_KEYS),
                        msg=f"unexpected keys: {set(rep.keys()) - slv.ALLOWED_REPORT_KEYS}")


class BuildSummaryTimedOut(unittest.TestCase):
    """SCEN-004: a protected heavy tier that the server time-boxed."""

    def test_timed_out_count_renders_null_plus_budget(self):
        m = _measured(exact_count={"value": None, "timed_out_after_s": 1}, budget_s=1)
        rep = slv.build_summary(m, generated_at="2026-06-03T00:00:00Z")
        self.assertEqual(rep["exact_rows"], {"value": None, "timed_out_after_s": 1})
        # Cheap tiers still populated.
        self.assertEqual(rep["approx_rows"], 503123)
        self.assertIsNotNone(rep["first_created_at"])
        # And it is flagged in notes.
        self.assertTrue(any("timed out" in n.lower() for n in rep["notes"]))


class BuildSummaryKillSwitchUnconfirmed(unittest.TestCase):
    """SCEN-007: kill-switch did not take effect → scanning tiers skipped."""

    def test_count_and_range_skipped(self):
        m = _measured(
            kill_switch_confirmed=False,
            max_statement_time_readback=0.0,
            exact_count=None,
            exact_range_requested=True,
            exact_range=None,
        )
        rep = slv.build_summary(m, generated_at="2026-06-03T00:00:00Z")
        self.assertEqual(rep["exact_rows"], {"skipped": "kill_switch_unconfirmed"})
        self.assertEqual(rep["exact_range"], {"skipped": "kill_switch_unconfirmed"})
        # Safe tiers survive.
        self.assertEqual(rep["approx_rows"], 503123)
        self.assertIsNotNone(rep["last_created_at"])
        self.assertFalse(rep["kill_switch"]["confirmed"])
        self.assertTrue(any("kill_switch_unconfirmed" in n for n in rep["notes"]))


class BuildSummaryExactRange(unittest.TestCase):
    def test_range_not_requested_is_skipped(self):
        rep = slv.build_summary(_measured(), generated_at="2026-06-03T00:00:00Z")
        self.assertEqual(rep["exact_range"], {"skipped": "not_requested"})

    def test_range_requested_and_measured(self):
        m = _measured(
            exact_range_requested=True,
            exact_range={"min": "2022-03-01 10:00:00", "max": "2026-06-03 09:00:00"},
        )
        rep = slv.build_summary(m, generated_at="2026-06-03T00:00:00Z")
        self.assertEqual(rep["exact_range"]["max"], "2026-06-03 09:00:00")


class _FakeOpErr(Exception):
    """Stand-in for pymysql.err.OperationalError: args[0] is the errno."""


class IsTimeout(unittest.TestCase):
    """Regression guard (review HIGH): only a real statement-timeout is a timeout.

    A resource-limit error ('...has exceeded the ... resource', errno 1226) must
    NOT be misclassified as a benign timeout — that would hide a real failure
    behind exit 0 instead of exit 3.
    """

    def test_mariadb_timeout_errno(self):
        self.assertTrue(slv._is_timeout(_FakeOpErr(1969, "Query execution was interrupted "
                                                          "(max_statement_time exceeded)")))

    def test_mysql_timeout_errno(self):
        self.assertTrue(slv._is_timeout(_FakeOpErr(3024, "Query execution was interrupted, "
                                                          "maximum statement execution time exceeded")))

    def test_resource_limit_is_not_a_timeout(self):
        exc = _FakeOpErr(1226, "User 'x' has exceeded the 'max_questions' resource "
                               "(current value: 100)")
        self.assertFalse(slv._is_timeout(exc))

    def test_lock_wait_is_not_a_timeout(self):
        self.assertFalse(slv._is_timeout(_FakeOpErr(1205, "Lock wait timeout exceeded; "
                                                          "try restarting transaction")))

    def test_message_fallback_when_errno_absent(self):
        self.assertTrue(slv._is_timeout(_FakeOpErr("max_statement_time exceeded")))


class BudgetValidation(unittest.TestCase):
    """Regression guard (review MEDIUM): reject budget <=0 (MariaDB 0 = unlimited)."""

    def setUp(self):
        self._saved = {k: os.environ.get(k) for k in slv.REQUIRED_ENV}
        for k in slv.REQUIRED_ENV:
            os.environ[k] = "x"  # valid env so a 4 can only come from the budget guard

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_zero_budget_rejected(self):
        self.assertEqual(slv.main(["--budget", "0"]), slv.EXIT_ENV_MISSING)

    def test_negative_budget_rejected(self):
        self.assertEqual(slv.main(["--budget", "-5"]), slv.EXIT_ENV_MISSING)

    def test_oversize_budget_rejected(self):
        self.assertEqual(slv.main(["--budget", "301"]), slv.EXIT_ENV_MISSING)


class FormatSummaryTableRobust(unittest.TestCase):
    """A re-rendered/trimmed report (e.g. a Phase-2 consumer loading a saved JSON
    with kill_switch/exact_rows/notes dropped) must render, not crash the run into
    EXIT_UNEXPECTED after the report was already written."""

    def test_full_report_renders(self):
        rep = slv.build_summary(_measured(), generated_at="2026-06-04T00:00:00+00:00")
        self.assertIn("kill-switch", slv.format_summary_table(rep))

    def test_trimmed_report_does_not_crash(self):
        rep = slv.build_summary(_measured(), generated_at="2026-06-04T00:00:00+00:00")
        for k in ("kill_switch", "exact_rows", "notes"):
            rep.pop(k, None)
        out = slv.format_summary_table(rep)  # must not raise KeyError
        self.assertIn("Legacy table sizing", out)
        self.assertIn("UNCONFIRMED", out)  # missing kill_switch → falsy → UNCONFIRMED


if __name__ == "__main__":
    unittest.main(verbosity=2)
