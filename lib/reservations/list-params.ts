import { FRANCHISES, RESERVATION_STATUSES } from "@/lib/schemas/reservation";
import {
  ATTRIBUTION_CHANNEL_SET,
  UNKNOWN_FILTER,
} from "@/lib/attribution/channel-meta";

// Single source of truth for the reservations-list URL contract, shared by the
// server component (reads searchParams → query) and the client URL-state hook
// (writes searchParams). Keeping the key names + validation here prevents drift
// between what the client writes and what the server reads. Pure module: no
// "use client", no browser APIs — importable from both layers. Issue #100.

export const ALL = "__all__";
export const DEFAULT_PAGE_SIZE = 20;
export const SEARCH_MAX_LEN = 200;
const MAX_PAGE = 10_000;

const FRANCHISE_SET = new Set<string>(FRANCHISES);
const STATUS_SET = new Set<string>(RESERVATION_STATUSES);

// Snapshot columns (issue #26): search keys off the booking-time identity the UI
// shows, never the live `customers` join. Prod has 0 NULLs in the four identity
// columns so snapshot-only search is complete; reservation_code may be NULL
// (those rows simply don't match a code search, which is correct).
// `nota` (issue #109): native operational-note column on reservations — the
// operator's own free text shown on the row, so searching it does not reopen the
// #26 hole (that was about the live join, not native columns). NULL notes simply
// don't match, which is correct.
export const SEARCH_COLUMNS = [
  "customer_name_at_booking",
  "customer_identification_number_at_booking",
  "customer_email_at_booking",
  "customer_phone_at_booking",
  "reservation_code",
  "nota",
] as const;

// Maps a @tanstack column id (serialized into `?sort=<id>:<dir>`) to the real DB
// column it orders by. Ids absent here are derived/joined (referral,
// total_with_tax) and fall back to DEFAULT_SORT. Mirrors the sortable columns in
// columns.tsx.
export const SORTABLE_COLUMNS: Record<string, string> = {
  created_at: "created_at",
  pickup: "pickup_date",
  reservation_code: "reservation_code",
  category_code: "category_code",
  franchise: "franchise",
  status: "status",
  valor_oc: "total_price_localiza",
  customer: "customer_name_at_booking",
  identification: "customer_identification_number_at_booking",
  phone: "customer_phone_at_booking",
  email: "customer_email_at_booking",
  origen: "attribution_channel",
};

export interface ReservationSort {
  column: string;
  ascending: boolean;
}

export const DEFAULT_SORT: ReservationSort = {
  column: "created_at",
  ascending: false,
};

export interface ReservationListParams {
  franchise: string | null;
  status: string | null;
  attributionChannel: string | null;
  cityId: string | null;
  referralId: string | null;
  createdFrom: string | null;
  createdTo: string | null;
  pickupFrom: string | null;
  pickupTo: string | null;
  search: string;
  sort: ReservationSort;
  page: number;
  pageSize: number;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_DIGITS_RE = /^\d+$/;

function enumOrNull(v: string | null, set: Set<string>): string | null {
  return v && set.has(v) ? v : null;
}

// Attribution-channel filter: the `__unknown__` sentinel maps to "Desconocido"
// (channel IS NULL) downstream; any other value must be one of the 9 channels or
// it is ignored (out-of-enum → null). Issue #113.
function attributionChannelOrNull(v: string | null): string | null {
  if (!v) return null;
  if (v === UNKNOWN_FILTER) return UNKNOWN_FILTER; // "__unknown__" sentinel → IS NULL
  return ATTRIBUTION_CHANNEL_SET.has(v) ? v : null; // out-of-enum → ignored
}

function stringOrNull(v: string | null): string | null {
  return v && v.length > 0 ? v : null;
}

function isoDateOrNull(v: string | null): string | null {
  return v && ISO_DATE_RE.test(v) ? v : null;
}

// Strip PostgREST-structural chars (`,()` split/group the or() filter list) and
// ilike wildcards (`*%`) so an operator can neither break the filter list nor
// inject wildcards. Collapse whitespace, cap length. SCEN-012.
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[,()*%]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_MAX_LEN);
}

function parseSort(raw: string | null): ReservationSort {
  if (!raw) return DEFAULT_SORT;
  const [id, dir] = raw.split(":");
  const column = SORTABLE_COLUMNS[id ?? ""];
  if (!column || (dir !== "asc" && dir !== "desc")) return DEFAULT_SORT;
  return { column, ascending: dir === "asc" };
}

function parsePage(raw: string | null): number {
  if (!raw || !PAGE_DIGITS_RE.test(raw)) return 1;
  const n = Number(raw);
  if (n < 1 || n > MAX_PAGE) return 1;
  return n;
}

// ISO yyyy-mm-dd strings compare lexically, so a swapped range is detectable and
// fixable without parsing to Date. Mirrors the client hook's inverted-range
// normalization so a hand-edited share link behaves identically server-side.
function normalizeRange(
  from: string | null,
  to: string | null,
): [string | null, string | null] {
  if (from && to && from > to) return [to, from];
  return [from, to];
}

export function parseListParams(
  params: URLSearchParams,
): ReservationListParams {
  const [createdFrom, createdTo] = normalizeRange(
    isoDateOrNull(params.get("created_from")),
    isoDateOrNull(params.get("created_to")),
  );
  const [pickupFrom, pickupTo] = normalizeRange(
    isoDateOrNull(params.get("pickup_from")),
    isoDateOrNull(params.get("pickup_to")),
  );

  return {
    franchise: enumOrNull(params.get("franchise"), FRANCHISE_SET),
    status: enumOrNull(params.get("status"), STATUS_SET),
    attributionChannel: attributionChannelOrNull(params.get("origen")),
    cityId: stringOrNull(params.get("city")),
    referralId: stringOrNull(params.get("referral")),
    createdFrom,
    createdTo,
    pickupFrom,
    pickupTo,
    search: sanitizeSearchTerm(params.get("q") ?? ""),
    sort: parseSort(params.get("sort")),
    page: parsePage(params.get("page")),
    pageSize: DEFAULT_PAGE_SIZE,
  };
}
