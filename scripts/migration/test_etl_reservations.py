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


# --------------------------------------------------------------------------- #
# SCEN-004: status maps via a CLOSED dict (the 13 canonical legacy values ->
# snake_case destination). ANYTHING outside the 13 — including the historical
# 'Terminado' (0 rows in the dump, but the rule must hold defensively) — signals
# a `status_unmapped` reject, NEVER a blind lower(replace()) guess and NEVER a
# row that lets the destination CHECK constraint explode as a raw SQL error.
# --------------------------------------------------------------------------- #
class TestStatusMap(unittest.TestCase):
    CANONICAL = {
        "Nueva": "nueva",
        "Pendiente": "pendiente",
        "Reservado": "reservado",
        "Sin disponibilidad": "sin_disponibilidad",
        "Utilizado": "utilizado",
        "No Contactado": "no_contactado",
        "Baneado": "baneado",
        "No recogido": "no_recogido",
        "Pendiente Pago": "pendiente_pago",
        "Pendiente Modificar": "pendiente_modificar",
        "Cancelado": "cancelado",
        "Indeterminado": "indeterminado",
        "Mensualidad": "mensualidad",
    }

    def test_status_map_dict_is_the_13_canonical(self):
        self.assertEqual(etl.STATUS_MAP, self.CANONICAL)

    def test_all_13_canonical_values_map_to_destination(self):
        for legacy, dest in self.CANONICAL.items():
            self.assertEqual(etl.map_status(legacy), dest)

    def test_terminado_rejects_status_unmapped(self):
        # 'Terminado' is the legacy initial value (0 rows in dump). It is
        # intentionally NOT in the map — it must reject, not be guessed.
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.map_status("Terminado")
        self.assertEqual(ctx.exception.reason, "status_unmapped")

    def test_unknown_string_rejects_status_unmapped(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.map_status("Whatever Garbage")
        self.assertEqual(ctx.exception.reason, "status_unmapped")

    def test_none_rejects_status_unmapped(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.map_status(None)
        self.assertEqual(ctx.exception.reason, "status_unmapped")

    def test_case_or_spacing_variant_rejects_not_guessed(self):
        # A lowercased / blind-replaced variant must NOT silently resolve — the
        # map is exact, so 'nueva' (already snake) is NOT a legacy key.
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.map_status("nueva")
        self.assertEqual(ctx.exception.reason, "status_unmapped")


# --------------------------------------------------------------------------- #
# SCEN-005: booking_type derivation is a TOTAL function (never rejects). Rule:
# monthly_mileage is not None -> 'monthly' (wins regardless of total_insurance);
# elif total_insurance is True -> 'standard_with_insurance'; else 'standard'.
# --------------------------------------------------------------------------- #
class TestBookingType(unittest.TestCase):
    def test_monthly_mileage_present_is_monthly(self):
        self.assertEqual(etl.derive_booking_type(2000, False), "monthly")

    def test_null_mileage_with_insurance_is_standard_with_insurance(self):
        self.assertEqual(
            etl.derive_booking_type(None, True), "standard_with_insurance"
        )

    def test_null_mileage_no_insurance_is_standard(self):
        self.assertEqual(etl.derive_booking_type(None, False), "standard")

    def test_monthly_wins_over_insurance(self):
        # monthly_mileage non-None takes precedence even when insurance is True.
        self.assertEqual(etl.derive_booking_type(1000, True), "monthly")

    def test_monthly_mileage_zero_is_still_monthly(self):
        # 0 is "not None" — a present mileage value, not absence.
        self.assertEqual(etl.derive_booking_type(0, False), "monthly")

    def test_none_insurance_treated_as_not_true(self):
        # total_insurance None (not True) falls through to 'standard'.
        self.assertEqual(etl.derive_booking_type(None, None), "standard")


# --------------------------------------------------------------------------- #
# SCEN-011 (mileage): map_monthly_mileage enum -> int. The three legacy enum
# values map to 1000/2000/3000; None -> None; ANY other non-null value is a
# defensive `monthly_mileage_unmapped` reject (never silently coerced).
# --------------------------------------------------------------------------- #
class TestMonthlyMileage(unittest.TestCase):
    def test_known_enums_map_to_int(self):
        self.assertEqual(etl.map_monthly_mileage("1k_kms"), 1000)
        self.assertEqual(etl.map_monthly_mileage("2k_kms"), 2000)
        self.assertEqual(etl.map_monthly_mileage("3k_kms"), 3000)

    def test_none_maps_to_none(self):
        self.assertIsNone(etl.map_monthly_mileage(None))

    def test_unknown_value_rejects(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.map_monthly_mileage("5k_kms")
        self.assertEqual(ctx.exception.reason, "monthly_mileage_unmapped")

    def test_empty_string_rejects(self):
        # An empty/blank non-null value is not a known enum -> defensive reject.
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.map_monthly_mileage("")
        self.assertEqual(ctx.exception.reason, "monthly_mileage_unmapped")


# --------------------------------------------------------------------------- #
# SCEN-011 (numeric overflow): coerce_numeric rounds to 2 decimals (numeric
# (12,2)); a value above the numeric(12,2) ceiling (> 9,999,999,999.99) signals
# a `numeric_overflow` reject — never truncated, never let to explode the DB
# numeric-range constraint. coerce_smallint range-guards <= 32767.
# --------------------------------------------------------------------------- #
class TestCoerceNumeric(unittest.TestCase):
    def test_rounds_to_two_decimals(self):
        # Half-cent values round to 2 decimals (numeric(12,2)). Float internals:
        # 12.345 is stored as 12.34500...0063 (just above the half) -> 12.35.
        self.assertEqual(etl.coerce_numeric(12.345), 12.35)
        self.assertEqual(etl.coerce_numeric(12.344), 12.34)
        self.assertEqual(etl.coerce_numeric(99.999), 100.0)

    def test_integer_value_passthrough(self):
        self.assertEqual(etl.coerce_numeric(100), 100.0)

    def test_none_passthrough(self):
        self.assertIsNone(etl.coerce_numeric(None))

    def test_known_outlier_under_ceiling_migrates(self):
        # ID 7721 = 816,999,989 (~$817M COP) is BELOW the numeric(12,2) ceiling
        # and migrates as-is (no overflow).
        self.assertEqual(etl.coerce_numeric(816_999_989), 816_999_989.0)

    def test_value_at_ceiling_ok(self):
        # Exactly the max numeric(12,2) is allowed.
        self.assertEqual(etl.coerce_numeric(9_999_999_999.99), 9_999_999_999.99)

    def test_overflow_rejects_not_truncated(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.coerce_numeric(10_000_000_000.00)
        self.assertEqual(ctx.exception.reason, "numeric_overflow")

    def test_overflow_by_rounding_rejects(self):
        # A value that rounds UP past the ceiling overflows, not silently capped.
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.coerce_numeric(9_999_999_999.999)
        self.assertEqual(ctx.exception.reason, "numeric_overflow")


class TestCoerceSmallint(unittest.TestCase):
    def test_in_range_passthrough(self):
        self.assertEqual(etl.coerce_smallint(30), 30)
        self.assertEqual(etl.coerce_smallint(32767), 32767)

    def test_none_passthrough(self):
        self.assertIsNone(etl.coerce_smallint(None))

    def test_above_smallint_max_rejects(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.coerce_smallint(32768)
        self.assertEqual(ctx.exception.reason, "numeric_overflow")


class TestReturnFee(unittest.TestCase):
    def test_none_becomes_zero(self):
        self.assertEqual(etl.coerce_return_fee(None), 0)

    def test_present_value_rounds(self):
        self.assertEqual(etl.coerce_return_fee(15.5), 15.5)

    def test_overflow_rejects(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.coerce_return_fee(10_000_000_000.00)
        self.assertEqual(ctx.exception.reason, "numeric_overflow")


# --------------------------------------------------------------------------- #
# SCEN-002: resolve_customer_id keys the in-memory customer map by
# normalize_identification(legacy.identification). A normalized id ABSENT from
# the map signals `customer_not_migrated` (a placeholder customer #19 discarded
# cascade-rejects here) — never an exception, never a NULL/guessed FK insert.
# --------------------------------------------------------------------------- #
class TestResolveCustomerId(unittest.TestCase):
    CUSTOMER_MAP = {
        "12345678": "11111111-1111-1111-1111-111111111111",
        "AB12345": "22222222-2222-2222-2222-222222222222",
    }

    def test_resolves_present_id(self):
        self.assertEqual(
            etl.resolve_customer_id("12.345.678", self.CUSTOMER_MAP),
            "11111111-1111-1111-1111-111111111111",
        )

    def test_resolves_via_same_normalization_as_19(self):
        # 'AB-12345' normalizes to 'AB12345' (the persisted #19 key).
        self.assertEqual(
            etl.resolve_customer_id("AB-12345", self.CUSTOMER_MAP),
            "22222222-2222-2222-2222-222222222222",
        )

    def test_resolve_customer_missing(self):
        # Placeholder discarded by #19 -> absent from the map -> cascade reject.
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.resolve_customer_id("0000000", self.CUSTOMER_MAP)
        self.assertEqual(ctx.exception.reason, "customer_not_migrated")

    def test_reject_reason_carries_no_identification(self):
        # No-PII contract: the reason string must not embed the identification.
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.resolve_customer_id("99999999", self.CUSTOMER_MAP)
        self.assertEqual(ctx.exception.reason, "customer_not_migrated")
        self.assertNotIn("99999999", ctx.exception.reason)


# --------------------------------------------------------------------------- #
# SCEN-003 (null) + SCEN-010 (unmapped): resolve_location takes a legacy BRANCH
# id + a pre-joined branch_id -> location_id map. NULL legacy location ->
# `{side}_location_null`; a present branch id whose code/branch has no
# destination location -> `{side}_location_unmapped` (DISTINCT reason, so a
# broken branches.code<->locations.code mapping is observable, not lost in the
# NULL bucket). Never imputes, never inserts a guessed FK.
#
# Location-map shape (documented choice): a single PRE-JOINED dict
# `branch_id -> location_id`, built destination-side by joining
# legacy.branches.code -> locations.code once. A branch id present as a KEY with
# a non-None value resolves; a branch id ABSENT (or mapped to None) is the
# `_unmapped` path. NULL legacy branch id (None) is the `_null` path. This
# collapses the two-hop (branch_id -> branch.code -> location.id) into one
# lookup the resolver can check in O(1) without re-deriving codes per row.
# --------------------------------------------------------------------------- #
class TestResolveLocation(unittest.TestCase):
    # branch_id -> destination location id (pre-joined via branch.code == location.code)
    LOCATION_MAP = {
        10: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        20: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    }

    def test_resolves_pickup(self):
        self.assertEqual(
            etl.resolve_location(10, self.LOCATION_MAP, "pickup"),
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        )

    def test_resolves_return(self):
        self.assertEqual(
            etl.resolve_location(20, self.LOCATION_MAP, "return"),
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        )

    def test_resolve_location_null_pickup(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.resolve_location(None, self.LOCATION_MAP, "pickup")
        self.assertEqual(ctx.exception.reason, "pickup_location_null")

    def test_resolve_location_null_return(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.resolve_location(None, self.LOCATION_MAP, "return")
        self.assertEqual(ctx.exception.reason, "return_location_null")

    def test_resolve_location_unmapped_pickup(self):
        # Branch id present (not NULL) but absent from the map -> unmapped,
        # DISTINCT from the null path (SCEN-010).
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.resolve_location(999, self.LOCATION_MAP, "pickup")
        self.assertEqual(ctx.exception.reason, "pickup_location_unmapped")

    def test_resolve_location_unmapped_return(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.resolve_location(999, self.LOCATION_MAP, "return")
        self.assertEqual(ctx.exception.reason, "return_location_unmapped")

    def test_null_and_unmapped_are_distinct_reasons(self):
        with self.assertRaises(etl.RejectRow) as null_ctx:
            etl.resolve_location(None, self.LOCATION_MAP, "pickup")
        with self.assertRaises(etl.RejectRow) as unmapped_ctx:
            etl.resolve_location(999, self.LOCATION_MAP, "pickup")
        self.assertNotEqual(null_ctx.exception.reason, unmapped_ctx.exception.reason)


# --------------------------------------------------------------------------- #
# SCEN-011 (category): resolve_category_code maps legacy category id -> its
# code, validating the code exists in the destination vehicle_categories set.
# Missing legacy id OR a code absent from the destination set -> `category_unmapped`.
# --------------------------------------------------------------------------- #
class TestResolveCategoryCode(unittest.TestCase):
    # legacy category id -> code (legacy.categories.id -> identification),
    # with the resolved code validated against the destination code set.
    CATEGORY_MAP = {
        1: "GR",
        2: "VP",
        3: "GHOST",  # legacy code with NO destination vehicle_categories row.
    }
    DEST_CODES = frozenset({"GR", "VP", "G", "LP"})

    def test_resolves_valid_code(self):
        self.assertEqual(
            etl.resolve_category_code(1, self.CATEGORY_MAP, self.DEST_CODES), "GR"
        )

    def test_missing_legacy_id_rejects(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.resolve_category_code(99, self.CATEGORY_MAP, self.DEST_CODES)
        self.assertEqual(ctx.exception.reason, "category_unmapped")

    def test_resolve_category_unmapped(self):
        # Legacy id resolves to a code, but that code is not in the destination
        # vehicle_categories set -> reject (S3 breach observable).
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.resolve_category_code(3, self.CATEGORY_MAP, self.DEST_CODES)
        self.assertEqual(ctx.exception.reason, "category_unmapped")


# --------------------------------------------------------------------------- #
# SCEN-011 (franchise): resolve_franchise maps legacy franchise id -> name ->
# the destination enum {alquilatucarro, alquilame, alquicarros}. A name outside
# the enum (or a missing id) -> `franchise_unmapped`.
# --------------------------------------------------------------------------- #
class TestResolveFranchise(unittest.TestCase):
    # legacy franchise id -> destination enum value.
    FRANCHISE_MAP = {
        1: "alquilatucarro",
        2: "alquilame",
        3: "alquicarros",
    }

    def test_resolves_each_enum(self):
        self.assertEqual(etl.resolve_franchise(1, self.FRANCHISE_MAP), "alquilatucarro")
        self.assertEqual(etl.resolve_franchise(2, self.FRANCHISE_MAP), "alquilame")
        self.assertEqual(etl.resolve_franchise(3, self.FRANCHISE_MAP), "alquicarros")

    def test_resolve_franchise_unmapped(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.resolve_franchise(99, self.FRANCHISE_MAP)
        self.assertEqual(ctx.exception.reason, "franchise_unmapped")


# --------------------------------------------------------------------------- #
# SCEN-006: resolve_referral returns (referral_id, referral_raw). It NEVER
# rejects — referral is optional. referral_raw = TRIM(legacy.user) or None when
# null/empty; referral_id = map.get(lower(trim(user))) or None. CRITICAL:
# referral_raw is preserved even when referral_id is None (free-text user).
# --------------------------------------------------------------------------- #
class TestResolveReferral(unittest.TestCase):
    REFERRAL_MAP = {
        "promo2024": "cccccccc-cccc-cccc-cccc-cccccccccccc",
        "partnerx": "dddddddd-dddd-dddd-dddd-dddddddddddd",
    }

    def test_resolve_referral_match(self):
        # (i) known code -> (uuid, trimmed-original).
        rid, raw = etl.resolve_referral("  PROMO2024 ", self.REFERRAL_MAP)
        self.assertEqual(rid, "cccccccc-cccc-cccc-cccc-cccccccccccc")
        self.assertEqual(raw, "PROMO2024")

    def test_resolve_referral_unmatched(self):
        # (ii) free text not in the map -> (None, trimmed-original) PRESERVED.
        rid, raw = etl.resolve_referral("  Some Free Text ", self.REFERRAL_MAP)
        self.assertIsNone(rid)
        self.assertEqual(raw, "Some Free Text")

    def test_resolve_referral_null(self):
        self.assertEqual(etl.resolve_referral(None, self.REFERRAL_MAP), (None, None))

    def test_resolve_referral_empty_string(self):
        self.assertEqual(etl.resolve_referral("   ", self.REFERRAL_MAP), (None, None))

    def test_referral_never_rejects(self):
        # Even garbage (with real surrounding whitespace) never raises a
        # RejectRow — referral is optional. .strip() removes the whitespace.
        try:
            rid, raw = etl.resolve_referral("\t\n garbage \t", self.REFERRAL_MAP)
        except etl.RejectRow:
            self.fail("resolve_referral must never reject")
        self.assertIsNone(rid)
        self.assertEqual(raw, "garbage")


# --------------------------------------------------------------------------- #
# Defensive input hardening (code-review I-1/I-2/I-3, M-5). The legacy schema
# guarantees these inputs are str/float/int/None, so none of these fire on the
# real dump — but Phase 3 runs every transform inside a per-row
# `try/except RejectRow`, and an AttributeError/ValueError/TypeError would ESCAPE
# that handler, leaving a legacy row with NO disposition and breaking the
# reconciliation invariant (the acceptance criterion). So a malformed input must
# become a logged disposition (RejectRow) or a clean value, never an uncaught
# crash. Mirrors the #19 "coerce at the boundary" posture (_sanitize_text).
# --------------------------------------------------------------------------- #
class TestDefensiveInputHardening(unittest.TestCase):
    def test_map_status_unhashable_rejects_not_crashes(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.map_status(["Nueva"])  # unhashable — must not raise TypeError
        self.assertEqual(ctx.exception.reason, "status_unmapped")

    def test_map_status_non_string_rejects(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.map_status(123)
        self.assertEqual(ctx.exception.reason, "status_unmapped")

    def test_coerce_numeric_non_numeric_string_rejects_not_crashes(self):
        for bad in ("", "abc", "1,234.50"):
            with self.assertRaises(etl.RejectRow) as ctx:
                etl.coerce_numeric(bad)
            self.assertEqual(ctx.exception.reason, "numeric_overflow")

    def test_coerce_smallint_non_numeric_string_rejects_not_crashes(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.coerce_smallint("abc")
        self.assertEqual(ctx.exception.reason, "numeric_overflow")

    def test_coerce_return_fee_none_is_float_zero(self):
        result = etl.coerce_return_fee(None)
        self.assertEqual(result, 0.0)
        self.assertIsInstance(result, float)  # uniform with coerce_numeric

    def test_resolve_referral_non_string_does_not_crash(self):
        # int legacy_user — must coerce, never AttributeError, never reject.
        rid, raw = etl.resolve_referral(12345, {})
        self.assertIsNone(rid)
        self.assertEqual(raw, "12345")


# --------------------------------------------------------------------------- #
# Step 7-8 fixtures: a fully-populated LegacyRow + the destination lookup maps,
# and a fake dest cursor/connection that records inserted `_legacy_id`s and
# simulates ON CONFLICT (_legacy_id) DO NOTHING (the exact pattern #19's
# test_etl_customers.py uses). NO real DB — the module imports lazily.
# --------------------------------------------------------------------------- #
from datetime import datetime, timezone  # noqa: E402


def _rdt(year, month=1, day=1):
    return datetime(year, month, day, tzinfo=timezone.utc)


# Destination FK targets shared across the pipeline tests. Built once,
# destination-side, exactly as build_lookup_maps would produce them.
_LOCALIZA_ID = "00000000-0000-0000-0000-0000000000aa"
_CUSTOMER_MAP = {
    "12345678": "11111111-1111-1111-1111-111111111111",
    "87654321": "33333333-3333-3333-3333-333333333333",
}
_LOCATION_MAP = {10: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", 20: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}
_CATEGORY_MAP = {1: "GR", 2: "VP"}
_DEST_CODES = frozenset({"GR", "VP", "G", "LP"})
_FRANCHISE_MAP = {1: "alquilatucarro", 2: "alquilame", 3: "alquicarros"}
_REFERRAL_MAP = {"promo2024": "cccccccc-cccc-cccc-cccc-cccccccccccc"}


def _maps():
    """Return the 6-map bundle (the build_lookup_maps output shape)."""
    return etl.LookupMaps(
        customer_map=dict(_CUSTOMER_MAP),
        location_map=dict(_LOCATION_MAP),
        category_map=dict(_CATEGORY_MAP),
        dest_category_codes=frozenset(_DEST_CODES),
        franchise_map=dict(_FRANCHISE_MAP),
        referral_map=dict(_REFERRAL_MAP),
        rental_company_id=_LOCALIZA_ID,
    )


def _legacy_res(
    row_id,
    *,
    identification="12345678",
    status="Nueva",
    category=1,
    pickup_location=10,
    return_location=20,
    franchise=1,
    user="",
    reserve_code="RC-1",
    note="",
    monthly_mileage=None,
    total_insurance=False,
):
    """A fully-populated, resolvable LegacyRow (every FK present in the maps)."""
    return etl.LegacyRow(
        row_id=row_id,
        fullname="JUAN PEREZ",
        identification=identification,
        identification_type="Cedula Ciudadania",
        status=status,
        category=category,
        pickup_location=pickup_location,
        return_location=return_location,
        franchise=franchise,
        user=user,
        reserve_code=reserve_code,
        note=note,
        pickup_date="2024-06-01",
        pickup_hour="08:00:00",
        return_date="2024-06-05",
        return_hour="10:00:00",
        selected_days=4,
        total_price=100.0,
        total_price_to_pay=100,
        total_price_localiza=80.0,
        tax_fee=5.0,
        iva_fee=2.0,
        coverage_days=4,
        coverage_price=10.0,
        return_fee=None,
        extra_hours=0,
        extra_hours_price=0.0,
        total_insurance=total_insurance,
        extra_driver=False,
        baby_seat=False,
        wash=False,
        aeroline=None,
        flight_number=None,
        monthly_mileage=monthly_mileage,
        ghl_contact_id=None,
        ghl_opportunity_id=None,
        ghl_last_sync=None,
        created_at=_rdt(2024, 6, 1),
        updated_at=_rdt(2024, 6, 2),
    )


class _FakeDestCursor:
    """Records inserted `_legacy_id`s; simulates ON CONFLICT (_legacy_id) DO NOTHING.

    Shared persistent state across runs (passed in) so a second run sees the
    first run's rows already present and skips them (SCEN-007 idempotency).
    The production code calls psycopg2.extras.execute_values(cur, sql, values,
    fetch=True); the test monkeypatches execute_values to route INSERT through
    insert_one and SELECT (classify_skips) through select_markers.

    `values` row tuples put `_legacy_id` at the SECOND-TO-LAST position and
    `_legacy_migrated_at` LAST (the INSERT_SQL column order). RETURNING is
    `_legacy_id` first — matching `for legacy_id, *_ in returned`.
    """

    def __init__(self, existing_ids: dict[int, datetime]):
        # existing_ids: {_legacy_id: _legacy_migrated_at} already in the dest.
        self.existing = existing_ids
        self._returning: list[tuple] = []
        self._select_chunk: list[int] = []
        self.executed: list[str] = []

    # --- control statements (SAVEPOINT / RELEASE / ROLLBACK) + classify SELECT.
    def execute(self, sql, params=None):
        self.executed.append(sql)
        self._returning = []
        if sql.strip().upper().startswith("SELECT"):
            # classify_skips SELECT ... WHERE _legacy_id = ANY(%s)
            self._select_chunk = list(params[0]) if params else []
            self._returning = [
                (lid, self.existing.get(lid)) for lid in self._select_chunk
            ]

    def fetchall(self):
        return self._returning

    def close(self):
        pass

    # --- driven by the monkeypatched execute_values (INSERT path).
    def insert_one(self, legacy_id: int, migrated_at: datetime):
        if legacy_id in self.existing:
            return []  # ON CONFLICT DO NOTHING — no RETURNING row.
        self.existing[legacy_id] = migrated_at
        return [(legacy_id,)]


class _FakeDestConn:
    def __init__(self, cur):
        self._cur = cur
        self.committed = False
        self.rolled_back = False

    def cursor(self):
        return self._cur

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


class _PipelineHarness:
    """Monkeypatches psycopg2.extras.execute_values to drive a _FakeDestCursor.

    INSERT  -> route each row through cur.insert_one(_legacy_id, migrated_at).
    The _legacy_id sits at values[i][LEGACY_ID_IDX]; migrated_at at the LAST
    position. ON CONFLICT skips return no RETURNING row, so the inserted set is
    exactly the genuinely-new ids — the contract the engine + classify rely on.
    """

    def __enter__(self):
        import types

        legacy_idx = etl.LEGACY_ID_INSERT_INDEX

        def fake_execute_values(cur, sql, values, fetch=False):
            returned: list[tuple] = []
            for row in values:
                legacy_id = row[legacy_idx]
                migrated_at = row[-1]
                returned.extend(cur.insert_one(legacy_id, migrated_at))
            return returned

        fake_extras = types.SimpleNamespace(execute_values=fake_execute_values)
        fake_psycopg2 = types.ModuleType("psycopg2")
        fake_psycopg2.extras = fake_extras
        self._saved = sys.modules.get("psycopg2")
        sys.modules["psycopg2"] = fake_psycopg2
        return self

    def __exit__(self, *exc):
        if self._saved is not None:
            sys.modules["psycopg2"] = self._saved
        else:
            del sys.modules["psycopg2"]
        return False


# --------------------------------------------------------------------------- #
# Step 7: transform_row maps EVERY destination column. Resolvable row -> a
# ReservationRecord carrying resolved FKs + transforms + passthroughs + markers;
# an unresolvable FK -> RejectRow with the taxonomy reason (short-circuit).
# --------------------------------------------------------------------------- #
class TestTransformRow(unittest.TestCase):
    def test_resolvable_row_maps_all_columns(self):
        rec = etl.transform_row(_legacy_res(7), _maps())
        self.assertEqual(rec.legacy_id, 7)
        self.assertEqual(rec.customer_id, _CUSTOMER_MAP["12345678"])
        self.assertEqual(rec.rental_company_id, _LOCALIZA_ID)
        self.assertEqual(rec.pickup_location_id, _LOCATION_MAP[10])
        self.assertEqual(rec.return_location_id, _LOCATION_MAP[20])
        self.assertEqual(rec.category_code, "GR")
        self.assertEqual(rec.franchise, "alquilatucarro")
        self.assertEqual(rec.status, "nueva")
        self.assertEqual(rec.booking_type, "standard")
        self.assertEqual(rec.reservation_code, "RC-1")
        self.assertIsNone(rec.referral_id)
        self.assertIsNone(rec.referral_raw)
        # Defaults with no legacy source.
        self.assertIsNone(rec.reference_token)
        self.assertIsNone(rec.rate_qualifier)
        self.assertIsNone(rec.created_by)
        self.assertIsNone(rec.notification_sent_at)
        self.assertIsNone(rec.notification_sent_by)
        self.assertFalse(rec.notification_required)
        self.assertFalse(rec.notification_sent)
        # return_fee NULL -> 0.
        self.assertEqual(rec.return_fee, 0.0)

    def test_status_maps_to_destination(self):
        rec = etl.transform_row(_legacy_res(1, status="Pendiente Pago"), _maps())
        self.assertEqual(rec.status, "pendiente_pago")

    def test_booking_type_monthly_when_mileage(self):
        rec = etl.transform_row(_legacy_res(1, monthly_mileage="2k_kms"), _maps())
        self.assertEqual(rec.booking_type, "monthly")
        self.assertEqual(rec.monthly_mileage, 2000)

    def test_booking_type_with_insurance(self):
        rec = etl.transform_row(_legacy_res(1, total_insurance=True), _maps())
        self.assertEqual(rec.booking_type, "standard_with_insurance")
        self.assertTrue(rec.total_insurance)

    def test_reservation_code_null_preserved(self):
        rec = etl.transform_row(_legacy_res(1, reserve_code=None), _maps())
        self.assertIsNone(rec.reservation_code)

    def test_note_renamed_to_nota(self):
        rec = etl.transform_row(_legacy_res(1, note="alergia gatos"), _maps())
        self.assertEqual(rec.nota, "alergia gatos")

    def test_referral_resolves_and_raw_preserved(self):
        rec = etl.transform_row(_legacy_res(1, user="  PROMO2024 "), _maps())
        self.assertEqual(rec.referral_id, _REFERRAL_MAP["promo2024"])
        self.assertEqual(rec.referral_raw, "PROMO2024")

    def test_referral_raw_preserved_when_unmatched(self):
        rec = etl.transform_row(_legacy_res(1, user="  Diana  "), _maps())
        self.assertIsNone(rec.referral_id)
        self.assertEqual(rec.referral_raw, "Diana")

    def test_missing_customer_raises_reject(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.transform_row(_legacy_res(1, identification="0000000"), _maps())
        self.assertEqual(ctx.exception.reason, "customer_not_migrated")

    def test_null_pickup_location_raises_reject(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.transform_row(_legacy_res(1, pickup_location=None), _maps())
        self.assertEqual(ctx.exception.reason, "pickup_location_null")

    def test_unknown_status_raises_reject(self):
        with self.assertRaises(etl.RejectRow) as ctx:
            etl.transform_row(_legacy_res(1, status="Terminado"), _maps())
        self.assertEqual(ctx.exception.reason, "status_unmapped")

    def test_record_tuple_has_marker_columns(self):
        rec = etl.transform_row(_legacy_res(42), _maps())
        migrated_at = _rdt(2026, 5, 28)
        tup = etl._record_to_tuple(rec, migrated_at)
        # _legacy_id at the documented index, _legacy_migrated_at LAST.
        self.assertEqual(tup[etl.LEGACY_ID_INSERT_INDEX], 42)
        self.assertEqual(tup[-1], migrated_at)
        # Column count of the tuple matches the INSERT_SQL column list.
        ncols = etl.INSERT_SQL.split("(", 2)[1].count(",") + 1
        self.assertEqual(len(tup), ncols)


# --------------------------------------------------------------------------- #
# SCEN-001 (reconciliation): a synthetic legacy set (resolvable + missing
# customer + null location) -> inserted + skipped + rejected == total; every
# inserted row carries _legacy_id + the marker; every reject carries a taxonomy
# reason. Fake dest cursor records inserted ids and simulates ON CONFLICT.
# --------------------------------------------------------------------------- #
class TestPipelineReconciliation(unittest.TestCase):
    def _rows(self):
        return [
            _legacy_res(1),  # resolvable -> inserted
            _legacy_res(2, identification="87654321"),  # resolvable -> inserted
            _legacy_res(3, identification="0000000"),  # missing customer -> reject
            _legacy_res(4, pickup_location=None),  # null location -> reject
        ]

    def test_reconciles_and_markers_present(self):
        extract = etl.ExtractResult(rows=self._rows(), legacy_rows_total=4)
        cur = _FakeDestCursor(existing_ids={})
        conn = _FakeDestConn(cur)
        migrated_at = _rdt(2026, 5, 28)
        with _PipelineHarness():
            outcome = etl.run_pipeline(
                conn, _maps(), extract, migrated_at, dry_run=False
            )
        summary = outcome.summary
        # 2 inserted + 0 skipped + 2 rejected == 4 total.
        self.assertEqual(summary["inserted"], 2)
        self.assertEqual(summary["skipped_total"], 0)
        self.assertEqual(summary["rejected_total"], 2)
        recon = summary["reconciliation"]
        self.assertTrue(recon["reconciles"], recon)
        self.assertEqual(recon["sum"], 4)
        self.assertEqual(recon["legacy_rows_total"], 4)
        # Each inserted _legacy_id is recorded with the marker timestamp.
        self.assertEqual(set(cur.existing.keys()), {1, 2})
        self.assertTrue(all(v == migrated_at for v in cur.existing.values()))
        # Each reject carries a taxonomy reason.
        self.assertEqual(
            summary["rejected"],
            {"customer_not_migrated": 1, "pickup_location_null": 1},
        )
        # Gate passed (only taxonomy rejects, reconciliation closes) -> commit.
        self.assertTrue(conn.committed)
        self.assertFalse(conn.rolled_back)
        self.assertTrue(outcome.committed)

    def test_report_lines_have_per_row_disposition(self):
        extract = etl.ExtractResult(rows=self._rows(), legacy_rows_total=4)
        cur = _FakeDestCursor(existing_ids={})
        conn = _FakeDestConn(cur)
        with _PipelineHarness():
            outcome = etl.run_pipeline(
                conn, _maps(), extract, _rdt(2026, 5, 28), dry_run=False
            )
        actions = sorted(line["action"] for line in outcome.report_lines)
        self.assertEqual(actions, ["inserted", "inserted", "rejected", "rejected"])
        # No PII (identification) anywhere in a report line: only legacy_id +
        # reason + non-PII fields.
        for line in outcome.report_lines:
            self.assertNotIn("identification", line)
            self.assertIn("legacy_id", line)


# --------------------------------------------------------------------------- #
# SCEN-007 (idempotency): run twice against the same fake cursor state; the
# second run inserts 0, classifies every candidate `already_migrated`, and no
# _legacy_id duplicates (the existing set is unchanged in size).
# --------------------------------------------------------------------------- #
class TestPipelineIdempotency(unittest.TestCase):
    def _rows(self):
        return [_legacy_res(1), _legacy_res(2, identification="87654321")]

    def test_second_run_inserts_zero_all_already_migrated(self):
        cur = _FakeDestCursor(existing_ids={})
        conn = _FakeDestConn(cur)
        migrated_at = _rdt(2026, 5, 28)

        with _PipelineHarness():
            first = etl.run_pipeline(
                _FakeDestConn(cur), _maps(),
                etl.ExtractResult(rows=self._rows(), legacy_rows_total=2),
                migrated_at, dry_run=False,
            )
            self.assertEqual(first.summary["inserted"], 2)
            ids_after_first = set(cur.existing.keys())

            second = etl.run_pipeline(
                _FakeDestConn(cur), _maps(),
                etl.ExtractResult(rows=self._rows(), legacy_rows_total=2),
                _rdt(2026, 5, 29), dry_run=False,  # later run stamp.
            )

        summary = second.summary
        self.assertEqual(summary["inserted"], 0)
        self.assertEqual(summary["skipped_total"], 2)
        self.assertEqual(summary["skipped"], {"already_migrated": 2})
        self.assertEqual(summary["rejected_total"], 0)
        self.assertTrue(summary["reconciliation"]["reconciles"])
        # No duplicate _legacy_id: the existing set is identical, not doubled.
        self.assertEqual(set(cur.existing.keys()), ids_after_first)
        self.assertEqual(len(cur.existing), 2)
        # The original marker timestamps are NOT overwritten (no churn).
        self.assertTrue(all(v == migrated_at for v in cur.existing.values()))
        self.assertTrue(second.committed)


# --------------------------------------------------------------------------- #
# build_lookup_maps composition: the customer/referral maps come straight from
# dest cursors; location/franchise/category COMPOSE legacy id->code/name with
# the destination code->id / name->enum rule. Fake cursors return canned rows.
# --------------------------------------------------------------------------- #
class _SeqCursor:
    """A cursor whose successive execute() calls yield successive canned result
    sets (FIFO), matching the order build_lookup_maps issues its queries."""

    def __init__(self, result_sets):
        self._queue = list(result_sets)
        self._current: list = []

    def execute(self, sql, params=None):
        self._current = self._queue.pop(0) if self._queue else []

    def fetchall(self):
        return self._current

    def fetchone(self):
        return self._current[0] if self._current else None

    def close(self):
        pass


class TestBuildLookupMaps(unittest.TestCase):
    def test_composes_six_maps(self):
        # Legacy cursor: branches (id, code), categories (id, identification),
        # franchises (id, name) — the order build_lookup_maps reads them.
        legacy_cur = _SeqCursor(
            [
                [(10, "BOG01"), (20, "MDE01")],  # branches
                [(1, "GR"), (2, "VP")],  # categories
                [(1, "alquilatucarro"), (2, "alquilame"), (3, "alquicarros")],  # franchises
            ]
        )
        # Dest cursor: customers, locations (code, id), vehicle_categories code,
        # referrals (code, id), rental_companies localiza id.
        dest_cur = _SeqCursor(
            [
                [("12345678", "uuid-cust-1")],  # customers
                [("BOG01", "uuid-loc-10"), ("MDE01", "uuid-loc-20")],  # locations
                [("GR",), ("VP",), ("G",), ("LP",)],  # vehicle_categories codes
                [("promo2024", "uuid-ref-1")],  # referrals
                [("uuid-localiza",)],  # rental_companies WHERE code='localiza'
            ]
        )
        maps = etl.build_lookup_maps(legacy_cur, dest_cur)
        self.assertEqual(maps.customer_map, {"12345678": "uuid-cust-1"})
        # location_map composes legacy branch_id -> branch.code -> location.id.
        self.assertEqual(
            maps.location_map, {10: "uuid-loc-10", 20: "uuid-loc-20"}
        )
        self.assertEqual(maps.category_map, {1: "GR", 2: "VP"})
        self.assertEqual(maps.dest_category_codes, frozenset({"GR", "VP", "G", "LP"}))
        self.assertEqual(
            maps.franchise_map,
            {1: "alquilatucarro", 2: "alquilame", 3: "alquicarros"},
        )
        self.assertEqual(maps.referral_map, {"promo2024": "uuid-ref-1"})
        self.assertEqual(maps.rental_company_id, "uuid-localiza")

    def test_referral_keyed_lowercase(self):
        legacy_cur = _SeqCursor([[], [], []])
        dest_cur = _SeqCursor(
            [
                [],  # customers
                [],  # locations
                [],  # vehicle_categories
                [("PromoXYZ", "uuid-ref-2")],  # referrals — mixed case
                [("uuid-localiza",)],
            ]
        )
        maps = etl.build_lookup_maps(legacy_cur, dest_cur)
        # resolve_referral keys by lower(trim(user)); the map must be lowercased.
        self.assertEqual(maps.referral_map, {"promoxyz": "uuid-ref-2"})


if __name__ == "__main__":
    unittest.main()
