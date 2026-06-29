import { describe, it, expect } from "vitest";
import type { LocationDirectoryItem } from "@/lib/api/location-directory";
import {
  detectUnsupportedVehicle,
  groundSlots,
  hasBookingHours,
} from "@/lib/chat/orchestrator/ground";
import type { Slots } from "@/lib/chat/orchestrator/slots";

/**
 * Pure unit tests for the deterministic slot grounding (P0). No LLM, no network —
 * the directory is a fixture, which is exactly why this layer is testable where the
 * model's own resolution is not.
 */

const loc = (
  city: string,
  name: string,
  slug: string,
  code: string,
): LocationDirectoryItem => ({
  slug,
  code,
  city,
  name,
  status: "active",
  pickup_address: "",
  pickup_map: "",
  schedule: {},
});

const DIRECTORY: LocationDirectoryItem[] = [
  loc("palmira", "Palmira Centro", "palmira-centro", "PAL"),
  loc("cali", "Cali Aeropuerto", "cali-aeropuerto", "CLO"),
  loc("bogota", "Bogotá Aeropuerto El Dorado", "bogota-aeropuerto", "BOG"),
  // A second "aeropuerto" so a bare sede name is AMBIGUOUS across cities.
  loc("medellin", "Medellín Aeropuerto", "medellin-aeropuerto", "MDE"),
];

const slots = (partial: Partial<Slots>): Slots => ({ cliente: {}, ...partial });

function ground(partial: Partial<Slots>, userMessage = "") {
  return groundSlots({
    slots: slots(partial),
    userMessage,
    directory: DIRECTORY,
  });
}

describe("groundSlots — (a) serviceable city", () => {
  it("drops an unserved city and emits a note listing served cities", () => {
    const { slots: out, notes } = ground({ ciudad: "Tuluá" });
    expect(out.ciudad).toBeUndefined();
    const note = notes.find((n) => n.kind === "city_not_serviceable");
    expect(note).toBeDefined();
    expect(note).toMatchObject({ kind: "city_not_serviceable", attempted: "Tuluá" });
    if (note?.kind === "city_not_serviceable") {
      expect(note.valid).toEqual(
        expect.arrayContaining(["Palmira", "Cali", "Bogota", "Medellin"]),
      );
    }
  });

  it("keeps a served city untouched and emits no note", () => {
    const { slots: out, notes } = ground({ ciudad: "Palmira" });
    expect(out.ciudad).toBe("Palmira");
    expect(notes).toHaveLength(0);
  });

  it("matches a served city case/diacritic-insensitively", () => {
    expect(ground({ ciudad: "bogota" }).slots.ciudad).toBe("bogota");
    expect(ground({ ciudad: "BOGOTÁ" }).slots.ciudad).toBe("BOGOTÁ");
  });
});

describe("groundSlots — (b) reconcile ciudad from sede", () => {
  it("derives the city from an unambiguous sede, overriding a stale city", () => {
    const { slots: out, notes } = ground({ ciudad: "Tuluá", sede: "Cali Aeropuerto" });
    expect(out.ciudad).toBe("cali");
    expect(notes.find((n) => n.kind === "city_derived_from_sede")).toMatchObject({
      kind: "city_derived_from_sede",
      city: "Cali",
    });
    // The corrected city is serviceable → no city_not_serviceable note.
    expect(notes.find((n) => n.kind === "city_not_serviceable")).toBeUndefined();
  });

  it("does NOT override when the sede is ambiguous across cities", () => {
    const { slots: out, notes } = ground({ ciudad: "cali", sede: "aeropuerto" });
    expect(out.ciudad).toBe("cali");
    expect(notes.find((n) => n.kind === "city_derived_from_sede")).toBeUndefined();
  });

  it("leaves the city alone when it already matches the sede", () => {
    const { notes } = ground({ ciudad: "Cali", sede: "Cali Aeropuerto" });
    expect(notes.find((n) => n.kind === "city_derived_from_sede")).toBeUndefined();
  });
});

describe("detectUnsupportedVehicle — (c)", () => {
  it("flags fuels/classes we don't offer", () => {
    expect(detectUnsupportedVehicle("necesito algo diésel")).toBe("diésel");
    expect(detectUnsupportedVehicle("un carro eléctrico")).toBe("eléctrico");
    expect(detectUnsupportedVehicle("tienen una van para 12?")).toBe("van/furgón");
    expect(detectUnsupportedVehicle("un camión de estacas")).toContain("estacas");
    expect(detectUnsupportedVehicle("algo blindado")).toBe("blindado");
    expect(detectUnsupportedVehicle("alquilan motos?")).toBe("moto");
  });

  it("does NOT flag products we DO offer (camioneta, híbrido)", () => {
    expect(detectUnsupportedVehicle("una camioneta automática")).toBeNull();
    expect(detectUnsupportedVehicle("un híbrido por favor")).toBeNull();
    expect(detectUnsupportedVehicle("un auto económico a gasolina")).toBeNull();
  });

  it("surfaces the term through groundSlots as a note", () => {
    const { notes } = ground({ ciudad: "Cali" }, "quiero algo diésel");
    expect(notes.find((n) => n.kind === "unsupported_vehicle")).toMatchObject({
      kind: "unsupported_vehicle",
      term: "diésel",
    });
  });
});

describe("hasBookingHours — (d) gate", () => {
  it("requires BOTH pickup and return hours", () => {
    expect(hasBookingHours(slots({ hora_recogida: "09:00", hora_devolucion: "09:00" }))).toBe(true);
    expect(hasBookingHours(slots({ hora_recogida: "09:00" }))).toBe(false);
    expect(hasBookingHours(slots({ hora_devolucion: "09:00" }))).toBe(false);
    expect(hasBookingHours(slots({}))).toBe(false);
  });
});
