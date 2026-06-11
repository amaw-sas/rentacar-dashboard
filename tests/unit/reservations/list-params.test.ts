import { describe, it, expect } from "vitest";
import {
  ALL,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  SEARCH_COLUMNS,
  SEARCH_MAX_LEN,
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

describe("parseListParams — sort whitelist + fallback (SCEN-011)", () => {
  it("maps a sortable column id to its DB column", () => {
    expect(parse("sort=pickup:asc").sort).toEqual({
      column: "pickup_date",
      ascending: true,
    });
    expect(parse("sort=valor_oc:desc").sort).toEqual({
      column: "total_price_localiza",
      ascending: false,
    });
    expect(parse("sort=customer:asc").sort).toEqual({
      column: "customer_name_at_booking",
      ascending: true,
    });
  });

  it("maps the origen sort key to attribution_channel (SCEN-009)", () => {
    expect(parse("sort=origen:asc").sort).toEqual({
      column: "attribution_channel",
      ascending: true,
    });
    expect(parse("sort=origen:desc").sort).toEqual({
      column: "attribution_channel",
      ascending: false,
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

describe("SEARCH_COLUMNS — snapshot-keyed search (issue #26)", () => {
  it("targets the booking-time snapshot columns, never the live customers join", () => {
    expect(SEARCH_COLUMNS).toEqual([
      "customer_name_at_booking",
      "customer_identification_number_at_booking",
      "customer_email_at_booking",
      "customer_phone_at_booking",
      "reservation_code",
    ]);
    // Guard against a regression that re-introduces live-join search, which
    // would let an operator match a value (post-edit name) shown nowhere on the
    // row — the exact bug #26's snapshot guards against.
    for (const col of SEARCH_COLUMNS) {
      expect(col.startsWith("customers.")).toBe(false);
    }
  });
});
