import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import { z } from "zod";

// Issue #72 Steps 6-7: the two MCP tools. Holdout SCEN-108..117.
// Services + directory are mocked; the REAL quote codec runs so SCEN-110 proves
// a genuinely decodable quote, not a stub.

vi.mock("@/lib/api/location-directory", () => ({
  getLocationDirectory: vi.fn(),
}));
vi.mock("@/lib/api/availability-service", () => ({
  searchAvailability: vi.fn(),
}));
vi.mock("@/lib/api/reservation-service", () => ({
  createReservation: vi.fn(),
}));

import {
  deriveStandardPricing,
  computeSelectedDays,
  resolveLocationCode,
  buscarDisponibilidad,
  crearSolicitudReserva,
  buscarDisponibilidadAnnotations,
  buscarDisponibilidadOutputSchema,
  crearSolicitudReservaAnnotations,
  crearSolicitudReservaOutputSchema,
  type AvailabilityItem,
} from "@/lib/api/mcp/tools";
import { decodeQuote } from "@/lib/api/mcp/quote";
import { ServiceError } from "@/lib/api/service-error";
import { getLocationDirectory } from "@/lib/api/location-directory";
import { searchAvailability } from "@/lib/api/availability-service";
import { createReservation } from "@/lib/api/reservation-service";
import type { LocationDirectoryItem } from "@/lib/api/location-directory";

const ITEM: AvailabilityItem = {
  categoryCode: "C",
  categoryDescription: "Gama C Económico Mecánico",
  totalAmount: 100,
  estimatedTotalAmount: 138,
  taxFeeAmount: 5,
  IVAFeeAmount: 19,
  coverageQuantity: 4,
  coverageTotalAmount: 40,
  returnFeeAmount: 14,
  extraHoursQuantity: 2,
  extraHoursTotalAmount: 16,
  referenceToken: "tok-abc",
  rateQualifier: "RQ1",
};

function dir(items: Partial<LocationDirectoryItem>[]): LocationDirectoryItem[] {
  return items.map((i) => ({
    slug: "slug",
    code: "CODE",
    city: "Bogotá",
    name: "Sede",
    status: "active",
    pickup_address: "",
    pickup_map: "",
    schedule: {},
    ...i,
  }));
}

// Since issue #172 the quote codec is HMAC-signed and FAILS CLOSED without a
// strong (>= 32 char) secret; the tools exercise the real codec, so provide one
// for the suite.
const STRONG_SECRET = "test-quote-secret-0123456789abcdef";
let ORIGINAL_QUOTE_SECRET: string | undefined;
beforeAll(() => {
  ORIGINAL_QUOTE_SECRET = process.env.MCP_QUOTE_SECRET;
  process.env.MCP_QUOTE_SECRET = STRONG_SECRET;
});
afterAll(() => {
  if (ORIGINAL_QUOTE_SECRET === undefined) delete process.env.MCP_QUOTE_SECRET;
  else process.env.MCP_QUOTE_SECRET = ORIGINAL_QUOTE_SECRET;
});

function textOf(result: { content: unknown[] }): string {
  return result.content
    .filter(
      (c): c is { type: "text"; text: string } =>
        typeof c === "object" &&
        c !== null &&
        (c as { type?: unknown }).type === "text",
    )
    .map((c) => c.text)
    .join("\n");
}

describe("deriveStandardPricing (SCEN-108)", () => {
  it("SCEN-108: replicates the §5 no-seguro-total formulas", () => {
    const p = deriveStandardPricing(ITEM);
    // total_price = totalAmount + returnFeeAmount + taxFeeAmount (NO IVA)
    expect(p.total_price).toBe(100 + 14 + 5);
    expect(p.total_price_to_pay).toBe(138); // estimatedTotalAmount
    expect(p.tax_fee).toBe(5);
    expect(p.iva_fee).toBe(19);
    expect(p.coverage_days).toBe(4);
    expect(p.coverage_price).toBe(40);
    expect(p.return_fee).toBe(14);
    expect(p.extra_hours).toBe(2);
    expect(p.extra_hours_price).toBe(16);
  });
});

