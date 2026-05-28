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
import math
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

# CLOSED status map (Gap 4): the 13 canonical legacy statuses -> snake_case
# destination CHECK domain. ANY value outside this dict (incl. the historical
# 'Terminado', 0 rows in the dump) is REJECTED with `status_unmapped` — never a
# blind lower(replace()) guess, never a row that lets the destination CHECK
# explode as a raw SQL error. Authoritative table: design §"Reglas de
# transformación" / scenarios SCEN-004 preamble.
STATUS_MAP: dict[str, str] = {
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

# Legacy monthly_mileage enum -> destination integer (kms). NULL -> NULL; any
# other non-null value is a defensive `monthly_mileage_unmapped` reject.
MONTHLY_MILEAGE_MAP: dict[str, int] = {
    "1k_kms": 1000,
    "2k_kms": 2000,
    "3k_kms": 3000,
}

# Destination franchise enum (P-franchise). A legacy franchise whose mapped name
# is outside this set is rejected `franchise_unmapped`. The franchise map passed
# to resolve_franchise is built destination-side already collapsed to these enum
# values; the set is the defensive guard against a map that drifts out of domain.
FRANCHISE_ENUM: frozenset[str] = frozenset(
    {"alquilatucarro", "alquilame", "alquicarros"}
)

# numeric(12,2) ceiling: 10 integer digits + 2 fractional. A coerced money value
# strictly above this overflows the destination column and is rejected
# `numeric_overflow` (never truncated). The known outlier (legacy ID 7721 ~=
# 816,999,989) is well below this and migrates as-is.
NUMERIC_12_2_MAX = 9_999_999_999.99

# Postgres smallint upper bound. selected_days / coverage_days / extra_hours are
# range-guarded against it; a value above it rejects `numeric_overflow`.
SMALLINT_MAX = 32767

INSERT_BATCH_SIZE = 500


# --------------------------------------------------------------------------- #
# Reject signal.
#
# DESIGN CHOICE (reject mechanism): ONE exception, `RejectRow`, raised by every
# pure transform / FK-resolution function when a row cannot be migrated. It
# carries a single no-PII `.reason` string drawn from the closed taxonomy below.
# A reason NEVER embeds an identification / name / email / branch id. The
# row-processing pipeline (step 7) wraps each row's transform in one try/except
# RejectRow and turns a caught reason into a RejectedRow(legacy_id, reason) for
# the reconciliation invariant — exactly one disposition per legacy row. An
# exception (not a (value, reason) tuple) is chosen because resolution is a deep
# call chain (customer -> pickup -> return -> category -> franchise -> status ->
# numerics); the first failure must short-circuit the whole row, which an
# exception does for free without threading an error result through every step.
# --------------------------------------------------------------------------- #
class RejectRow(Exception):
    """Signal that a legacy row cannot be migrated. Carries a no-PII reason.

    `reason` is one of the closed reject-taxonomy strings (customer_not_migrated,
    pickup_location_null, return_location_null, pickup_location_unmapped,
    return_location_unmapped, category_unmapped, franchise_unmapped,
    status_unmapped, numeric_overflow, monthly_mileage_unmapped). It is a
    code-controlled literal — never interpolated with row data — so logging the
    reason can never leak PII.
    """

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


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
    """One legacy reservations row (free text already control-char sanitized).

    Full legacy column set used by transform_row (03-mapping.md §D2 / legacy
    schema 01). FK columns (`category`/`pickup_location`/`return_location`/
    `franchise`) carry the raw legacy BIGINT id (or None); transform_row resolves
    each through the destination lookup maps. `user` is the referral column
    (P12). Dates/hours are kept as the driver's native value (date/time/str) and
    passed through unchanged — the destination columns are date/time and the
    driver round-trips them; only created_at/updated_at parse via _as_aware.
    """

    row_id: int
    fullname: str
    identification: str
    identification_type: str
    status: str
    category: int | None
    pickup_location: int | None
    return_location: int | None
    franchise: int | None
    user: str
    reserve_code: str | None
    note: str | None
    pickup_date: object
    pickup_hour: object
    return_date: object
    return_hour: object
    selected_days: object
    total_price: object
    total_price_to_pay: object
    total_price_localiza: object
    tax_fee: object
    iva_fee: object
    coverage_days: object
    coverage_price: object
    return_fee: object
    extra_hours: object
    extra_hours_price: object
    total_insurance: object
    extra_driver: object
    baby_seat: object
    wash: object
    aeroline: str | None
    flight_number: str | None
    monthly_mileage: str | None
    ghl_contact_id: str | None
    ghl_opportunity_id: str | None
    ghl_last_sync: object
    created_at: datetime
    updated_at: datetime


@dataclass
class ReservationRecord:
    """A transformed reservation ready for insert (1:1 — no group collapse).

    `legacy_id` becomes `_legacy_id` on insert (the idempotency key). Every other
    field is a destination column per 03-mapping.md §D2: resolved FKs
    (customer_id/pickup_location_id/return_location_id/rental_company_id),
    resolved enums/codes (franchise/category_code/status/booking_type), the
    Phase-2 numeric/mileage transforms, and the direct passthroughs. Fields
    without a legacy source carry their default here (reference_token /
    rate_qualifier / created_by / notification_sent_at / notification_sent_by =
    None; notification_required / notification_sent = False).
    """

    legacy_id: int
    customer_id: str
    rental_company_id: str
    referral_id: str | None
    referral_raw: str | None
    pickup_location_id: str
    return_location_id: str
    franchise: str
    booking_type: str
    reservation_code: str | None
    category_code: str
    pickup_date: object
    pickup_hour: object
    return_date: object
    return_hour: object
    selected_days: object
    total_price: object
    total_price_to_pay: object
    total_price_localiza: object
    tax_fee: object
    iva_fee: object
    coverage_days: object
    coverage_price: object
    return_fee: object
    extra_hours: object
    extra_hours_price: object
    total_insurance: object
    extra_driver: object
    baby_seat: object
    wash: object
    aeroline: str | None
    flight_number: str | None
    monthly_mileage: int | None
    ghl_contact_id: str | None
    ghl_opportunity_id: str | None
    ghl_last_sync: object
    status: str
    nota: str | None
    created_at: datetime
    updated_at: datetime
    reference_token: str | None = None
    rate_qualifier: str | None = None
    created_by: str | None = None
    notification_required: bool = False
    notification_sent: bool = False
    notification_sent_at: object = None
    notification_sent_by: str | None = None


@dataclass
class LookupMaps:
    """The 6 destination lookup structures transform_row resolves FKs against.

    Built once by build_lookup_maps (step 7) from the DESTINATION (+ legacy
    branches/categories/franchises for the id->code/name composition), then
    passed read-only into every transform_row call.
    """

    customer_map: dict  # normalize_identification(legacy.identification) -> customer uuid
    location_map: dict  # legacy branch id -> location uuid (pre-joined via code)
    category_map: dict  # legacy category id -> code (legacy.categories.identification)
    dest_category_codes: frozenset  # destination vehicle_categories.code set
    franchise_map: dict  # legacy franchise id -> destination enum value
    referral_map: dict  # lower(referrals.code) -> referral uuid
    rental_company_id: str  # the single localiza rental_companies uuid
    # Count of distinct stored identification_numbers that RE-NORMALIZE onto an
    # already-seen key (a #19 dedup escape) — observability, never silent (FIX 4).
    customer_key_collisions: int = 0


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
# Step 3 — status (SCEN-004).
# --------------------------------------------------------------------------- #
def map_status(legacy_status) -> str:
    """Map a legacy status to its destination value via the CLOSED STATUS_MAP.

    Returns the snake_case destination value for one of the 13 canonical legacy
    statuses. ANYTHING outside the map — including the historical 'Terminado'
    (0 rows in the dump), an unknown string, None, or an already-snake variant —
    raises RejectRow('status_unmapped'). Never a blind lower(replace()), never
    lets the destination CHECK constraint explode (SCEN-004). Non-str input
    (incl. an unhashable list/dict) rejects rather than raising — only a string
    can ever map, matching the closed-enum intent.
    """
    dest = STATUS_MAP.get(legacy_status) if isinstance(legacy_status, str) else None
    if dest is None:
        raise RejectRow("status_unmapped")
    return dest


# --------------------------------------------------------------------------- #
# Step 4 — booking_type (SCEN-005). Total function — NEVER rejects.
# --------------------------------------------------------------------------- #
def derive_booking_type(monthly_mileage, total_insurance) -> str:
    """Derive booking_type. Total function: every input yields a valid value.

    Rule (SCEN-005):
      monthly_mileage is not None      -> 'monthly'  (wins regardless of insurance)
      elif total_insurance is True     -> 'standard_with_insurance'
      else                             -> 'standard'

    `monthly_mileage` here is the ALREADY-MAPPED integer (or None); a present
    value of 0 is still "not None" and yields 'monthly'. Never raises.
    """
    if monthly_mileage is not None:
        return "monthly"
    if total_insurance is True:
        return "standard_with_insurance"
    return "standard"


# --------------------------------------------------------------------------- #
# Step 5 — numeric / mileage (SCEN-011 overflow + mileage map).
# --------------------------------------------------------------------------- #
def map_monthly_mileage(value):
    """Map the legacy monthly_mileage enum to an integer (kms), or None.

    '1k_kms'/'2k_kms'/'3k_kms' -> 1000/2000/3000; None -> None. ANY other
    non-null value raises RejectRow('monthly_mileage_unmapped') — a defensive
    guard (no other value exists in the real dump), never a silent coercion.
    """
    if value is None:
        return None
    mapped = MONTHLY_MILEAGE_MAP.get(value)
    if mapped is None:
        raise RejectRow("monthly_mileage_unmapped")
    return mapped


def coerce_numeric(value):
    """Coerce a money field to numeric(12,2): round to 2 decimals, range-guard.

    None -> None. Otherwise rounds to 2 decimals; if the rounded magnitude
    exceeds the numeric(12,2) ceiling (> 9,999,999,999.99) raises
    RejectRow('numeric_overflow') — never truncated, never let to explode the DB
    numeric-range constraint (SCEN-011). Applies to all 7 money fields including
    total_price_to_pay (the known outlier ID 7721 is below the ceiling).

    Rounding is Python round() (half-to-even). Acceptable because legacy money is
    `float`/`unsigned int` and exact half-cents (.xx5) don't occur in binary
    float — do NOT "fix" to Decimal ROUND_HALF_UP without a reconciliation reason.
    A non-coercible value (impossible under the NOT-NULL numeric legacy schema)
    rejects `numeric_overflow` rather than raising, so a malformed input becomes a
    logged disposition and the per-row reconciliation invariant holds.
    """
    if value is None:
        return None
    try:
        rounded = round(float(value), 2)
    except (TypeError, ValueError):
        raise RejectRow("numeric_overflow")
    # NaN/inf cannot be stored in numeric(12,2). inf already exceeds the ceiling,
    # but NaN comparisons are ALWAYS False, so `abs(nan) > MAX` is False and NaN
    # would slip through silently — guard it explicitly (FIX 5).
    if not math.isfinite(rounded) or abs(rounded) > NUMERIC_12_2_MAX:
        raise RejectRow("numeric_overflow")
    return rounded


def coerce_smallint(value):
    """Range-guard a smallint field (selected_days / coverage_days / extra_hours).

    None -> None. A magnitude above the Postgres smallint bound (32767) raises
    RejectRow('numeric_overflow') rather than overflowing the column (SCEN-011).
    A non-coercible value rejects rather than raising (same reconciliation-invariant
    reasoning as coerce_numeric).
    """
    if value is None:
        return None
    try:
        ivalue = int(value)
    except (TypeError, ValueError, OverflowError):
        # OverflowError: int(float('inf')) — not a ValueError/TypeError, so it
        # would otherwise escape the per-row RejectRow handler and abort the run.
        raise RejectRow("numeric_overflow")
    if abs(ivalue) > SMALLINT_MAX:
        raise RejectRow("numeric_overflow")
    return ivalue


def coerce_return_fee(value):
    """Coerce return_fee: NULL -> 0, otherwise the same numeric(12,2) guard.

    Distinct from coerce_numeric only in the NULL default (0.0 instead of None);
    overflow still rejects `numeric_overflow`. Returns a float for type-uniformity
    with coerce_numeric.
    """
    if value is None:
        return 0.0
    return coerce_numeric(value)


# --------------------------------------------------------------------------- #
# Step 6 — FK resolution (SCEN-002 / 003 / 006 / 010 / 011). Pure: each takes
# the legacy value + an in-memory destination lookup map, returns the resolved
# id/code/enum, or raises RejectRow with a taxonomy reason. No DB access.
# --------------------------------------------------------------------------- #
def resolve_customer_id(legacy_identification, customer_map: dict[str, str]) -> str:
    """Resolve a legacy identification to a destination customer UUID.

    Keys `customer_map` (normalized-id -> uuid) by the SAME
    normalize_identification used by #19 as its dedup key / persisted
    identification_number — so the join lands exactly. A normalized id ABSENT
    from the map (e.g. a placeholder #19 discarded) raises
    RejectRow('customer_not_migrated') (SCEN-002) — never an exception leak,
    never a NULL/guessed FK. The reason carries NO identification (no PII).
    """
    key = normalize_identification(legacy_identification)
    uuid = customer_map.get(key)
    if uuid is None:
        raise RejectRow("customer_not_migrated")
    return uuid


def resolve_location(
    legacy_branch_id, location_map: dict, side: str
) -> str:
    """Resolve a legacy BRANCH id to a destination location UUID for one side.

    `side` is 'pickup' or 'return' — it only shapes the reject reason. The legacy
    reservation's pickup_location / return_location is a legacy BRANCH id.
    `location_map` is a PRE-JOINED dict `branch_id -> location_id` (built
    destination-side by joining legacy.branches.code == locations.code once), so
    the two-hop branch_id -> branch.code -> location.id is one O(1) lookup.

    Rejects (SCEN-003 / SCEN-010), distinct so a broken branches.code<->
    locations.code mapping is observable rather than lost in the NULL bucket:
      * legacy branch id is NULL                       -> '{side}_location_null'
      * branch id present but absent from the map       -> '{side}_location_unmapped'
    Never imputes / defaults a location.
    """
    if legacy_branch_id is None:
        raise RejectRow(f"{side}_location_null")
    location_id = location_map.get(legacy_branch_id)
    if location_id is None:
        raise RejectRow(f"{side}_location_unmapped")
    return location_id


def resolve_category_code(
    legacy_category_id, category_map: dict, dest_codes
) -> str:
    """Resolve a legacy category id to a validated destination category code.

    `category_map` maps legacy.categories.id -> its code (identification). The
    resolved code is then validated against `dest_codes` (the destination
    vehicle_categories.code set). A missing legacy id, OR a code absent from the
    destination set, raises RejectRow('category_unmapped') (SCEN-011) — the
    reject-never-guess contract; expected 0 in real data (all 17 codes resolve).
    """
    code = category_map.get(legacy_category_id)
    if code is None or code not in dest_codes:
        raise RejectRow("category_unmapped")
    return code


def resolve_franchise(legacy_franchise_id, franchise_map: dict) -> str:
    """Resolve a legacy franchise id to a destination enum value.

    `franchise_map` maps legacy franchise id -> the destination enum value
    (legacy id -> name -> enum, collapsed destination-side). A missing id, or a
    mapped value outside FRANCHISE_ENUM {alquilatucarro, alquilame, alquicarros},
    raises RejectRow('franchise_unmapped') (SCEN-011). Expected 0 (3 franchises
    map 1:1).
    """
    enum_value = franchise_map.get(legacy_franchise_id)
    if enum_value is None or enum_value not in FRANCHISE_ENUM:
        raise RejectRow("franchise_unmapped")
    return enum_value


def resolve_referral(legacy_user, referral_map: dict) -> tuple[str | None, str | None]:
    """Resolve the legacy `user` (referral) column to (referral_id, referral_raw).

    NEVER rejects — referral is OPTIONAL (P12: legacy.reservations.user is the
    referral column, not an operator).
      * referral_raw = TRIM(legacy_user), or None if null/empty.
      * referral_id  = referral_map.get(lower(trim(user))), or None if no match.
    CRITICAL (SCEN-006): referral_raw is PRESERVED even when referral_id is None
    (free-text user that matches no referral code), so the original attribution
    string is never lost. Non-str input is coerced via str() (mirrors #19
    _sanitize_text) so this never-rejects function also never crashes — an
    uncaught AttributeError here would escape the per-row RejectRow handler.
    """
    raw = ("" if legacy_user is None else str(legacy_user)).strip()
    if not raw:
        return None, None
    referral_id = referral_map.get(raw.lower())
    return referral_id, raw


# --------------------------------------------------------------------------- #
# Step 7 — build_lookup_maps + transform_row.
#
# The single legacy SELECT (the full reservations column set; FKs as raw BIGINTs
# resolved later via the maps — no JOINs needed in extract because the maps
# pre-join). ORDER BY id makes the read deterministic so a re-run processes rows
# in the same order (idempotency is enforced by ON CONFLICT, but a stable order
# keeps the report diffable).
# --------------------------------------------------------------------------- #
LEGACY_SELECT = (
    "SELECT id, fullname, identification, identification_type, status, "
    "category, pickup_location, return_location, franchise, user, reserve_code, "
    "note, pickup_date, pickup_hour, return_date, return_hour, selected_days, "
    "total_price, total_price_to_pay, total_price_localiza, tax_fee, iva_fee, "
    "coverage_days, coverage_price, return_fee, extra_hours, extra_hours_price, "
    "total_insurance, extra_driver, baby_seat, wash, aeroline, flight_number, "
    "monthly_mileage, ghl_contact_id, ghl_opportunity_id, ghl_last_sync, "
    "created_at, updated_at "
    "FROM reservations ORDER BY id"
)

# Lookup queries. Each map is built with ONE query against the side named.
# location/category/franchise COMPOSE a legacy id->code/name query with a
# destination code->id / code-set / name->enum rule.
LEGACY_BRANCHES_SELECT = "SELECT id, code FROM branches"
LEGACY_CATEGORIES_SELECT = "SELECT id, identification FROM categories"
LEGACY_FRANCHISES_SELECT = "SELECT id, name FROM franchises"
DEST_CUSTOMERS_SELECT = "SELECT identification_number, id FROM public.customers"
# Location + category code uniqueness is (rental_company_id, code), not code
# alone (migrations 003/004), and design S3 scopes resolution to localiza. JOIN
# rental_companies + filter localiza so a future 2nd company with an overlapping
# code can never make the lookup non-deterministic (FIX 2).
DEST_LOCATIONS_SELECT = (
    "SELECT l.code, l.id FROM public.locations l "
    "JOIN public.rental_companies rc ON rc.id = l.rental_company_id "
    "WHERE rc.code = 'localiza'"
)
DEST_CATEGORY_CODES_SELECT = (
    "SELECT vc.code FROM public.vehicle_categories vc "
    "JOIN public.rental_companies rc ON rc.id = vc.rental_company_id "
    "WHERE rc.code = 'localiza'"
)
DEST_REFERRALS_SELECT = "SELECT code, id FROM public.referrals"
DEST_RENTAL_COMPANY_SELECT = (
    "SELECT id FROM public.rental_companies WHERE code = 'localiza'"
)


def build_lookup_maps(legacy_cur, dest_cur) -> LookupMaps:
    """Build the 6 destination lookup structures FK resolution needs.

    Source of each map (1 query each unless noted):
      * customer_map      — dest `SELECT identification_number, id FROM customers`
        keyed {identification_number -> id}. identification_number is already the
        #19-normalized value; resolve_customer_id re-normalizes the legacy value
        with the SAME normalize_identification so the join lands exactly.
      * location_map      — COMPOSE legacy `branches` (id -> code) with dest
        `locations` (code -> id) into {legacy_branch_id -> location_id}. A legacy
        branch whose code has no destination location is simply absent from the
        map -> resolve_location rejects `*_location_unmapped`.
      * category_map      — legacy `categories` (id -> identification) keyed
        {legacy_category_id -> code}. resolve_category_code validates the code
        against dest_category_codes.
      * dest_category_codes — dest `SELECT code FROM vehicle_categories` as a set.
      * franchise_map     — COMPOSE legacy `franchises` (id -> name) with the
        name->enum rule (the 3 names map 1:1 to the enum, lowercase exact, per
        audit Q7) into {legacy_franchise_id -> enum}. A name outside the enum is
        absent -> resolve_franchise rejects `franchise_unmapped`.
      * referral_map      — dest `SELECT code, id FROM referrals` keyed
        {lower(code) -> id} (resolve_referral keys by lower(trim(user))).
      * rental_company_id — dest single uuid WHERE code='localiza' (P6: all
        reservations -> localiza, 1:1).
    """
    # --- customer_map (dest). Re-normalize each stored identification_number to
    # the lookup key. If two distinct stored numbers normalize to the SAME key (a
    # #19 dedup escape — e.g. '12.345.678' and '12345678' both stored), the map
    # would silently keep the last writer. Count those collisions (FIX 4) so the
    # operator sees them; the count carries NO PII (just an integer).
    dest_cur.execute(DEST_CUSTOMERS_SELECT)
    customer_map: dict = {}
    customer_key_collisions = 0
    for number, uuid in dest_cur.fetchall():
        key = normalize_identification(number)
        if key in customer_map:
            customer_key_collisions += 1
        customer_map[key] = uuid

    # --- location_map (compose legacy branch_id -> code with dest code -> id).
    legacy_cur.execute(LEGACY_BRANCHES_SELECT)
    branch_code_by_id = {bid: code for bid, code in legacy_cur.fetchall()}
    dest_cur.execute(DEST_LOCATIONS_SELECT)
    location_id_by_code = {code: uuid for code, uuid in dest_cur.fetchall()}
    location_map = {
        bid: location_id_by_code[code]
        for bid, code in branch_code_by_id.items()
        if code in location_id_by_code
    }

    # --- category_map (legacy id -> code) + dest code set.
    legacy_cur.execute(LEGACY_CATEGORIES_SELECT)
    category_map = {cid: code for cid, code in legacy_cur.fetchall()}
    dest_cur.execute(DEST_CATEGORY_CODES_SELECT)
    dest_category_codes = frozenset(row[0] for row in dest_cur.fetchall())

    # --- franchise_map (compose legacy id -> name with name -> enum rule).
    legacy_cur.execute(LEGACY_FRANCHISES_SELECT)
    franchise_map = {
        fid: enum
        for fid, name in legacy_cur.fetchall()
        for enum in (_franchise_name_to_enum(name),)
        if enum is not None
    }

    # --- referral_map (dest, keyed lowercase).
    dest_cur.execute(DEST_REFERRALS_SELECT)
    referral_map = {
        (code or "").strip().lower(): uuid for code, uuid in dest_cur.fetchall()
    }

    # --- rental_company_id (dest, single uuid).
    dest_cur.execute(DEST_RENTAL_COMPANY_SELECT)
    row = dest_cur.fetchone()
    rental_company_id = row[0] if row else None

    if customer_key_collisions:
        # NO PII: only the count. The colliding numbers live nowhere in output.
        print(
            f"WARNING: {customer_key_collisions} customer identification_number(s) "
            "collapsed to an existing normalized key (a #19 dedup escape) — "
            "last-writer-wins on the lookup; verify in the dry-run.",
            file=sys.stderr,
        )

    return LookupMaps(
        customer_map=customer_map,
        location_map=location_map,
        category_map=category_map,
        dest_category_codes=dest_category_codes,
        franchise_map=franchise_map,
        referral_map=referral_map,
        rental_company_id=rental_company_id,
        customer_key_collisions=customer_key_collisions,
    )


def _franchise_name_to_enum(name) -> str | None:
    """Map a legacy franchise name to the destination enum, or None.

    The 3 franchise names map 1:1 to the enum {alquilatucarro, alquilame,
    alquicarros} (lowercase exact, audit Q7). Normalize the legacy name to
    lower+trim and accept only an exact enum member; anything else returns None
    so the franchise is absent from the map and the row rejects
    `franchise_unmapped` (never guessed).
    """
    normalized = (name or "").strip().lower()
    return normalized if normalized in FRANCHISE_ENUM else None


def transform_row(
    legacy_row: LegacyRow, maps: LookupMaps, run_started: datetime
) -> ReservationRecord:
    """Resolve + transform one legacy row into a ReservationRecord, or RejectRow.

    Maps EVERY destination column per 03-mapping.md §D2. Any FK that cannot
    resolve raises RejectRow (the first failure short-circuits the whole row via
    the exception); the caller's per-row try/except turns it into one logged
    disposition. Pure: no DB, no I/O — driven entirely by `maps` + `run_started`.

    `run_started` is the migration run-start stamp (== _legacy_migrated_at). It
    is the COALESCE target for a created_at/updated_at that fell back to
    FALLBACK_SENTINEL during extract (a zero-date / NULL / unparseable legacy
    timestamp): the sentinel is datetime.min (year 1), which IS in Postgres range
    and would otherwise commit silently as year 1. Coalescing here keeps the
    promise in the module docstring — a fallback timestamp persists as the run
    stamp, never year 1 (FIX 1).

    Resolution order (customer first so a cascade-rejected placeholder is the
    cheapest reject): customer -> pickup -> return -> category -> franchise ->
    status. booking_type / mileage / numerics / referral never reject the FK
    path (booking_type + referral are total; numerics reject only on overflow).
    """
    customer_id = resolve_customer_id(legacy_row.identification, maps.customer_map)
    pickup_location_id = resolve_location(
        legacy_row.pickup_location, maps.location_map, "pickup"
    )
    return_location_id = resolve_location(
        legacy_row.return_location, maps.location_map, "return"
    )
    category_code = resolve_category_code(
        legacy_row.category, maps.category_map, maps.dest_category_codes
    )
    franchise = resolve_franchise(legacy_row.franchise, maps.franchise_map)
    status = map_status(legacy_row.status)

    monthly_mileage = map_monthly_mileage(legacy_row.monthly_mileage)
    total_insurance = bool(legacy_row.total_insurance)
    booking_type = derive_booking_type(monthly_mileage, total_insurance)
    referral_id, referral_raw = resolve_referral(legacy_row.user, maps.referral_map)

    # FIX 1: coalesce a fallback-sentinel timestamp to the run-start stamp so a
    # zero-date / NULL / unparseable legacy created_at/updated_at never persists
    # as datetime.min (year 1). A real timestamp passes through untouched.
    created_at = (
        run_started if legacy_row.created_at == FALLBACK_SENTINEL else legacy_row.created_at
    )
    updated_at = (
        run_started if legacy_row.updated_at == FALLBACK_SENTINEL else legacy_row.updated_at
    )

    return ReservationRecord(
        legacy_id=legacy_row.row_id,
        customer_id=customer_id,
        rental_company_id=maps.rental_company_id,
        referral_id=referral_id,
        referral_raw=referral_raw,
        pickup_location_id=pickup_location_id,
        return_location_id=return_location_id,
        franchise=franchise,
        booking_type=booking_type,
        reservation_code=legacy_row.reserve_code,  # preserve NULL.
        category_code=category_code,
        pickup_date=legacy_row.pickup_date,
        pickup_hour=legacy_row.pickup_hour,
        return_date=legacy_row.return_date,
        return_hour=legacy_row.return_hour,
        selected_days=coerce_smallint(legacy_row.selected_days),
        total_price=coerce_numeric(legacy_row.total_price),
        total_price_to_pay=coerce_numeric(legacy_row.total_price_to_pay),
        total_price_localiza=coerce_numeric(legacy_row.total_price_localiza),
        tax_fee=coerce_numeric(legacy_row.tax_fee),
        iva_fee=coerce_numeric(legacy_row.iva_fee),
        coverage_days=coerce_smallint(legacy_row.coverage_days),
        coverage_price=coerce_numeric(legacy_row.coverage_price),
        return_fee=coerce_return_fee(legacy_row.return_fee),
        extra_hours=coerce_smallint(legacy_row.extra_hours),
        extra_hours_price=coerce_numeric(legacy_row.extra_hours_price),
        total_insurance=total_insurance,
        extra_driver=bool(legacy_row.extra_driver),
        baby_seat=bool(legacy_row.baby_seat),
        wash=bool(legacy_row.wash),
        aeroline=legacy_row.aeroline,
        flight_number=legacy_row.flight_number,
        monthly_mileage=monthly_mileage,
        ghl_contact_id=legacy_row.ghl_contact_id,
        ghl_opportunity_id=legacy_row.ghl_opportunity_id,
        ghl_last_sync=legacy_row.ghl_last_sync,
        status=status,
        nota=legacy_row.note,  # rename note -> nota.
        created_at=created_at,
        updated_at=updated_at,
        # Defaults with no legacy source (D5):
        reference_token=None,
        rate_qualifier=None,
        created_by=None,
        notification_required=False,
        notification_sent=False,
        notification_sent_at=None,
        notification_sent_by=None,
    )


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

# Destination INSERT column list (008_reservations.sql + ALTERs 019/027/032 +
# marker migration 050). EVERY column is either populated by transform_row or is
# a destination DEFAULT we deliberately re-specify (NULL / false). `id` is OMITTED
# so the destination `default gen_random_uuid()` fires; created_at/updated_at are
# supplied (we preserve the legacy timestamps, overriding the now() default). The
# two marker columns are LAST: `_legacy_id` then `_legacy_migrated_at`. The order
# here is the SINGLE SOURCE OF TRUTH for _record_to_tuple's element order.
INSERT_COLUMNS: tuple[str, ...] = (
    # Relations
    "customer_id",
    "rental_company_id",
    "referral_id",
    "referral_raw",
    "pickup_location_id",
    "return_location_id",
    # Identity
    "franchise",
    "booking_type",
    "reservation_code",
    "reference_token",
    "rate_qualifier",
    # Booking
    "category_code",
    "pickup_date",
    "pickup_hour",
    "return_date",
    "return_hour",
    "selected_days",
    # Pricing
    "total_price",
    "total_price_to_pay",
    "total_price_localiza",
    "tax_fee",
    "iva_fee",
    # Coverage
    "coverage_days",
    "coverage_price",
    # Extras
    "return_fee",
    "extra_hours",
    "extra_hours_price",
    "total_insurance",
    "extra_driver",
    "baby_seat",
    "wash",
    # Flight
    "aeroline",
    "flight_number",
    # Monthly
    "monthly_mileage",
    # Notification
    "notification_required",
    "notification_sent",
    "notification_sent_at",
    "notification_sent_by",
    # GHL (migration 019)
    "ghl_contact_id",
    "ghl_opportunity_id",
    "ghl_last_sync",
    # Status
    "status",
    "created_by",
    # nota (migration 027)
    "nota",
    "created_at",
    "updated_at",
    # Marker (migration 050) — MUST be the last two, in this order.
    "_legacy_id",
    "_legacy_migrated_at",
)

# Index of `_legacy_id` in the INSERT tuple (second-to-last). The fake-cursor
# tests and the insert engine read the legacy id from this position.
LEGACY_ID_INSERT_INDEX = len(INSERT_COLUMNS) - 2

INSERT_SQL = (
    "INSERT INTO public.reservations (" + ", ".join(INSERT_COLUMNS) + ") "
    "VALUES %s "
    "ON CONFLICT (_legacy_id) DO NOTHING "
    "RETURNING _legacy_id"
)


def _record_to_tuple(rec: ReservationRecord, migrated_at: datetime) -> tuple:
    """Build the INSERT row tuple for a ReservationRecord.

    Element order MUST match INSERT_COLUMNS exactly (the marker columns
    `_legacy_id` + `_legacy_migrated_at` last). `migrated_at` is the single
    run-start stamp applied to every inserted row.
    """
    return (
        # Relations
        rec.customer_id,
        rec.rental_company_id,
        rec.referral_id,
        rec.referral_raw,
        rec.pickup_location_id,
        rec.return_location_id,
        # Identity
        rec.franchise,
        rec.booking_type,
        rec.reservation_code,
        rec.reference_token,
        rec.rate_qualifier,
        # Booking
        rec.category_code,
        rec.pickup_date,
        rec.pickup_hour,
        rec.return_date,
        rec.return_hour,
        rec.selected_days,
        # Pricing
        rec.total_price,
        rec.total_price_to_pay,
        rec.total_price_localiza,
        rec.tax_fee,
        rec.iva_fee,
        # Coverage
        rec.coverage_days,
        rec.coverage_price,
        # Extras
        rec.return_fee,
        rec.extra_hours,
        rec.extra_hours_price,
        rec.total_insurance,
        rec.extra_driver,
        rec.baby_seat,
        rec.wash,
        # Flight
        rec.aeroline,
        rec.flight_number,
        # Monthly
        rec.monthly_mileage,
        # Notification
        rec.notification_required,
        rec.notification_sent,
        rec.notification_sent_at,
        rec.notification_sent_by,
        # GHL
        rec.ghl_contact_id,
        rec.ghl_opportunity_id,
        rec.ghl_last_sync,
        # Status
        rec.status,
        rec.created_by,
        # nota
        rec.nota,
        rec.created_at,
        rec.updated_at,
        # Marker
        rec.legacy_id,
        migrated_at,
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
# Skip classification (ON CONFLICT idempotent re-run).
#
# A computed record whose _legacy_id was NOT returned by the INSERT (and is not a
# batch_error) hit ON CONFLICT (_legacy_id) DO NOTHING — the row already exists.
# We re-read each skipped _legacy_id's marker to classify it (mirrors #19 by
# identification_number, keyed on the int _legacy_id instead):
#   * already_migrated  — existing row has _legacy_migrated_at NOT NULL (a prior
#     ETL run inserted it; the idempotent re-run case, SCEN-007).
#   * conflict_existing — existing row has _legacy_migrated_at NULL. For #20 this
#     is near-impossible (a dashboard row would have NULL _legacy_id, so it could
#     not collide on the _legacy_id key), but kept for symmetry / defense.
#   * conflict_unknown  — ON CONFLICT fired yet the row is absent on re-read: an
#     anomaly that FAILS the commit gate (never treated as explained).
# --------------------------------------------------------------------------- #
def classify_skips(conn, skipped_ids: list[int]) -> dict[int, str]:
    """For ON-CONFLICT-skipped _legacy_ids, classify by the existing row's marker."""
    classification: dict[int, str] = {}
    if not skipped_ids:
        return classification

    cur = conn.cursor()
    try:
        for start in range(0, len(skipped_ids), INSERT_BATCH_SIZE):
            chunk = skipped_ids[start : start + INSERT_BATCH_SIZE]
            cur.execute(
                "SELECT _legacy_id, _legacy_migrated_at "
                "FROM public.reservations WHERE _legacy_id = ANY(%s)",
                (chunk,),
            )
            found = {lid: marker for lid, marker in cur.fetchall()}
            for lid in chunk:
                if lid not in found:
                    classification[lid] = "conflict_unknown"
                elif found[lid] is not None:
                    classification[lid] = "already_migrated"
                else:
                    classification[lid] = "conflict_existing"
    finally:
        try:
            cur.close()
        except Exception:
            pass
    return classification


# Skip reasons that count as a legitimate idempotent-re-run outcome. A
# conflict_unknown is DELIBERATELY excluded — it is an anomaly that must FAIL the
# commit gate. A batch_error is also explained but is not a skip reason (handled
# by the separate `lid in batch_errors` clause in the predicate below).
EXPLAINED_SKIP_REASONS: frozenset[str] = frozenset(
    {"already_migrated", "conflict_existing"}
)


def non_inserted_all_explained(
    records: list[ReservationRecord],
    inserted_ids: set[int],
    batch_errors: dict[int, str],
    skip_classification: dict[int, str],
) -> bool:
    """True iff every computed record is inserted, a batch_error, or an EXPLAINED skip.

    On a clean first run all records insert. On a re-run, conflicts mean
    inserted < computed; that is legitimate ONLY when each non-inserted record is
    an already_migrated / conflict_existing skip (or a recorded batch_error). A
    conflict_unknown is NOT explained -> the gate fails -> the whole tx rolls back.
    """
    return all(
        rec.legacy_id in inserted_ids
        or rec.legacy_id in batch_errors
        or skip_classification.get(rec.legacy_id) in EXPLAINED_SKIP_REASONS
        for rec in records
    )


def count_conflict_unknown(skip_classification: dict[int, str]) -> int:
    """Count _legacy_ids classified `conflict_unknown` (gate-fail diagnostics)."""
    return sum(1 for r in skip_classification.values() if r == "conflict_unknown")


# --------------------------------------------------------------------------- #
# Per-row JSONL report. NO PII (no identification / name / email / branch id) —
# only the legacy id, the action, and the no-PII reason / non-PII metadata. The
# JSONL is gitignored; the stdout summary is the no-PII evidence either way, but
# the per-row lines are deliberately PII-free too (a reservation row carries no
# identification once transformed — customer is a UUID).
# --------------------------------------------------------------------------- #
def build_report_lines(
    *,
    records: list[ReservationRecord],
    inserted_ids: set[int],
    skip_classification: dict[int, str],
    batch_errors: dict[int, str],
    rejected: list[RejectedRow],
) -> list[dict]:
    """Build the per-row JSONL report lines (one object per logged event)."""
    lines: list[dict] = []

    for rej in rejected:
        lines.append(
            {"action": "rejected", "reason": rej.reason, "legacy_id": rej.legacy_id}
        )

    for rec in records:
        lid = rec.legacy_id
        if lid in batch_errors:
            lines.append(
                {"action": "rejected", "reason": batch_errors[lid], "legacy_id": lid}
            )
        elif lid in inserted_ids:
            lines.append(
                {
                    "action": "inserted",
                    "legacy_id": lid,
                    "status": rec.status,
                    "booking_type": rec.booking_type,
                    "franchise": rec.franchise,
                }
            )
        else:
            lines.append(
                {
                    "action": "skipped",
                    "reason": skip_classification.get(lid, "conflict_unknown"),
                    "legacy_id": lid,
                }
            )

    return lines


# --------------------------------------------------------------------------- #
# Pipeline (post-extract): resolve+transform -> insert -> classify skips ->
# commit gate. Factored out of run() so it is unit-testable with a fake dest
# connection + the execute_values monkeypatch (SCEN-001 reconciliation /
# SCEN-007 idempotency) WITHOUT a real DB. run() wraps it with the legacy/
# destination connections + the report/summary write.
# --------------------------------------------------------------------------- #
@dataclass
class PipelineOutcome:
    """What run_pipeline computed: the disposition buckets + the gate decision."""

    summary: dict
    report_lines: list[dict]
    committed: bool
    gate_failed: bool


def run_pipeline(
    dest_conn,
    maps: LookupMaps,
    extract: ExtractResult,
    migrated_at: datetime,
    *,
    dry_run: bool,
    timestamp: str = "",
    dest_masked: str = "",
    elapsed_seconds: float = 0.0,
    report_path: str | None = None,
) -> PipelineOutcome:
    """Resolve+transform every legacy row, insert, classify skips, gate the commit.

    Mirrors #19's gate/rollback split: COMMIT only if (a) the reconciliation
    invariant closes, (b) there are 0 UNEXPECTED rejects (only taxonomy reasons —
    a batch_error is an unexpected SQL-level reject), and (c) every non-inserted
    record is an EXPLAINED skip (already_migrated / conflict_existing) or inserted.
    Otherwise (commit mode) ROLLBACK the whole tx. In --dry-run always ROLLBACK.
    """
    # ---- Resolve + transform each legacy row (one disposition per row). ----
    # `migrated_at` is the single run-start stamp, also the coalesce target for a
    # fallback-sentinel created_at/updated_at (FIX 1).
    records: list[ReservationRecord] = []
    rejected: list[RejectedRow] = []
    for legacy_row in extract.rows:
        try:
            records.append(transform_row(legacy_row, maps, migrated_at))
        except RejectRow as exc:
            rejected.append(RejectedRow(legacy_row.row_id, exc.reason))

    # ---- Insert (SAVEPOINT-per-batch, row-by-row retry on batch failure). ----
    inserted_ids, batch_error_list = insert_records(dest_conn, records, migrated_at)
    batch_errors: dict[int, str] = dict(batch_error_list)

    # ---- Classify ON CONFLICT skips (existing rows). ----
    skipped_ids = [
        rec.legacy_id
        for rec in records
        if rec.legacy_id not in inserted_ids and rec.legacy_id not in batch_errors
    ]
    skip_classification = classify_skips(dest_conn, skipped_ids)

    # ---- Gate decision (mirror #19). ----
    # Transform/FK rejects are EXPECTED (taxonomy). A batch_error is an
    # UNEXPECTED SQL-level reject — its presence fails the gate.
    unexpected_rejects = len(batch_errors)
    all_non_inserted_explained = non_inserted_all_explained(
        records, inserted_ids, batch_errors, skip_classification
    )
    summary = build_summary(
        dry_run=dry_run,
        committed=False,
        extract=extract,
        inserted_legacy_ids=inserted_ids,
        skip_classification=skip_classification,
        batch_errors=batch_errors,
        rejected=rejected,
        elapsed_seconds=elapsed_seconds,
        timestamp=timestamp,
        dest_masked=dest_masked,
        report_path=report_path,
    )
    reconciles = summary["reconciliation"]["reconciles"]
    gate_pass = (
        unexpected_rejects == 0 and reconciles and all_non_inserted_explained
    )

    committed = False
    gate_failed = False
    if dry_run:
        dest_conn.rollback()
        print("DRY-RUN: transaction ROLLED BACK (nothing written).")
    elif gate_pass:
        dest_conn.commit()
        committed = True
        print(
            f"COMMIT: gate passed (inserted={len(inserted_ids)}, "
            f"skipped={len(skip_classification)}, "
            f"rejected={len(rejected) + len(batch_errors)})."
        )
    else:
        dest_conn.rollback()
        gate_failed = True
        reasons = []
        if unexpected_rejects:
            reasons.append(f"unexpected_rejects={unexpected_rejects}")
        if not reconciles:
            reasons.append(
                f"reconciliation {summary['reconciliation']['sum']} != "
                f"{extract.legacy_rows_total}"
            )
        if not all_non_inserted_explained:
            reasons.append(
                f"conflict_unknown={count_conflict_unknown(skip_classification)}"
            )
        print(
            "GATE FAILED: ROLLED BACK whole transaction ("
            + "; ".join(reasons)
            + "). Nothing written.",
            file=sys.stderr,
        )

    summary["committed"] = committed
    report_lines = build_report_lines(
        records=records,
        inserted_ids=inserted_ids,
        skip_classification=skip_classification,
        batch_errors=batch_errors,
        rejected=rejected,
    )
    return PipelineOutcome(
        summary=summary,
        report_lines=report_lines,
        committed=committed,
        gate_failed=gate_failed,
    )


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
    timestamp, filename_stamp = _utc_stamps()
    dest_masked = mask_db_url(os.environ["SUPABASE_DB_URL"])
    run_started = datetime.now(timezone.utc)
    migrated_at = run_started  # single run-start marker for every inserted row.

    # ---- Extract + capture legacy lookup tables (legacy only; no dest yet). ----
    # The legacy connection is opened, the reservations rows + the three legacy
    # lookup tables (branches/categories/franchises, captured into a replay
    # cursor) are read, then the connection is RELEASED before the destination
    # connect — so the Postgres session is never held idle during the long read.
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
                legacy_lookup_cur = _capture_legacy_lookups(legacy_cur)
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

    outcome = None
    try:
        # ---- Build the 6 FK lookup maps (legacy replay cursor + dest cursor). ----
        try:
            dest_cur = dest_conn.cursor()
            try:
                maps = build_lookup_maps(legacy_lookup_cur, dest_cur)
            finally:
                try:
                    dest_cur.close()
                except Exception:
                    pass
        except Exception as exc:
            print(f"lookup map build failed: {type(exc).__name__}", file=sys.stderr)
            try:
                dest_conn.rollback()
            except Exception:
                pass
            return EXIT_QUERY_ERROR

        # ---- Fail fast if localiza is absent (FIX 3). ----
        # rental_company_id is a NOT NULL destination FK. If it is None, every one
        # of the 12,967 rows would carry NULL into it -> a flood of cryptic 23502
        # batch_errors and a gate fail. Surface the real cause instead.
        if maps.rental_company_id is None:
            print(
                "lookup map build failed: rental_companies code='localiza' not found",
                file=sys.stderr,
            )
            try:
                dest_conn.rollback()
            except Exception:
                pass
            return EXIT_QUERY_ERROR

        # ---- Resolve + transform + insert + classify + gate (the pipeline). ----
        try:
            elapsed = (datetime.now(timezone.utc) - run_started).total_seconds()
            outcome = run_pipeline(
                dest_conn,
                maps,
                extract,
                migrated_at,
                dry_run=dry_run,
                timestamp=timestamp,
                dest_masked=dest_masked,
                elapsed_seconds=elapsed,
            )
        except Exception as exc:
            # Surface the ROOT cause type (a poison batch error followed by a
            # failing SAVEPOINT rollback chains the real cause). Type names only.
            root = exc.__cause__ or exc.__context__
            detail = type(exc).__name__
            if root is not None and type(root) is not type(exc):
                detail += f" (caused by {type(root).__name__})"
            print(f"destination insert failed: {detail}", file=sys.stderr)
            try:
                dest_conn.rollback()
            except Exception:
                pass
            return EXIT_QUERY_ERROR
    finally:
        _close(dest_conn)

    # ---- Report (per-row JSONL + stdout summary). ----
    report_path = write_jsonl_report(outcome.report_lines, filename_stamp)
    summary = dict(outcome.summary)
    summary["report_path"] = str(report_path) if report_path else None
    print(json.dumps(summary, indent=2, ensure_ascii=False))

    if report_path is None:
        return EXIT_REPORT_FAILED
    if outcome.gate_failed:
        return EXIT_GATE_FAILED
    return EXIT_OK


def extract_legacy_rows(legacy_cur) -> ExtractResult:
    """Run the single legacy SELECT and coerce rows to LegacyRow with accounting.

    Runs the #20 legacy SELECT (the full reservations column set; FKs as raw
    BIGINTs, resolved later via the maps — no JOINs here). Free-text fields
    (fullname/reserve_code/note/aeroline/flight_number/user/ghl ids) are
    control-char sanitized so a NUL byte never reaches Postgres text; created_at/
    updated_at parse via _as_aware (a zero-date / unparseable value falls back to
    the synthetic sentinel and is counted in timestamp_fallback). Every scanned
    row becomes exactly one LegacyRow (reservations are 1:1 — no pre-insert drop;
    a row that cannot resolve becomes a REJECT downstream, not a silent skip).
    """
    legacy_cur.execute(LEGACY_SELECT)
    result = ExtractResult()
    for raw in legacy_cur.fetchall():
        result.legacy_rows_total += 1
        (
            row_id, fullname, identification, id_type, status, category,
            pickup_location, return_location, franchise, user, reserve_code, note,
            pickup_date, pickup_hour, return_date, return_hour, selected_days,
            total_price, total_price_to_pay, total_price_localiza, tax_fee, iva_fee,
            coverage_days, coverage_price, return_fee, extra_hours, extra_hours_price,
            total_insurance, extra_driver, baby_seat, wash, aeroline, flight_number,
            monthly_mileage, ghl_contact_id, ghl_opportunity_id, ghl_last_sync,
            created, updated,
        ) = raw

        created_at, created_fb = _as_aware(created, FALLBACK_SENTINEL)
        updated_at, updated_fb = _as_aware(updated, FALLBACK_SENTINEL)
        if created_fb or updated_fb:
            result.timestamp_fallback += 1

        result.rows.append(
            LegacyRow(
                row_id=int(row_id),
                fullname=_sanitize_text(fullname),
                identification=str(identification) if identification is not None else "",
                identification_type=_sanitize_text(id_type),
                status=status,
                category=category,
                pickup_location=pickup_location,
                return_location=return_location,
                franchise=franchise,
                user=_sanitize_text(user),
                reserve_code=_sanitize_text(reserve_code) if reserve_code is not None else None,
                note=_sanitize_text(note) if note is not None else None,
                pickup_date=pickup_date,
                pickup_hour=pickup_hour,
                return_date=return_date,
                return_hour=return_hour,
                selected_days=selected_days,
                total_price=total_price,
                total_price_to_pay=total_price_to_pay,
                total_price_localiza=total_price_localiza,
                tax_fee=tax_fee,
                iva_fee=iva_fee,
                coverage_days=coverage_days,
                coverage_price=coverage_price,
                return_fee=return_fee,
                extra_hours=extra_hours,
                extra_hours_price=extra_hours_price,
                total_insurance=total_insurance,
                extra_driver=extra_driver,
                baby_seat=baby_seat,
                wash=wash,
                aeroline=_sanitize_text(aeroline) if aeroline is not None else None,
                flight_number=_sanitize_text(flight_number) if flight_number is not None else None,
                monthly_mileage=monthly_mileage,
                ghl_contact_id=_sanitize_text(ghl_contact_id) if ghl_contact_id is not None else None,
                ghl_opportunity_id=_sanitize_text(ghl_opportunity_id) if ghl_opportunity_id is not None else None,
                ghl_last_sync=ghl_last_sync,
                created_at=created_at,
                updated_at=updated_at,
            )
        )
    return result


class _ReplayCursor:
    """A cursor that replays pre-captured legacy lookup result sets by SQL key.

    build_lookup_maps issues three legacy queries (branches / categories /
    franchises). In run() the legacy connection is RELEASED before the
    destination connect, so the three result sets are read EAGERLY during the
    legacy window (_capture_legacy_lookups) and replayed here when
    build_lookup_maps runs against the live destination cursor. Keyed by the SQL
    string so order is irrelevant and a query with no captured rows yields [].
    """

    def __init__(self, by_sql: dict[str, list]):
        self._by_sql = by_sql
        self._current: list = []

    def execute(self, sql, params=None):
        self._current = self._by_sql.get(sql, [])

    def fetchall(self):
        return self._current

    def close(self):
        pass


def _capture_legacy_lookups(legacy_cur) -> _ReplayCursor:
    """Eagerly read the three legacy lookup tables into a replay cursor.

    Called inside the legacy-connection window so the destination connect can be
    deferred (pooler idle-reap). Returns a _ReplayCursor build_lookup_maps drives
    exactly like a live legacy cursor.
    """
    captured: dict[str, list] = {}
    for sql in (
        LEGACY_BRANCHES_SELECT,
        LEGACY_CATEGORIES_SELECT,
        LEGACY_FRANCHISES_SELECT,
    ):
        legacy_cur.execute(sql)
        captured[sql] = list(legacy_cur.fetchall())
    return _ReplayCursor(captured)


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
