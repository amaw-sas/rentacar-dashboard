#!/usr/bin/env python3
"""Unit tests for the pure transforms in etl-reservations.py (issue #20).

STEP 2 (skeleton) encodes the pure-checkable parts of SCEN-009 (env / connection
contract): `validate_env` returns the missing-var list for absent/empty vars,
and `mask_db_url` NEVER returns the password substring for a variety of URL
shapes. The #20-specific transform / FK-resolution scenarios
(SCEN-003/004/005/006/010/011) are authored in steps 3-8, alongside their
implementations.

Runs on BARE Python (no pymysql / psycopg2 / dotenv) — proof that the DB drivers
are imported lazily and the scaffolding is pure.

The ETL module filename is hyphenated (etl-reservations.py), which is NOT a legal
Python `import` name, so it is loaded from its path via importlib.

Run:
  python3 -m unittest scripts.migration.test_etl_reservations -v
  # or
  python3 -m unittest discover -s scripts/migration -p 'test_*.py' -v
  # or
  python3 scripts/migration/test_etl_reservations.py
"""

from __future__ import annotations

import importlib.util
import os
import sys
import unittest
from pathlib import Path

# --------------------------------------------------------------------------- #
# Load the hyphenated ETL module from its file path.
#
# The module MUST be registered in sys.modules under the spec name BEFORE
# exec_module: @dataclass with string annotations (from __future__ import
# annotations) resolves the owning module via sys.modules[cls.__module__] when
# building fields, and an unregistered module makes that lookup return None.
# --------------------------------------------------------------------------- #
_ETL_PATH = Path(__file__).resolve().parent / "etl-reservations.py"
_spec = importlib.util.spec_from_file_location("etl_reservations", _ETL_PATH)
assert _spec and _spec.loader, f"cannot load spec for {_ETL_PATH}"
etl = importlib.util.module_from_spec(_spec)
sys.modules["etl_reservations"] = etl
_spec.loader.exec_module(etl)


# --------------------------------------------------------------------------- #
# SCEN-009 (pure parts): mask_db_url is a SECURITY BOUNDARY — it must never emit
# a single password byte, across every URL shape (with password, with port, with
# query params, malformed). The whole point of masking is so the destination URL
# can be printed on stderr (exit 2) without leaking the credential.
# --------------------------------------------------------------------------- #
class TestMaskDbUrl(unittest.TestCase):
    def test_password_never_leaks_basic(self):
        masked = etl.mask_db_url(
            "postgresql://user:s3cr3t-p%40ss@db.example.com:5432/postgres"
        )
        self.assertNotIn("s3cr3t", masked)
        self.assertNotIn("s3cr3t-p%40ss", masked)
        self.assertIn("***", masked)
        self.assertIn("db.example.com", masked)

    def test_password_never_leaks_with_port(self):
        masked = etl.mask_db_url("postgresql://u:hunter2@127.0.0.1:1/db")
        self.assertNotIn("hunter2", masked)
        self.assertIn("***", masked)
        self.assertIn("127.0.0.1:1", masked)

    def test_password_never_leaks_with_query_params(self):
        masked = etl.mask_db_url(
            "postgresql://admin:topsecret@host:6543/db?sslmode=require&pool=true"
        )
        self.assertNotIn("topsecret", masked)
        self.assertIn("***", masked)
        self.assertIn("host:6543", masked)

    def test_password_with_at_sign_in_password_never_leaks(self):
        # A literal '@' inside the password is the adversarial case for naive
        # split-on-'@': the masker keeps only the substring after the LAST '@',
        # which is the host/path, so no password byte survives.
        masked = etl.mask_db_url("postgresql://u:p@ss@word@db.host:5432/postgres")
        self.assertNotIn("p@ss@word", masked)
        self.assertNotIn("ss@word", masked)
        self.assertIn("***", masked)

    def test_no_userinfo_keeps_host(self):
        masked = etl.mask_db_url("postgresql://db.host:5432/postgres")
        self.assertIn("db.host:5432", masked)
        self.assertIn("***", masked)

    def test_malformed_fully_redacted(self):
        self.assertEqual(etl.mask_db_url("garbage"), "postgresql://***@***/***")

    def test_empty_fully_redacted(self):
        self.assertEqual(etl.mask_db_url(""), "postgresql://***@***/***")

    def test_password_with_special_chars_never_leaks(self):
        # Common pooler password alphabet: a long random secret must not survive.
        secret = "Xy7!q-Z_a%9bC.dEfG"
        masked = etl.mask_db_url(
            f"postgresql://postgres.proj:{secret}@aws-0-us.pooler.supabase.com:6543/postgres"
        )
        self.assertNotIn(secret, masked)
        self.assertNotIn("Xy7", masked)
        self.assertIn("***", masked)