describe("computeSelectedDays (SCEN-109)", () => {
  it("SCEN-109: diff with >4h grace, single-day floor of 1", () => {
    // exact 4 days
    expect(computeSelectedDays("2026-07-01T10:00:00", "2026-07-05T10:00:00")).toBe(4);
    // 4 days + 3h → no bump
    expect(computeSelectedDays("2026-07-01T10:00:00", "2026-07-05T13:00:00")).toBe(4);
    // 4 days + 5h → bump to 5
    expect(computeSelectedDays("2026-07-01T10:00:00", "2026-07-05T15:00:00")).toBe(5);
    // exactly 4h leftover → NOT >4 → no bump
    expect(computeSelectedDays("2026-07-01T10:00:00", "2026-07-05T14:00:00")).toBe(4);
    // same day +2h → single-day floor 1
    expect(computeSelectedDays("2026-07-01T10:00:00", "2026-07-01T12:00:00")).toBe(1);
    // non-positive → 0
    expect(computeSelectedDays("2026-07-05T10:00:00", "2026-07-01T10:00:00")).toBe(0);
  });
});

describe("resolveLocationCode", () => {
  it("matches city diacritic/case-insensitively", () => {
    const d = dir([{ city: "Bogotá", code: "AABOG01" }]);
    expect(resolveLocationCode(d, "bogota")).toBe("AABOG01");
    expect(resolveLocationCode(d, "BOGOTÁ")).toBe("AABOG01");
  });
  it("matches a slug city against a spaced/typed name (Santa Marta → santa-marta)", () => {
    // The directory stores `city` as the slug; a customer types it with a space.
    const d = dir([{ city: "santa-marta", code: "AASMR01" }]);
    expect(resolveLocationCode(d, "Santa Marta")).toBe("AASMR01");
    expect(resolveLocationCode(d, "santa marta")).toBe("AASMR01");
  });
  it("narrows by sede when several branches share a city", () => {
    const d = dir([
      { city: "Bogotá", code: "AABOG01", name: "Aeropuerto", slug: "bog-aero" },
      { city: "Bogotá", code: "AABOG02", name: "Centro", slug: "bog-centro" },
    ]);
    expect(resolveLocationCode(d, "bogota", "centro")).toBe("AABOG02");
  });
  it("returns null when nothing matches", () => {
    expect(resolveLocationCode(dir([{ city: "Bogotá" }]), "narnia")).toBeNull();
  });
});

