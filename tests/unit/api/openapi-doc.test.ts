import { describe, it, expect } from "vitest";
import spec from "@/docs/apidog-rentacar-api.json";
import { DIRECTORY_COLUMNS } from "@/lib/api/location-directory";

// SCEN-006: the served OpenAPI contract must never drift from what the endpoint
// actually returns. Both the `.select()` projection and this assertion consume
// the single `DIRECTORY_COLUMNS` constant, so a column added/removed in the
// handler without updating the doc (or vice versa) fails here.
describe("OpenAPI doc — location directory parity (SCEN-006)", () => {
  it("LocationDirectoryItem properties equal DIRECTORY_COLUMNS exactly", () => {
    const props = spec.components.schemas.LocationDirectoryItem.properties;
    expect(new Set(Object.keys(props))).toEqual(new Set(DIRECTORY_COLUMNS));
  });

  it("documents GET /api/locations as public (security overridden to [])", () => {
    const op = spec.paths["/api/locations"].get;
    expect(op.security).toEqual([]);
    expect(op.responses["200"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/LocationDirectoryResponse",
    );
  });

  it("LocationDirectoryResponse has count and an array of items", () => {
    const props = spec.components.schemas.LocationDirectoryResponse.properties;
    expect(props.count).toBeDefined();
    expect(props.locations.items.$ref).toBe(
      "#/components/schemas/LocationDirectoryItem",
    );
  });

  it("keeps the reservation paths intact", () => {
    expect(spec.paths["/api/reservations"]).toBeDefined();
    expect(spec.paths["/api/reservations/availability"]).toBeDefined();
  });

  // SCEN-119 (issue #72 Step 9): AvailabilityResponseItem must document the FULL
  // shape `searchAvailability` emits. Source of truth: the proxy parser
  // (proxy/src/localiza/availability.ts:153-173). The proxy is a separate package
  // with no consumable export, so the field list is mirrored here explicitly —
  // if the parser gains/loses a field, update both this list and the doc. The
  // last five (passengerCount…picoyplacaExempt) are NOT proxy fields — they are
  // added by the dashboard's capacity enrichment (#72) and must stay documented.
  it("SCEN-119: AvailabilityResponseItem documents the full real item shape", () => {
    const REAL_ITEM_FIELDS = [
      "categoryCode",
      "categoryDescription",
      "totalAmount",
      "estimatedTotalAmount",
      "vehicleDayCharge",
      "numberDays",
      "coverageUnitCharge",
      "coverageQuantity",
      "coverageTotalAmount",
      "extraHoursQuantity",
      "extraHoursUnityAmount",
      "extraHoursTotalAmount",
      "taxFeeAmount",
      "taxFeePercentage",
      "IVAFeeAmount",
      "returnFeeAmount",
      "discountAmount",
      "discountPercentage",
      "rateQualifier",
      "referenceToken",
      // Capacity fields (#72) — added by the dashboard's category enrichment,
      // NOT emitted by the proxy parser.
      "passengerCount",
      "luggageCount",
      "transmission",
      "hasAc",
      "picoyplacaExempt",
    ];
    const props = spec.components.schemas.AvailabilityResponseItem.properties;
    expect(new Set(Object.keys(props))).toEqual(new Set(REAL_ITEM_FIELDS));
  });

  // Two-door split: quoting is a public read (security overridden to []), while
  // the write endpoint that creates real Localiza reservations stays gated by the
  // global ApiKeyAuth (no per-op override). Locks both doors against an accidental
  // swap — opening reservations or re-closing availability fails here.
  it("exposes availability as public but keeps reservation creation gated", () => {
    expect(spec.paths["/api/reservations/availability"].post.security).toEqual([]);
    // No per-operation override → inherits the global ApiKeyAuth requirement.
    // `in` (not property access) because the JSON literal type has no `security`
    // key on this operation, which is exactly the invariant under test.
    expect("security" in spec.paths["/api/reservations"].post).toBe(false);
    expect(spec.security).toEqual([{ ApiKeyAuth: [] }]);
  });

  // GET /api/requirements is a public read (security []), like locations, and is
  // backed by the RentalRequirements schema.
  it("documents GET /api/requirements as public, backed by RentalRequirements", () => {
    const op = spec.paths["/api/requirements"].get;
    expect(op.security).toEqual([]);
    expect(op.responses["200"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/RentalRequirements",
    );
    expect(spec.components.schemas.RentalRequirements).toBeDefined();
  });
});
