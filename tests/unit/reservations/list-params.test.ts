import { describe, it, expect } from "vitest";
import {
  ALL,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  SEARCH_COLUMNS,
  SEARCH_MAX_LEN,
  SORTABLE_COLUMNS,
  parseListParams,
  sanitizeSearchTerm,
} from "@/lib/reservations/list-params";

function parse(query: string) {
  return parseListParams(new URLSearchParams(query));
}

describe("parseListParams — filters", () => {
  it("empty URL → all filters null, default sort, page 1", () => {
    const p = parse("");
    expect(p.franchise).toBeNull();
    expect(p.status).toBeNull();
    expect(p.cityId).toBeNull();
    expect(p.referralId).toBeNull();
    expect(p.createdFrom).toBeNull();
    expect(p.search).toBe("");
    expect(p.sort).toEqual(DEFAULT_SORT);
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it("hydrates franchise/status/city/referral from URL", () => {
    const p = parse(
      "franchise=alquilatucarro&status=pendiente&city=city-1&referral=ref-9",
    );
    expect(p.franchise).toBe("alquilatucarro");
    expect(p.status).toBe("pendiente");
    expect(p.cityId).toBe("city-1");
    expect(p.referralId).toBe("ref-9");
  });

  it("unknown enum values fall back to null (not the bogus value)", () => {
    const p = parse("franchise=nope&status=not_a_status");
    expect(p.franchise).toBeNull();
    expect(p.status).toBeNull();
  });

  it("ALL sentinel is never a valid stored value (client drops it before write)", () => {
    // The client writes the key only for concrete values; ALL means 'no filter'.
    const p = parse(`status=${ALL}`);
    expect(p.status).toBeNull();
  });
});

describe("parseListParams — Origen filter (SCEN-008)", () => {
  it("hydrates a concrete channel from ?origen", () => {
    expect(parse("origen=google_ads").attributionChannel).toBe("google_ads");
  });

  it("keeps the __unknown__ sentinel (Desconocido → IS NULL downstream)", () => {
    expect(parse("origen=__unknown__").attributionChannel).toBe("__unknown__");
  });

  it("ignores an out-of-enum channel value (falls back to null)", () => {
    expect(parse("origen=bogus").attributionChannel).toBeNull();
  });

  it("is null when no origen param is present", () => {
    expect(parse("").attributionChannel).toBeNull();
  });
});

describe("parseListParams — date ranges (SCEN-007)", () => {
  it("parses valid created/pickup ranges", () => {
    const p = parse(
      "created_from=2026-05-01&created_to=2026-05-31&pickup_from=2026-06-01&pickup_to=2026-06-30",
    );
    expect(p.createdFrom).toBe("2026-05-01");
    expect(p.createdTo).toBe("2026-05-31");
    expect(p.pickupFrom).toBe("2026-06-01");
    expect(p.pickupTo).toBe("2026-06-30");
  });

  it("drops malformed dates", () => {
    const p = parse("created_from=not-a-date&created_to=2026-05-31");
    expect(p.createdFrom).toBeNull();
    expect(p.createdTo).toBe("2026-05-31");
  });

  it("normalizes an inverted range by swapping endpoints", () => {
    const p = parse("pickup_from=2026-12-31&pickup_to=2026-01-01");
    expect(p.pickupFrom).toBe("2026-01-01");
    expect(p.pickupTo).toBe("2026-12-31");
  });
});

describe("parseListParams — sort whitelist + fallback (SCEN-011, SCEN-144)", () => {
  // SCEN-144-003: created_at is the only column that stays server-sortable — it is
  // the one served by the composite index (is_priority DESC, created_at DESC), so
  // ordering by it never degrades to a full-table heapsort. Both directions map.
  it("maps created_at, the only retained sortable column, to its DB column", () => {
    expect(parse("sort=created_at:asc").sort).toEqual({
      column: "created_at",
      ascending: true,
    });
    expect(parse("sort=created_at:desc").sort).toEqual({
      column: "created_at",
      ascending: false,
    });
  });

  // Issue #104 dropped the five snapshot-identity sort keys (customer/
  // identification/phone/email/valor_oc). Issue #144 extended the same treatment
  // to status, category_code, reservation_code and pickup: no is_priority-leading
  // index, so sorting by them forced a full-table top-N heapsort. They fall back
  // to DEFAULT_SORT — defense-in-depth so a hand-edited `?sort=status:asc` link
  // the client no longer emits is still ignored. The matching headers go inert
  // (enableSorting:false) in reservations-columns.test.tsx. (franchise and origen
  // left this list once migration 065 added their composite indexes.)
  it("falls back to default sort for the unindexed columns (#104 + #144)", () => {
    const dropped = [
      // #104
      "customer",
      "identification",
      "phone",
      "email",
      "valor_oc",
      // #144
      "status",
      "category_code",
      "reservation_code",
      "pickup",
    ];
    for (const id of dropped) {
      expect(parse(`sort=${id}:asc`).sort, id).toEqual(DEFAULT_SORT);
      expect(parse(`sort=${id}:desc`).sort, id).toEqual(DEFAULT_SORT);
    }
  });

  // franchise + origen are server-sortable again (migration 065 added the
  // is_priority-leading composite indexes). franchise maps to itself; the origen
  // column id maps to the attribution_channel DB column.
  it("maps the franchise sort key to the franchise column", () => {
    expect(parse("sort=franchise:asc").sort).toEqual({
      column: "franchise",
      ascending: true,
    });
    expect(parse("sort=franchise:desc").sort).toEqual({
      column: "franchise",
      ascending: false,
    });
  });

  it("maps the origen sort key to attribution_channel", () => {
    expect(parse("sort=origen:asc").sort).toEqual({
      column: "attribution_channel",
      ascending: true,
    });
    expect(parse("sort=origen:desc").sort).toEqual({
      column: "attribution_channel",
      ascending: false,
    });
  });

  // Pins the sortable set: every key here MUST be backed by an is_priority-leading
  // composite index. A future re-add without one would silently reintroduce a
  // full-table heapsort path — this guard turns that regression red.
  it("exposes exactly the indexed sortable columns", () => {
    expect(SORTABLE_COLUMNS).toEqual({
      created_at: "created_at",
      franchise: "franchise",
      origen: "attribution_channel",
    });
  });

  it("falls back to default sort for a derived/unmapped column id", () => {
    expect(parse("sort=referral:asc").sort).toEqual(DEFAULT_SORT);
    expect(parse("sort=total_with_tax:desc").sort).toEqual(DEFAULT_SORT);
  });

  it("falls back to default sort for an invalid direction", () => {
    expect(parse("sort=pickup:sideways").sort).toEqual(DEFAULT_SORT);
    expect(parse("sort=garbage").sort).toEqual(DEFAULT_SORT);
  });
});

describe("parseListParams — page sanitization", () => {
  it("coerces non-positive / non-numeric / overflow pages to 1", () => {
    for (const raw of ["abc", "-1", "0", "1e10", "999999999"]) {
      expect(parse(`page=${raw}`).page).toBe(1);
    }
  });

  it("parses a valid page (1-based)", () => {
    expect(parse("page=3").page).toBe(3);
  });
});

describe("sanitizeSearchTerm — PostgREST safety (SCEN-012)", () => {
  it("strips structural chars `,()` so the or() filter list cannot be broken", () => {
    expect(sanitizeSearchTerm("O'BRIEN, JOSE")).toBe("O'BRIEN JOSE");
    expect(sanitizeSearchTerm("(drop) table, x")).toBe("drop table x");
  });

  it("strips ilike wildcards `*%` so they cannot be injected", () => {
    expect(sanitizeSearchTerm("a*b%c")).toBe("a b c");
  });

  it("preserves apostrophes, dots and accents (real identity characters)", () => {
    expect(sanitizeSearchTerm("josé.peña@correo.com")).toBe(
      "josé.peña@correo.com",
    );
  });

  it("collapses whitespace and caps length", () => {
    expect(sanitizeSearchTerm("  a   b  ")).toBe("a b");
    expect(sanitizeSearchTerm("x".repeat(5000)).length).toBe(SEARCH_MAX_LEN);
  });
});

describe("SEARCH_COLUMNS — snapshot-keyed search (issue #26) + nota (issue #109)", () => {
  it("targets the booking-time snapshot columns, the reservation code, and the operational note", () => {
    expect(SEARCH_COLUMNS).toEqual([
      "customer_name_at_booking",
      "customer_identification_number_at_booking",
      "customer_email_at_booking",
      "customer_phone_at_booking",
      "reservation_code",
      "nota",
    ]);
    // Guard against a regression that re-introduces live-join search, which
    // would let an operator match a value (post-edit name) shown nowhere on the
    // row — the exact bug #26's snapshot guards against. `nota` is a native
    // reservations column (not a join), so it keeps this invariant. SCEN-2.
    for (const col of SEARCH_COLUMNS) {
      expect(col.startsWith("customers.")).toBe(false);
    }
  });

  it("includes nota so an operator can find a reservation by its operational note (issue #109, SCEN-1)", () => {
    expect(SEARCH_COLUMNS).toContain("nota");
  });
});
