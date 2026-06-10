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
});