describe("buscar_disponibilidad (SCEN-110..112)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Pin "now" so the past-pickup guard is deterministic and the 2026-07-01
    // fixtures stay in the future regardless of the real clock.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-25T12:00:00.000Z"));
    vi.mocked(getLocationDirectory).mockResolvedValue(
      dir([{ city: "Bogotá", code: "AABOG01" }]),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a pickup datetime already in the past (no service call)", async () => {
    const res = await buscarDisponibilidad({
      ciudad: "bogota",
      fecha_recogida: "2026-06-20", // before the pinned now
      fecha_devolucion: "2026-06-27",
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/ya pasaron|futura/i);
    expect(vi.mocked(searchAvailability)).not.toHaveBeenCalled();
  });

  it("surfaces the friendly Spanish message for a raw Localiza code (LLNRRE002)", async () => {
    vi.mocked(searchAvailability).mockRejectedValue(
      new ServiceError(500, {
        error: "inferior_pickup_date",
        message: "Selecciona la fecha de recogida igual o posterior a la fecha actual",
        shortText: "LLNRRE002",
      }),
    );
    const res = await buscarDisponibilidad({
      ciudad: "bogota",
      fecha_recogida: "2026-07-01",
      fecha_devolucion: "2026-07-05",
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe(
      "Selecciona la fecha de recogida igual o posterior a la fecha actual",
    );
    expect(textOf(res)).not.toMatch(/LLNRRE002/);
  });

  // SCEN-110 — happy path: ES categories + a decodable quote per category.
  it("SCEN-110: returns categories with a quote that decodes to the derived pricing", async () => {
    vi.mocked(searchAvailability).mockResolvedValue([ITEM]);

    const res = await buscarDisponibilidad({
      ciudad: "bogota",
      fecha_recogida: "2026-07-01",
      fecha_devolucion: "2026-07-05",
    });

    expect(res.isError).toBeFalsy();
    // The service was called with the resolved code for both pickup+return.
    expect(vi.mocked(searchAvailability)).toHaveBeenCalledWith({
      pickupLocation: "AABOG01",
      returnLocation: "AABOG01",
      pickupDateTime: "2026-07-01T10:00:00",
      returnDateTime: "2026-07-05T10:00:00",
    });

    const payload = JSON.parse(textOf(res));
    expect(payload.sede).toBe("AABOG01");
    expect(payload.categorias).toHaveLength(1);
    const cat = payload.categorias[0];
    expect(cat.categoria).toBe("C");
    expect(cat.descripcion).toBe("Gama C Económico Mecánico");
    // Etapa 0: extra-hour line items surfaced so the bot can answer them directly.
    expect(typeof cat.horas_extra).toBe("number");
    expect(typeof cat.precio_hora_extra).toBe("number");

    // The opaque quote decodes to the derived pricing + computed selected_days.
    const ctx = decodeQuote(cat.quote);
    const pricing = deriveStandardPricing(ITEM);
    expect(ctx.total_price).toBe(pricing.total_price);
    expect(ctx.total_price_to_pay).toBe(pricing.total_price_to_pay);
    expect(ctx.tax_fee).toBe(pricing.tax_fee);
    expect(ctx.iva_fee).toBe(pricing.iva_fee);
    expect(ctx.coverage_days).toBe(pricing.coverage_days);
    expect(ctx.coverage_price).toBe(pricing.coverage_price);
    expect(ctx.return_fee).toBe(pricing.return_fee);
    expect(ctx.extra_hours).toBe(pricing.extra_hours);
    expect(ctx.extra_hours_price).toBe(pricing.extra_hours_price);
    expect(ctx.selected_days).toBe(4);
    expect(ctx.categoryCode).toBe("C");
    expect(ctx.referenceToken).toBe("tok-abc");
    expect(ctx.rateQualifier).toBe("RQ1");
    expect(ctx.pickupLocation).toBe("AABOG01");
    expect(ctx.returnLocation).toBe("AABOG01");
  });

  // SCEN-111 — city not resolvable → isError listing valid cities, no service call.
  it("SCEN-111: unresolvable city → isError with valid cities, no service call", async () => {
    const res = await buscarDisponibilidad({
      ciudad: "ciudad-inexistente",
      fecha_recogida: "2026-07-01",
      fecha_devolucion: "2026-07-05",
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/Bogotá/);
    expect(vi.mocked(searchAvailability)).not.toHaveBeenCalled();
  });

  // SCEN-112 — Localiza business error → isError with the ES text.
  it("SCEN-112: ServiceError from the service → isError with ES message", async () => {
    vi.mocked(searchAvailability).mockRejectedValue(
      new ServiceError(422, {
        error: "localiza_business_error",
        message: "Fuera de horario",
        shortText: "Sede cerrada a esa hora",
      }),
    );
    const res = await buscarDisponibilidad({
      ciudad: "bogota",
      fecha_recogida: "2026-07-01",
      fecha_devolucion: "2026-07-05",
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe("Sede cerrada a esa hora");
  });

  it("empty availability → isError (no categories)", async () => {
    vi.mocked(searchAvailability).mockResolvedValue([]);
    const res = await buscarDisponibilidad({
      ciudad: "bogota",
      fecha_recogida: "2026-07-01",
      fecha_devolucion: "2026-07-05",
    });
    expect(res.isError).toBe(true);
  });

  // SCEN-136 — a MISSING/weak MCP_QUOTE_SECRET must NOT masquerade as empty
  // availability. Without the up-front guard, every encodeQuote in the loop
  // throws → categorias ends empty → the generic "intenta más tarde" message,
  // indistinguishable from a data glitch. buscar must THROW (propagate a config
  // error) before the loop instead. The service is never even reached.
  it("SCEN-136: missing quote secret surfaces as a real error, not fake 'no availability'", async () => {
    vi.mocked(searchAvailability).mockResolvedValue([ITEM]);
    const saved = process.env.MCP_QUOTE_SECRET;
    try {
      delete process.env.MCP_QUOTE_SECRET;
      await expect(
        buscarDisponibilidad({
          ciudad: "bogota",
          fecha_recogida: "2026-07-01",
          fecha_devolucion: "2026-07-05",
        }),
      ).rejects.toThrow(/MCP_QUOTE_SECRET/);
      // The misconfiguration short-circuits before the availability call.
      expect(vi.mocked(searchAvailability)).not.toHaveBeenCalled();

      // A weak (too-short) secret is treated the same.
      process.env.MCP_QUOTE_SECRET = "short";
      await expect(
        buscarDisponibilidad({
          ciudad: "bogota",
          fecha_recogida: "2026-07-01",
          fecha_devolucion: "2026-07-05",
        }),
      ).rejects.toThrow(/MCP_QUOTE_SECRET/);
    } finally {
      if (saved === undefined) delete process.env.MCP_QUOTE_SECRET;
      else process.env.MCP_QUOTE_SECRET = saved;
    }
  });

  // SCEN-121 — non-positive duration → clean isError, no throw, no service call.
  it("SCEN-121: same-day/inverted/invalid range → isError without throwing or calling the service", async () => {
    // same day, same default hour → 0 duration
    const sameDay = await buscarDisponibilidad({
      ciudad: "bogota",
      fecha_recogida: "2026-07-01",
      fecha_devolucion: "2026-07-01",
    });
    expect(sameDay.isError).toBe(true);
    expect(textOf(sameDay)).toMatch(/posterior a la recogida/i);

    // inverted range
    const inverted = await buscarDisponibilidad({
      ciudad: "bogota",
      fecha_recogida: "2026-07-05",
      fecha_devolucion: "2026-07-01",
    });
    expect(inverted.isError).toBe(true);

    // unparseable date
    const badDate = await buscarDisponibilidad({
      ciudad: "bogota",
      fecha_recogida: "2026-13-45",
      fecha_devolucion: "2026-13-46",
    });
    expect(badDate.isError).toBe(true);

    expect(vi.mocked(searchAvailability)).not.toHaveBeenCalled();
  });

  // SCEN-122 — out-of-range hour → clean isError (shape regex alone would pass).
  it("SCEN-122: out-of-range hour → isError, no invalid datetime", async () => {
    for (const bad of ["25:00", "10:60"]) {
      const res = await buscarDisponibilidad({
        ciudad: "bogota",
        fecha_recogida: "2026-07-01",
        fecha_devolucion: "2026-07-05",
        hora_recogida: bad,
      });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toMatch(/HH:mm/i);
    }
    expect(vi.mocked(searchAvailability)).not.toHaveBeenCalled();
  });

  // SCEN-123 — a malformed availability item is skipped, valid ones still served.
  it("SCEN-123: malformed item is skipped, valid categories still returned", async () => {
    const malformed = { ...ITEM, categoryCode: "X", returnFeeAmount: undefined };
    vi.mocked(searchAvailability).mockResolvedValue([
      malformed as unknown as AvailabilityItem,
      ITEM,
    ]);
    const res = await buscarDisponibilidad({
      ciudad: "bogota",
      fecha_recogida: "2026-07-01",
      fecha_devolucion: "2026-07-05",
    });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(textOf(res));
    expect(payload.categorias).toHaveLength(1);
    expect(payload.categorias[0].categoria).toBe("C");
  });

  // SCEN-123 (all-fail facet) — every item unpriceable → clean isError.
  it("SCEN-123: all items unpriceable → isError", async () => {
    const bad = { ...ITEM, totalAmount: undefined };
    vi.mocked(searchAvailability).mockResolvedValue([
      bad as unknown as AvailabilityItem,
    ]);
    const res = await buscarDisponibilidad({
      ciudad: "bogota",
      fecha_recogida: "2026-07-01",
      fecha_devolucion: "2026-07-05",
    });
    expect(res.isError).toBe(true);
  });
});

describe("crear_solicitud_reserva (SCEN-113..117)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Build a valid quote through the real codec for the happy path.
  async function validQuote(): Promise<string> {
    vi.mocked(getLocationDirectory).mockResolvedValue(
      dir([{ city: "Bogotá", code: "AABOG01" }]),
    );
    vi.mocked(searchAvailability).mockResolvedValue([ITEM]);
    const res = await buscarDisponibilidad({
      ciudad: "bogota",
      fecha_recogida: "2026-07-01",
      fecha_devolucion: "2026-07-05",
      hora_recogida: "08:30",
      hora_devolucion: "08:30",
    });
    return JSON.parse(textOf(res)).categorias[0].quote;
  }

  const CUSTOMER = {
    fullname: "Juan Pérez",
    identification_type: "CC",
    identification: "123456789",
    email: "juan@example.com",
    phone: "3001234567",
    franchise: "alquilatucarro",
  };

  // SCEN-113 — valid quote + customer → reservation created, ES output, mapping ok.
  it("SCEN-113: maps quote+args to CreateReservationInput and returns ES output", async () => {
    const quote = await validQuote();
    vi.mocked(createReservation).mockResolvedValue({
      reserveCode: "ABC123",
      reservationStatus: "reservado",
    });

    const res = await crearSolicitudReserva({ quote, ...CUSTOMER, baby_seat: true });
    expect(res.isError).toBeFalsy();

    const input = vi.mocked(createReservation).mock.calls[0][0];
    // datetime split from the quote (hora 08:30 baked at search)
    expect(input.pickup_location).toBe("AABOG01");
    expect(input.return_location).toBe("AABOG01");
    expect(input.pickup_date).toBe("2026-07-01");
    expect(input.pickup_hour).toBe("08:30");
    expect(input.return_date).toBe("2026-07-05");
    expect(input.return_hour).toBe("08:30");
    expect(input.category).toBe("C");
    expect(input.reference_token).toBe("tok-abc");
    expect(input.rate_qualifier).toBe("RQ1");
    expect(input.total_price).toBe(119);
    expect(input.total_price_to_pay).toBe(138);
    expect(input.fullname).toBe("Juan Pérez");
    expect(input.franchise).toBe("alquilatucarro");
    expect(input.baby_seat).toBe(true);

    const out = JSON.parse(textOf(res));
    expect(out.estado).toBe("reservado");
    expect(out.numero_solicitud).toBe("ABC123");
    expect(out.mensaje).toMatch(/confirmada/i);
  });

  // SCEN-114 — invalid quote → isError, service NEVER called.
  it("SCEN-114: corrupt quote → isError without calling the service", async () => {
    const res = await crearSolicitudReserva({ quote: "@@@garbage@@@", ...CUSTOMER });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/cotización/i);
    expect(vi.mocked(createReservation)).not.toHaveBeenCalled();
  });

  // SCEN-115 — ServiceError from the service → isError with ES text.
  it("SCEN-115: ServiceError → isError with ES message (shortText)", async () => {
    const quote = await validQuote();
    vi.mocked(createReservation).mockRejectedValue(
      new ServiceError(409, {
        error: "no_inventory",
        message: "Sin inventario",
        shortText: "No hay vehículos de esa gama",
      }),
    );
    const res = await crearSolicitudReserva({ quote, ...CUSTOMER });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe("No hay vehículos de esa gama");
  });

  // SCEN-116 — total_insurance=true → reject (seguro total out of Phase 1).
  it("SCEN-116: total_insurance=true is rejected, no booking with insurance", async () => {
    const quote = await validQuote();
    const res = await crearSolicitudReserva({
      quote,
      ...CUSTOMER,
      total_insurance: true,
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/seguro total/i);
    expect(vi.mocked(createReservation)).not.toHaveBeenCalled();
  });

  // SCEN-117 — the tool never sets total_insurance on the built input.
  it("SCEN-117: built input never carries total_insurance:true", async () => {
    const quote = await validQuote();
    vi.mocked(createReservation).mockResolvedValue({
      reserveCode: "X",
      reservationStatus: "pendiente",
    });
    await crearSolicitudReserva({ quote, ...CUSTOMER });
    const input = vi.mocked(createReservation).mock.calls[0][0];
    expect(input.total_insurance).not.toBe(true);
  });
});

// WS3 (issue #172): ChatGPT connector readiness — annotations + outputSchema +
// structuredContent. Holdout SCEN-W4..W6, W8.
describe("ChatGPT readiness metadata (SCEN-W4..W8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLocationDirectory).mockResolvedValue(
      dir([{ city: "Bogotá", code: "AABOG01" }]),
    );
  });

  // SCEN-W4 — annotations carry the safety hints ChatGPT reads to allow execution.
  it("SCEN-W4: tool annotations carry the correct safety hints", () => {
    expect(buscarDisponibilidadAnnotations.readOnlyHint).toBe(true);
    expect(buscarDisponibilidadAnnotations.destructiveHint).toBe(false);
    expect(buscarDisponibilidadAnnotations.openWorldHint).toBe(false);

    expect(crearSolicitudReservaAnnotations.readOnlyHint).toBe(false);
    expect(crearSolicitudReservaAnnotations.destructiveHint).toBe(false);
    expect(crearSolicitudReservaAnnotations.idempotentHint).toBe(false);
    expect(crearSolicitudReservaAnnotations.openWorldHint).toBe(true);
  });

  // SCEN-W5 — buscar success must carry structuredContent that validates against
  // its outputSchema, or the SDK throws "Output validation error".
  it("SCEN-W5: buscar success → structuredContent valid against its outputSchema", async () => {
    vi.mocked(searchAvailability).mockResolvedValue([ITEM]);
    const res = await buscarDisponibilidad({
      ciudad: "bogota",
      fecha_recogida: "2026-07-01",
      fecha_devolucion: "2026-07-05",
    });

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toBeDefined();
    // mirrors the text payload exactly
    expect(res.structuredContent).toEqual(JSON.parse(textOf(res)));
    // and validates against the declared schema → SDK won't reject it
    const parsed = z
      .object(buscarDisponibilidadOutputSchema)
      .safeParse(res.structuredContent);
    expect(parsed.success).toBe(true);
  });

  // SCEN-W10 — a missing/non-string description degrades to the category code
  // instead of failing the whole response at SDK output-validation time.
  it("SCEN-W10: non-string description degrades to the code, structuredContent stays valid", async () => {
    vi.mocked(searchAvailability).mockResolvedValue([
      // categoryDescription deliberately absent (as Localiza may omit it for an
      // uncurated gama); cast through unknown to model the runtime boundary.
      { ...ITEM, categoryDescription: undefined as unknown as string },
    ]);

    const res = await buscarDisponibilidad({
      ciudad: "bogota",
      fecha_recogida: "2026-07-01",
      fecha_devolucion: "2026-07-05",
    });

    expect(res.isError).toBeFalsy();
    const cat = (res.structuredContent as { categorias: { descripcion: string }[] })
      .categorias[0];
    expect(cat.descripcion).toBe("C"); // degraded to categoryCode
    const parsed = z
      .object(buscarDisponibilidadOutputSchema)
      .safeParse(res.structuredContent);
    expect(parsed.success).toBe(true);
  });

  // SCEN-W6 — crear success must carry structuredContent valid against its schema.
  it("SCEN-W6: crear success → structuredContent valid against its outputSchema", async () => {
    vi.mocked(searchAvailability).mockResolvedValue([ITEM]);
    const buscar = await buscarDisponibilidad({
      ciudad: "bogota",
      fecha_recogida: "2026-07-01",
      fecha_devolucion: "2026-07-05",
    });
    const quote = JSON.parse(textOf(buscar)).categorias[0].quote;

    vi.mocked(createReservation).mockResolvedValue({
      reserveCode: "ABC123",
      reservationStatus: "reservado",
    });
    const res = await crearSolicitudReserva({
      quote,
      fullname: "Juan Pérez",
      identification_type: "CC",
      identification: "123456789",
      email: "juan@example.com",
      phone: "3001234567",
      franchise: "alquilatucarro",
    });

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toBeDefined();
    expect(res.structuredContent).toEqual(JSON.parse(textOf(res)));
    const parsed = z
      .object(crearSolicitudReservaOutputSchema)
      .safeParse(res.structuredContent);
    expect(parsed.success).toBe(true);
  });

  // SCEN-W8 — error results must NOT carry structuredContent (the SDK exempts
  // isError results from schema validation; emitting it would be a latent bug).
  it("SCEN-W8: error results carry no structuredContent", async () => {
    const res = await crearSolicitudReserva({
      quote: "@@@garbage@@@",
      fullname: "x",
      identification_type: "CC",
      identification: "1",
      email: "x@x.com",
      phone: "3",
      franchise: "alquilatucarro",
    });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toBeUndefined();
  });
});
