#!/usr/bin/env python3
"""Unit tests for the pure transforms in etl-customers.py (issue #19).

Encodes the unit-level scenarios SCEN-002/003/004/006 BEFORE the ETL touches a
DB. Runs on BARE Python (no pymysql / psycopg2 / dotenv) — proof that the DB
drivers are imported lazily and the transforms are pure.

The ETL module filename is hyphenated (etl-customers.py), which is NOT a legal
Python `import` name, so it is loaded from its path via importlib.

Run:
  python3 -m unittest discover -s scripts/migration -p 'test_*.py' -v
  # or
  python3 scripts/migration/test_etl_customers.py
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

# --------------------------------------------------------------------------- #
# Load the hyphenated ETL module from its file path.
#
# The module MUST be registered in sys.modules under the spec name BEFORE
# exec_module: @dataclass with string annotations (from __future__ import
# annotations) resolves the owning module via sys.modules[cls.__module__] when
# building fields, and an unregistered module makes that lookup return None.
# --------------------------------------------------------------------------- #
_ETL_PATH = Path(__file__).resolve().parent / "etl-customers.py"
_spec = importlib.util.spec_from_file_location("etl_customers", _ETL_PATH)
assert _spec and _spec.loader, f"cannot load spec for {_ETL_PATH}"
etl = importlib.util.module_from_spec(_spec)
sys.modules["etl_customers"] = etl
_spec.loader.exec_module(etl)


def _ts(year: int, month: int = 1, day: int = 1) -> datetime:
    return datetime(year, month, day, tzinfo=timezone.utc)


def _legacy(
    row_id: int,
    fullname: str,
    identification: str,
    id_type: str = "Cedula Ciudadania",
    email: str = "a@b.com",
    phone: str = "300",
    created: datetime | None = None,
    updated: datetime | None = None,
) -> "etl.LegacyRow":
    return etl.LegacyRow(
        row_id=row_id,
        fullname=fullname,
        identification=identification,
        identification_type=id_type,
        email=email,
        phone=phone,
        created_at=created or _ts(2020),
        updated_at=updated or _ts(2020),
    )


class TestIsPlaceholder(unittest.TestCase):
    def test_all_zeros_single(self):
        self.assertTrue(etl.is_placeholder("0"))

    def test_all_zeros_multi(self):
        self.assertTrue(etl.is_placeholder("00000"))

    def test_sequential_junk_1234566(self):
        self.assertTrue(etl.is_placeholder("1234566"))

    def test_sequential_junk_1234567(self):
        self.assertTrue(etl.is_placeholder("1234567"))

    def test_real_cedula_not_placeholder(self):
        self.assertFalse(etl.is_placeholder("1032456789"))

    def test_trims_before_match(self):
        self.assertTrue(etl.is_placeholder("  00000  "))

    def test_empty_is_not_placeholder(self):
        # Empty is rejected downstream as invalid, not skipped as placeholder.
        self.assertFalse(etl.is_placeholder(""))

    # Corrected rule (2026-05-25 dry-run): keyboard ramps — prefixes of
    # "1234567890" (len>=6) — are junk.
    def test_ramp_prefix_6_digits_boundary(self):
        # 123456 (len==_RAMP_MIN_LEN) is the shortest ramp; in the real dump
        # it was a fake id shared by 2 different people -> unusable -> junk.
        self.assertTrue(etl.is_placeholder("123456"))

    def test_ramp_5_digits_too_short_kept(self):
        # len 5 < 6 -> not a ramp; kept (conservative: short ids may be real).
        self.assertFalse(etl.is_placeholder("12345"))

    def test_ramp_prefix_8_digits(self):
        self.assertTrue(etl.is_placeholder("12345678"))

    def test_ramp_prefix_9_digits(self):
        self.assertTrue(etl.is_placeholder("123456789"))

    def test_ramp_full_10_digits(self):
        self.assertTrue(etl.is_placeholder("1234567890"))

    def test_fat_finger_ramp_denylist(self):
        self.assertTrue(etl.is_placeholder("12345677"))

    def test_operator_test_ids_denylist(self):
        # dc005241@gmail.com / "prueba" reservations confirmed in the dry-run.
        self.assertTrue(etl.is_placeholder("1234454"))
        self.assertTrue(etl.is_placeholder("1234564"))

    # Regression guard: real 10-digit cedulas starting with 123 are REAL
    # customers (personal emails + birth-year match) — never discarded. The
    # provisional ^123\\d{4,}$ rule wrongly discarded ~66 of these.
    def test_real_123_cedula_not_placeholder(self):
        self.assertFalse(etl.is_placeholder("1233497720"))
        self.assertFalse(etl.is_placeholder("1235540187"))

    def test_real_123_zero_tail_not_placeholder(self):
        # 1230000000 is not all-zeros and not a ramp prefix -> a real cedula
        # shape, kept (the provisional regex would have discarded it).
        self.assertFalse(etl.is_placeholder("1230000000"))


class TestMapIdentificationType(unittest.TestCase):
    def test_cedula_ciudadania(self):
        self.assertEqual(etl.map_identification_type("Cedula Ciudadania"), "CC")

    def test_cedula_extranjeria(self):
        self.assertEqual(etl.map_identification_type("Cedula Extranjeria"), "CE")

    def test_pasaporte(self):
        self.assertEqual(etl.map_identification_type("Pasaporte"), "PP")

    def test_trims_before_map(self):
        self.assertEqual(etl.map_identification_type("  Pasaporte  "), "PP")

    def test_unknown_returns_none(self):
        # None is the reject signal; the caller never guesses.
        self.assertIsNone(etl.map_identification_type("Tarjeta Identidad"))

    def test_empty_returns_none(self):
        self.assertIsNone(etl.map_identification_type(""))


class TestSplitFullname(unittest.TestCase):
    def test_one_token_gets_period_and_needs_review(self):
        first, last, needs_review = etl.split_fullname("MARIA")
        self.assertEqual((first, last), ("MARIA", "."))
        self.assertTrue(needs_review)

    def test_two_tokens(self):
        self.assertEqual(etl.split_fullname("JUAN PEREZ"), ("JUAN", "PEREZ", False))

    def test_three_tokens(self):
        self.assertEqual(
            etl.split_fullname("JUAN PEREZ GOMEZ"), ("JUAN", "PEREZ GOMEZ", False)
        )

    def test_four_tokens(self):
        self.assertEqual(
            etl.split_fullname("JUAN CARLOS PEREZ GOMEZ"),
            ("JUAN CARLOS", "PEREZ GOMEZ", False),
        )

    def test_five_tokens(self):
        self.assertEqual(
            etl.split_fullname("ANA MARIA PEREZ GOMEZ DIAZ"),
            ("ANA MARIA", "PEREZ GOMEZ DIAZ", False),
        )

    def test_de_la_compound_surname(self):
        # "JUAN DE LA CRUZ": stopwords de+la glue to CRUZ -> 2 tokens
        # ["JUAN", "DE LA CRUZ"] -> (JUAN, DE LA CRUZ).
        first, last, needs_review = etl.split_fullname("JUAN DE LA CRUZ")
        self.assertEqual((first, last), ("JUAN", "DE LA CRUZ"))
        self.assertFalse(needs_review)

    def test_del_compound_surname(self):
        # "MARIA DEL CARMEN ROJAS": del glues to CARMEN -> 3 tokens
        # ["MARIA", "DEL CARMEN", "ROJAS"] -> (MARIA, "DEL CARMEN ROJAS").
        self.assertEqual(
            etl.split_fullname("MARIA DEL CARMEN ROJAS"),
            ("MARIA", "DEL CARMEN ROJAS", False),
        )

    def test_collapses_internal_whitespace(self):
        self.assertEqual(
            etl.split_fullname("  JUAN    PEREZ  "), ("JUAN", "PEREZ", False)
        )

    def test_empty_raises(self):
        with self.assertRaises(ValueError):
            etl.split_fullname("   ")


class TestTransformRow(unittest.TestCase):
    def test_invalid_type_rejected(self):
        out = etl.transform_row(_legacy(1, "JUAN PEREZ", "123", id_type="X"))
        self.assertIsInstance(out, etl.RejectedRow)
        self.assertEqual(out.reason, "invalid_identification_type")

    def test_empty_name_rejected(self):
        out = etl.transform_row(_legacy(1, "   ", "123"))
        self.assertIsInstance(out, etl.RejectedRow)
        self.assertEqual(out.reason, "invalid_first_name")

    def test_empty_email_rejected(self):
        out = etl.transform_row(_legacy(1, "JUAN PEREZ", "123", email="  "))
        self.assertIsInstance(out, etl.RejectedRow)
        self.assertEqual(out.reason, "invalid_email")

    def test_email_lowercased_and_trimmed(self):
        out = etl.transform_row(
            _legacy(1, "JUAN PEREZ", "123", email="  JUAN@MAIL.COM ")
        )
        self.assertIsInstance(out, etl.CustomerRecord)
        self.assertEqual(out.email, "juan@mail.com")


class TestDedupLatestWins(unittest.TestCase):
    def test_latest_wins_by_updated_at(self):
        # 3 records, same id, ascending updated_at: latest fields must win.
        rows = [
            _legacy(
                1, "OLD NAME", "555", email="old@x.com", phone="111",
                created=_ts(2019), updated=_ts(2019),
            ),
            _legacy(
                2, "MID NAME", "555", email="mid@x.com", phone="222",
                created=_ts(2020), updated=_ts(2020),
            ),
            _legacy(
                3, "NEW NAME", "555", email="new@x.com", phone="333",
                created=_ts(2021), updated=_ts(2021),
            ),
        ]
        result = etl.dedup_records(rows)
        self.assertEqual(len(result.records), 1)
        rec = result.records[0]
        self.assertEqual(rec.first_name, "NEW")
        self.assertEqual(rec.last_name, "NAME")
        self.assertEqual(rec.email, "new@x.com")
        self.assertEqual(rec.phone, "333")
        # created_at = MIN of group, updated_at = MAX of group.
        self.assertEqual(rec.created_at, _ts(2019))
        self.assertEqual(rec.updated_at, _ts(2021))
        # divergence in name/email/phone is counted, not blocked.
        self.assertGreaterEqual(result.conflicts_by_name, 1)
        self.assertGreaterEqual(result.conflicts_by_email, 1)
        self.assertGreaterEqual(result.conflicts_by_phone, 1)

    def test_single_record_no_conflicts(self):
        result = etl.dedup_records([_legacy(1, "JUAN PEREZ", "777")])
        self.assertEqual(len(result.records), 1)
        self.assertEqual(result.conflicts_by_name, 0)

    def test_trim_groups_same_id(self):
        rows = [
            _legacy(1, "JUAN PEREZ", " 888 ", updated=_ts(2020)),
            _legacy(2, "JUAN P", "888", updated=_ts(2021)),
        ]
        result = etl.dedup_records(rows)
        self.assertEqual(len(result.records), 1)
        self.assertEqual(result.records[0].identification_number, "888")


class TestDedupCrossType(unittest.TestCase):
    def test_cross_type_single_record_and_conflict_recorded(self):
        # Same number, CC + CE: one record (no UNIQUE violation), cross_type logged.
        rows = [
            _legacy(
                1, "JUAN PEREZ", "999", id_type="Cedula Ciudadania",
                updated=_ts(2020),
            ),
            _legacy(
                2, "JUAN PEREZ", "999", id_type="Cedula Extranjeria",
                updated=_ts(2021),
            ),
        ]
        result = etl.dedup_records(rows)
        self.assertEqual(len(result.records), 1)
        # winner is the latest (2021) -> CE.
        self.assertEqual(result.records[0].identification_type, "CE")
        self.assertEqual(result.conflicts_cross_type, 1)
        self.assertEqual(len(result.cross_type_detail), 1)
        detail = result.cross_type_detail[0]
        self.assertEqual(detail["identification_number"], "999")
        self.assertEqual(
            detail["legacy_types_seen"],
            ["Cedula Ciudadania", "Cedula Extranjeria"],
        )
        self.assertEqual(detail["winner_type"], "CE")


class TestPartitionPlaceholders(unittest.TestCase):
    def test_placeholders_split_out_before_dedup(self):
        rows = [
            _legacy(1, "JUAN PEREZ", "1032456789"),
            _legacy(2, "FAKE ONE", "0000"),
            _legacy(3, "FAKE TWO", "1234567"),
            _legacy(4, "REAL PERSON", "1233497720"),  # real 123 cedula -> KEPT
        ]
        kept, placeholders = etl.partition_placeholders(rows)
        self.assertEqual(
            sorted(r.identification for r in kept),
            ["1032456789", "1233497720"],
        )
        self.assertEqual(
            sorted(r.identification for r in placeholders), ["0000", "1234567"]
        )


class TestMaskDbUrl(unittest.TestCase):
    def test_password_never_leaks(self):
        masked = etl.mask_db_url(
            "postgresql://user:s3cr3t-p%40ss@db.example.com:5432/postgres"
        )
        self.assertNotIn("s3cr3t", masked)
        self.assertIn("***", masked)
        self.assertIn("db.example.com", masked)

    def test_malformed_fully_redacted(self):
        self.assertEqual(etl.mask_db_url("garbage"), "postgresql://***@***/***")


# --------------------------------------------------------------------------- #
# SCEN-009: identification normalization + dedup of formatting variants.
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


class TestDedupNormalizedKey(unittest.TestCase):
    def test_three_numeric_variants_collapse_to_one(self):
        # "12.345.678" / "12345678" / "12 345 678" -> one customer "12345678".
        rows = [
            _legacy(1, "JUAN PEREZ", "12.345.678", updated=_ts(2019)),
            _legacy(2, "JUAN PEREZ", "12345678", updated=_ts(2020)),
            _legacy(3, "JUAN PEREZ", "12 345 678", updated=_ts(2021)),
        ]
        result = etl.dedup_records(rows)
        self.assertEqual(len(result.records), 1)
        self.assertEqual(result.records[0].identification_number, "12345678")
        # group_size reflects all 3 collapsed reservations (reconciliation).
        self.assertEqual(result.records[0].group_size, 3)

    def test_passport_persists_normalized(self):
        result = etl.dedup_records([_legacy(1, "JOHN DOE", "AB-12345", id_type="Pasaporte")])
        self.assertEqual(len(result.records), 1)
        self.assertEqual(result.records[0].identification_number, "AB12345")

    def test_placeholder_detected_on_normalized_value(self):
        # "0.0.0.0" normalizes to "0000" -> placeholder.
        self.assertTrue(etl.is_placeholder("0.0.0.0"))


# --------------------------------------------------------------------------- #
# SCEN-010: placeholder count outside range blocks commit (gate predicate).
# --------------------------------------------------------------------------- #
class TestPlaceholderRangeGate(unittest.TestCase):
    def test_within_range_true(self):
        # Corrected range [1, 30] — the closed zeros+ramps+denylist rule
        # discards ~13 ids (2026-05-25 dry-run). Was [50, 200], calibrated to
        # the over-matching ^123\d{4,}$ premise that discarded real cedulas.
        self.assertTrue(etl.placeholder_within_range(1))
        self.assertTrue(etl.placeholder_within_range(13))
        self.assertTrue(etl.placeholder_within_range(30))

    def test_below_range_false(self):
        # 0 discarded -> below the floor (extraction returned no placeholders).
        self.assertFalse(etl.placeholder_within_range(0))

    def test_above_range_false_overmatch_signal(self):
        # A rule that over-matches (e.g. the old ^123\d{4,}$ → 600, or 31)
        # exceeds the cap -> blocked, a signal the rule is wrong for this data.
        self.assertFalse(etl.placeholder_within_range(31))
        self.assertFalse(etl.placeholder_within_range(600))

    def test_summary_within_expected_range_field(self):
        # An out-of-range placeholder set surfaces within_expected_range=false.
        extract = etl.ExtractResult(rows=[], legacy_rows_total=0)
        # 31 distinct all-zeros placeholders (lengths 1..31) -> 31 unique,
        # above the [1, 30] cap -> within_expected_range=false (over-match
        # signal). Real values, all genuine ^0+$ placeholders.
        placeholders = [
            _legacy(i, "X", "0" * (i + 1)) for i in range(31)
        ]
        dedup = etl.DedupResult()
        summary = etl.build_summary(
            dry_run=True,
            committed=False,
            extract=etl.ExtractResult(rows=[], legacy_rows_total=5),
            placeholders=placeholders,
            dedup=dedup,
            inserted_numbers=set(),
            skip_classification={},
            batch_errors={},
            computed_unique_non_placeholder=0,
            elapsed_seconds=0.0,
            timestamp="t",
            dest_masked="postgresql://***@h/db",
            report_path=None,
        )
        self.assertFalse(summary["placeholders_discarded"]["within_expected_range"])
        # PII guard: the full discarded-id list must NOT be in the stdout summary.
        self.assertNotIn(
            "discarded_identifications", summary["placeholders_discarded"]
        )


# --------------------------------------------------------------------------- #
# SCEN-011: control-char sanitization + row-by-row insert fallback.
# --------------------------------------------------------------------------- #
class _FakeCursor:
    """Minimal cursor: SAVEPOINT/RELEASE/ROLLBACK no-op; a poison id raises.

    execute_values is not used directly — the production code calls
    psycopg2.extras.execute_values(cur, sql, values, fetch=True). We monkeypatch
    that in the test to route through this cursor's `insert_one`.
    """

    def __init__(self, poison_numbers: set[str]):
        self.poison = poison_numbers
        self.inserted: list[str] = []
        self._returning: list[tuple] = []

    def execute(self, sql, params=None):
        # SAVEPOINT / RELEASE / ROLLBACK control statements: no-op.
        self._returning = []

    def insert_one(self, number: str):
        if number in self.poison:
            raise _FakePgError(f"poison {number}")
        self.inserted.append(number)
        self._returning = [("uuid-" + number, number)]

    def fetchall(self):
        return self._returning

    def close(self):
        pass


class _FakePgError(Exception):
    pgcode = "23514"  # arbitrary sqlstate, mimics a CHECK violation.


class TestControlCharSanitization(unittest.TestCase):
    def test_strips_nul_byte_from_fullname(self):
        self.assertEqual(etl._sanitize_text("JU\x00AN"), "JUAN")

    def test_strips_other_control_chars(self):
        self.assertEqual(etl._sanitize_text("A\x01B\x1fC\x7fD"), "ABCD")

    def test_none_becomes_empty(self):
        self.assertEqual(etl._sanitize_text(None), "")

    def test_extract_sanitizes_via_fake_cursor(self):
        cur = _FakeExtractCursor(
            [
                (1, "JU\x00AN PEREZ", "12345678", "Cedula Ciudadania",
                 "a\x00@b.com", "30\x010", _dt(2020), _dt(2020)),
            ]
        )
        result = etl.extract_legacy_rows(cur)
        self.assertEqual(len(result.rows), 1)
        self.assertEqual(result.rows[0].fullname, "JUAN PEREZ")
        self.assertEqual(result.rows[0].email, "a@b.com")
        self.assertEqual(result.rows[0].phone, "300")


class TestRowByRowFallback(unittest.TestCase):
    def test_one_bad_row_rejected_rest_inserted(self):
        # Patch psycopg2.extras.execute_values to drive the fake cursor.
        import types

        fake_extras = types.SimpleNamespace()

        def fake_execute_values(cur, sql, values, fetch=False):
            # values is a list of row tuples; identification_number is index 3.
            if len(values) > 1:
                # Batch path: simulate a batch failure if ANY row is poison.
                numbers = [v[3] for v in values]
                if any(n in cur.poison for n in numbers):
                    raise _FakePgError("batch poison")
                for n in numbers:
                    cur.insert_one(n)
                return [("uuid-" + n, n) for n in numbers]
            # Single-row path (row-by-row fallback).
            n = values[0][3]
            cur.insert_one(n)  # raises if poison
            return [("uuid-" + n, n)]

        fake_extras.execute_values = fake_execute_values

        fake_psycopg2 = types.ModuleType("psycopg2")
        fake_psycopg2.extras = fake_extras
        saved = sys.modules.get("psycopg2")
        sys.modules["psycopg2"] = fake_psycopg2
        try:
            records = [
                _record("111"),
                _record("222"),  # poison
                _record("333"),
            ]
            cur = _FakeCursor(poison_numbers={"222"})

            class _FakeConn:
                def cursor(self_inner):
                    return cur

            inserted, errors = etl.insert_records(
                _FakeConn(), records, _dt(2020)
            )
        finally:
            if saved is not None:
                sys.modules["psycopg2"] = saved
            else:
                del sys.modules["psycopg2"]

        self.assertEqual(inserted, {"111", "333"})
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0][0], "222")
        self.assertIn("23514", errors[0][1])  # sqlstate carried, no PII.


# --------------------------------------------------------------------------- #
# SCEN-012: reconciliation invariant + blank-id accounting.
# --------------------------------------------------------------------------- #
class TestReconciliation(unittest.TestCase):
    def test_blank_identification_counted_as_dropped(self):
        cur = _FakeExtractCursor(
            [
                (1, "JUAN PEREZ", "12345678", "Cedula Ciudadania", "a@b.com", "300",
                 _dt(2020), _dt(2020)),
                (2, "NO ID", None, "Cedula Ciudadania", "b@b.com", "301",
                 _dt(2020), _dt(2020)),
                (3, "BLANK ID", "   ", "Cedula Ciudadania", "c@b.com", "302",
                 _dt(2020), _dt(2020)),
            ]
        )
        result = etl.extract_legacy_rows(cur)
        self.assertEqual(result.legacy_rows_total, 3)
        self.assertEqual(len(result.rows), 1)
        self.assertEqual(result.dropped_no_identification, 2)

    def test_summary_buckets_sum_to_total(self):
        # 5 legacy rows: 1 inserted (collapsing 2 reservations), 1 placeholder,
        # 1 dropped blank id, 1 transform-rejected. Build the pieces by hand and
        # assert the row-level reconciliation invariant holds.
        extract = etl.ExtractResult(
            rows=[], legacy_rows_total=5, dropped_no_identification=1
        )
        inserted_rec = _record("100")
        inserted_rec.group_size = 2  # collapses 2 reservations.
        rejected_rec = etl.RejectedRow(9, "200", "invalid_email", group_size=1)
        dedup = etl.DedupResult(records=[inserted_rec], rejected=[rejected_rec])
        placeholders = [_legacy(7, "PH", "0000")]  # 1 reservation.
        summary = etl.build_summary(
            dry_run=True,
            committed=False,
            extract=extract,
            placeholders=placeholders,
            dedup=dedup,
            inserted_numbers={"100"},
            skip_classification={},
            batch_errors={},
            computed_unique_non_placeholder=1,
            elapsed_seconds=0.0,
            timestamp="t",
            dest_masked="postgresql://***@h/db",
            report_path=None,
        )
        recon = summary["reconciliation"]
        self.assertTrue(recon["reconciles"], recon)
        rl = recon["row_level"]
        # 2 inserted rows + 0 skipped + 1 rejected + 1 placeholder + 1 dropped = 5.
        self.assertEqual(rl["inserted"], 2)
        self.assertEqual(rl["rejected"], 1)
        self.assertEqual(rl["placeholder_reservations"], 1)
        self.assertEqual(rl["dropped_no_identification"], 1)
        self.assertEqual(rl["sum"], 5)
        self.assertEqual(summary["legacy_rows_total"], 5)


# --------------------------------------------------------------------------- #
# SCEN-013: timestamp parse / fallback accounting.
# --------------------------------------------------------------------------- #
class TestTimestampFallback(unittest.TestCase):
    def test_datetime_passthrough(self):
        dt, fb = etl._as_aware(_dt(2021, 6, 15), _EPOCH)
        self.assertEqual(dt, _dt(2021, 6, 15))
        self.assertFalse(fb)

    def test_string_iso_parsed(self):
        dt, fb = etl._as_aware("2021-06-15 08:30:00", _EPOCH)
        self.assertFalse(fb)
        self.assertEqual(dt.year, 2021)
        self.assertEqual(dt.month, 6)
        self.assertEqual(dt.hour, 8)

    def test_zero_date_falls_back(self):
        dt, fb = etl._as_aware("0000-00-00 00:00:00", _EPOCH)
        self.assertTrue(fb)
        self.assertEqual(dt, _EPOCH)

    def test_garbage_string_falls_back(self):
        dt, fb = etl._as_aware("not-a-date", _EPOCH)
        self.assertTrue(fb)

    def test_null_falls_back(self):
        dt, fb = etl._as_aware(None, _EPOCH)
        self.assertTrue(fb)

    def test_extract_counts_fallback(self):
        cur = _FakeExtractCursor(
            [
                (1, "JUAN PEREZ", "12345678", "Cedula Ciudadania", "a@b.com", "300",
                 "0000-00-00 00:00:00", _dt(2020)),  # created zero-date -> fallback.
            ]
        )
        result = etl.extract_legacy_rows(cur)
        self.assertEqual(result.timestamp_fallback, 1)
        self.assertEqual(len(result.rows), 1)


# --------------------------------------------------------------------------- #
# Test helpers used by the SCEN-011/012/013 tests.
# --------------------------------------------------------------------------- #
_EPOCH = datetime.min.replace(tzinfo=timezone.utc)


def _dt(year, month=1, day=1):
    return datetime(year, month, day, tzinfo=timezone.utc)


def _record(number: str) -> "etl.CustomerRecord":
    return etl.CustomerRecord(
        first_name="JUAN",
        last_name="PEREZ",
        identification_type="CC",
        identification_number=number,
        phone="300",
        email="a@b.com",
        created_at=_dt(2020),
        updated_at=_dt(2020),
    )


class _FakeExtractCursor:
    """A cursor whose execute() is a no-op and fetchall() yields canned rows."""

    def __init__(self, rows):
        self._rows = rows

    def execute(self, sql, params=None):
        pass

    def fetchall(self):
        return self._rows

    def close(self):
        pass


if __name__ == "__main__":
    unittest.main(verbosity=2)