# --------------------------------------------------------------------------- #
# SCEN-009 (pure parts): validate_env returns the set of required vars that are
# missing OR present-but-empty (an empty value is treated as missing — a gate
# must not run half-configured). main() turns a non-empty list into exit 4 and
# names the vars on stderr, with NO DB opened.
# --------------------------------------------------------------------------- #
class TestValidateEnv(unittest.TestCase):
    REQUIRED = [
        "LEGACY_DB_HOST",
        "LEGACY_DB_USER",
        "LEGACY_DB_PASSWORD",
        "LEGACY_DB_NAME",
        "SUPABASE_DB_URL",
    ]

    def setUp(self):
        # Snapshot + clear all required vars so each test controls the env fully.
        self._saved = {k: os.environ.get(k) for k in self.REQUIRED}
        for k in self.REQUIRED:
            os.environ.pop(k, None)

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_required_env_is_the_five_vars(self):
        self.assertEqual(etl.REQUIRED_ENV, self.REQUIRED)

    def test_all_present_returns_empty(self):
        for k in self.REQUIRED:
            os.environ[k] = "value"
        self.assertEqual(etl.validate_env(), [])

    def test_all_missing_returns_all_five(self):
        self.assertEqual(etl.validate_env(), self.REQUIRED)

    def test_single_missing_var_named(self):
        for k in self.REQUIRED:
            os.environ[k] = "value"
        os.environ.pop("SUPABASE_DB_URL", None)
        self.assertEqual(etl.validate_env(), ["SUPABASE_DB_URL"])

    def test_empty_value_treated_as_missing(self):
        for k in self.REQUIRED:
            os.environ[k] = "value"
        os.environ["LEGACY_DB_PASSWORD"] = ""  # present but empty == missing.
        self.assertEqual(etl.validate_env(), ["LEGACY_DB_PASSWORD"])

    def test_missing_list_preserves_required_order(self):
        for k in self.REQUIRED:
            os.environ[k] = "value"
        os.environ.pop("LEGACY_DB_HOST", None)
        os.environ.pop("LEGACY_DB_NAME", None)
        # Order follows REQUIRED_ENV, not insertion/removal order.
        self.assertEqual(etl.validate_env(), ["LEGACY_DB_HOST", "LEGACY_DB_NAME"])


# --------------------------------------------------------------------------- #
# normalize_identification is REUSED VERBATIM from #19 and is the customer-FK
# lookup key (step 6). Lock its contract here so a future edit that breaks the
# join key (which would cascade-reject every reservation) fails loudly.
# --------------------------------------------------------------------------- #
class TestNormalizeIdentification(unittest.TestCase):
    def test_dots_removed(self):
        self.assertEqual(etl.normalize_identification("12.345.678"), "12345678")

    def test_spaces_removed(self):
        self.assertEqual(etl.normalize_identification("12 345 678"), "12345678")

    def test_passport_keeps_letters_drops_dash(self):
        self.assertEqual(etl.normalize_identification("AB-12345"), "AB12345")

    def test_already_clean_unchanged(self):
        self.assertEqual(etl.normalize_identification("12345678"), "12345678")

    def test_surrounding_whitespace_stripped(self):
        self.assertEqual(etl.normalize_identification("  12-345  "), "12345")

    def test_none_and_empty(self):
        self.assertEqual(etl.normalize_identification(None), "")
        self.assertEqual(etl.normalize_identification(""), "")


if __name__ == "__main__":
    unittest.main()
