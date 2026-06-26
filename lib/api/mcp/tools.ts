import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  getLocationDirectory,
  type LocationDirectoryItem,
} from "@/lib/api/location-directory";
import { searchAvailability } from "@/lib/api/availability-service";
import {
  createReservation,
  type CreateReservationInput,
} from "@/lib/api/reservation-service";
import { ServiceError } from "@/lib/api/service-error";
import {
  encodeQuote,
  decodeQuote,
  assertQuoteSecretConfigured,
} from "@/lib/api/mcp/quote";
import { getHiddenCategoryCodesForCitySlug } from "@/lib/queries/category-city-visibility";
import type { ReservationStatus } from "@/lib/schemas/reservation";

/**
 * MCP tools (issue #72 Step 6-7). Two tools wrap the extracted services with an
 * opaque quote blob bridging them (stateless server). Handlers + input schemas
 * are exported so the route (`app/api/mcp/[transport]/route.ts`) registers them
 * and unit tests call the handlers directly with mocked services.
 *
 * Phase 1 scope (design Non-goals): standard reservations only — no monthly
 * (Localiza always quotes standard), no seguro total. Pricing is derived from the
 * raw Localiza item (no-seguro-total branch) and baked into the quote.
 */

// ---------------------------------------------------------------------------
// Availability item shape (the subset the quote needs). Source of truth:
// proxy/src/localiza/availability.ts:152-174 (camelCase).
// ---------------------------------------------------------------------------
export interface AvailabilityItem {
  categoryCode: string;
  categoryDescription: string;
  totalAmount: number;
  estimatedTotalAmount: number;
  taxFeeAmount: number;
  IVAFeeAmount: number;
  coverageQuantity: number;
  coverageTotalAmount: number;
  returnFeeAmount: number;
  extraHoursQuantity: number;
  extraHoursTotalAmount: number;
  referenceToken: string;
  rateQualifier: string;
}

/** Price subset of QuoteContext, derived from a raw availability item. */
export interface DerivedPricing {
  total_price: number;
  total_price_to_pay: number;
  tax_fee: number;
  iva_fee: number;
  coverage_days: number;
  coverage_price: number;
  return_fee: number;
  extra_hours: number;
  extra_hours_price: number;
}

/**
 * Derive the standard (no-seguro-total) pricing the funnels send, RESOLVED from
 * reading both funnels' composables (design §5 — they converge on these). Key
 * formula: `total_price = totalAmount + returnFeeAmount + taxFeeAmount` (the
 * subtotal + return + tax fee, NOT including IVA); `total_price_to_pay =
 * estimatedTotalAmount` (the all-in figure). The rest map by direct rename.
 */
export function deriveStandardPricing(item: AvailabilityItem): DerivedPricing {
  return {
    total_price: item.totalAmount + item.returnFeeAmount + item.taxFeeAmount,
    total_price_to_pay: item.estimatedTotalAmount,
    tax_fee: item.taxFeeAmount,
    iva_fee: item.IVAFeeAmount,
    coverage_days: item.coverageQuantity,
    coverage_price: item.coverageTotalAmount,
    return_fee: item.returnFeeAmount,
    extra_hours: item.extraHoursQuantity,
    extra_hours_price: item.extraHoursTotalAmount,
  };
}

/**
 * Rental day count — replicates rentacar-web's `rentalDayCount`
 * (packages/logic/src/utils/useDateFunctions.ts): true elapsed hours, a 4-hour
 * grace before a leftover bumps the count, and a single-day floor of 1.
 *
 * Deliberate divergence note (issue #72): rentacar-reservas computes this
 * differently (calendar-day diff + a separate time-of-day diff), which diverges
 * on multi-day spans whose return time-of-day is earlier than the pickup's. We
 * adopt rentacar-web's rule (successor funnel, elapsed-hours based, explicit
 * grace constant). `selected_days` is stored/informational and gates monthly
 * (>=30); it does NOT drive `total_price` (that comes from Localiza), so the
 * divergence is low-materiality. Colombia has no DST → local parsing is stable.
 */
export function computeSelectedDays(
  pickupDateTime: string,
  returnDateTime: string,
): number {
  const GRACE_HOURS = 4;
  const totalHours =
    (new Date(returnDateTime).getTime() - new Date(pickupDateTime).getTime()) /
    (1000 * 60 * 60);

  if (Number.isNaN(totalHours) || totalHours <= 0) return 0;

  const fullDays = Math.floor(totalHours / 24);
  const leftoverHours = totalHours - fullDays * 24;
  const days = fullDays + (leftoverHours > GRACE_HOURS ? 1 : 0);

  return days === 0 ? 1 : days;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Diacritic-, case-, and separator-insensitive normalization for place matching. The
 * directory stores `city` as a SLUG ("santa-marta"), so collapsing spaces/underscores/
 * hyphens to a single space lets a typed "Santa Marta" match it (otherwise a served city
 * is wrongly rejected as "no encuentro una sede").
 */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

/**
 * Resolve a human place name to a Localiza branch `code`. Matches `ciudad`
 * against the directory city (exact-normalized, then partial). `sede` narrows
 * within the city when several branches share it. Returns the first match, or
 * null when nothing matches (the caller lists valid cities).
 */
export function resolveLocationCode(
  directory: LocationDirectoryItem[],
  ciudad: string,
  sede?: string,
): string | null {
  const c = norm(ciudad);
  let matches = directory.filter((l) => norm(l.city) === c);
  if (matches.length === 0) {
    matches = directory.filter(
      (l) => norm(l.city).includes(c) || c.includes(norm(l.city)),
    );
  }
  if (sede && matches.length > 1) {
    const s = norm(sede);
    const narrowed = matches.filter(
      (l) => norm(l.name).includes(s) || norm(l.slug).includes(s),
    );
    if (narrowed.length > 0) matches = narrowed;
  }
  return matches.length > 0 ? matches[0].code : null;
}

function listCities(directory: LocationDirectoryItem[]): string {
  return [...new Set(directory.map((l) => l.city))].sort().join(", ");
}

/** Split "YYYY-MM-DDTHH:mm[:ss]" into the date + "HH:mm" the service expects. */
function splitDateTime(dt: string): { date: string; hour: string } {
  const [date, timeRaw = "00:00"] = dt.split("T");
  return { date, hour: timeRaw.slice(0, 5) };
}

/** Extract the human-readable ES message from a propagated ServiceError. */
function serviceErrorMessage(e: ServiceError): string {
  const p = e.payload as Record<string, unknown>;
  const shortText = typeof p.shortText === "string" ? p.shortText : undefined;
  const message = typeof p.message === "string" ? p.message : undefined;
  const error = typeof p.error === "string" ? p.error : undefined;
  // Localiza warnings arrive with shortText = the RAW code (e.g. "LLNRRE002") and
  // a friendly Spanish `message` already mapped by the proxy. Prefer the message
  // so the user never sees the bare code. Any other error keeps shortText-first.
  const isRawLocalizaCode = !!shortText && /^LLN[A-Z]+\d+/.test(shortText);
  const msg = isRawLocalizaCode
    ? message ?? shortText
    : shortText ?? message ?? error;
  return msg ?? "Ocurrió un error procesando la solicitud.";
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function jsonResult(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    // structuredContent is REQUIRED for any success result once a tool declares
    // an outputSchema — the SDK throws "Output validation error" otherwise
    // (issue #172 WS3). Error results (errorResult) are exempt, so they omit it.
    structuredContent: payload,
  };
}

function reservationMessage(status: ReservationStatus, code: string): string {
  switch (status) {
    case "reservado":
      return `Tu reserva quedó confirmada. Número de solicitud: ${code}.`;
    case "pendiente":
      return `Tu solicitud quedó registrada y está pendiente de confirmación por el operador. Número de solicitud: ${code}.`;
    default:
      return `Tu solicitud quedó registrada. Número de solicitud: ${code}.`;
  }
}

// ---------------------------------------------------------------------------
// Tool 1: buscar_disponibilidad
// ---------------------------------------------------------------------------
export const buscarDisponibilidadInputSchema = {
  ciudad: z
    .string()
    .min(1)
    .describe("Ciudad de recogida y devolución, p. ej. 'bogota'."),
  fecha_recogida: z
    .string()
    .min(1)
    .describe("Fecha de recogida en formato YYYY-MM-DD."),
  fecha_devolucion: z
    .string()
    .min(1)
    .describe("Fecha de devolución en formato YYYY-MM-DD."),
  hora_recogida: z
    .string()
    .optional()
    .describe("Hora de recogida HH:mm (24h). Default 10:00."),
  hora_devolucion: z
    .string()
    .optional()
    .describe("Hora de devolución HH:mm (24h). Default 10:00."),
  sede: z
    .string()
    .optional()
    .describe(
      "Nombre o slug de sede para desambiguar ciudades con varias sedes.",
    ),
};

/**
 * Tool annotations (issue #172 WS3). ChatGPT reads these hints to decide whether
 * it may execute a tool; without them it treats every tool as potentially
 * destructive and refuses. buscar is a pure read.
 */
export const buscarDisponibilidadAnnotations = {
  title: "Buscar disponibilidad",
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

/**
 * Output schema (issue #172 WS3). Must match the success payload of jsonResult
 * exactly — the SDK validates structuredContent against it and rejects a
 * mismatch. ChatGPT also warns when it is absent.
 */
export const buscarDisponibilidadOutputSchema = {
  sede: z.string(),
  dias: z.number(),
  categorias: z.array(
    z.object({
      categoria: z.string(),
      descripcion: z.string(),
      dias: z.number(),
      precio_total: z.number(),
      precio_a_pagar: z.number(),
      iva: z.number(),
      horas_extra: z.number(),
      precio_hora_extra: z.number(),
      quote: z.string(),
    }),
  ),
};

interface BuscarDisponibilidadArgs {
  ciudad: string;
  fecha_recogida: string;
  fecha_devolucion: string;
  hora_recogida?: string;
  hora_devolucion?: string;
  sede?: string;
}

/**
 * Validate an optional HH:mm (24h) hour. Returns the normalized "HH:mm" string,
 * the default when absent, or null when present-but-out-of-range. The shape
 * regex alone is not enough — "25:00"/"10:60" pass it but produce an Invalid Date
 * downstream, so the range check is what prevents a corrupt datetime.
 */
function normalizeHora(h: string | undefined): string | null {
  if (h === undefined || h === "") return "10:00";
  const m = h.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${m[2]}`;
}

export async function buscarDisponibilidad(
  args: BuscarDisponibilidadArgs,
  now: Date = new Date(),
): Promise<CallToolResult> {
  // Fail loud on a misconfigured signing secret BEFORE any work. Otherwise every
  // per-category encodeQuote below would throw and get skipped, leaving an empty
  // result indistinguishable from genuine "no availability" — masking a server
  // fault as a data glitch. Throwing here propagates a real (500-class) error.
  assertQuoteSecretConfigured();

  const { ciudad, fecha_recogida, fecha_devolucion, sede } = args;

  const horaR = normalizeHora(args.hora_recogida);
  const horaD = normalizeHora(args.hora_devolucion);
  if (horaR === null || horaD === null) {
    return errorResult(
      "La hora debe tener formato HH:mm de 24 horas, p. ej. 09:00 o 18:30.",
    );
  }

  let directory: LocationDirectoryItem[];
  try {
    directory = await getLocationDirectory();
  } catch {
    return errorResult(
      "No pude cargar el directorio de sedes en este momento. Intenta de nuevo más tarde.",
    );
  }

  const code = resolveLocationCode(directory, ciudad, sede);
  if (!code) {
    return errorResult(
      `No encuentro una sede para "${ciudad}". Ciudades disponibles: ${listCities(directory)}.`,
    );
  }

  const pickupDateTime = `${fecha_recogida}T${horaR}:00`;
  const returnDateTime = `${fecha_devolucion}T${horaD}:00`;

  // Reject a pickup already in the past (Bogota time, UTC-5 no DST). Localiza
  // rejects it at booking with LLNRRE002; catch it earlier with a clear message
  // so the bot never quotes an unbookable slot (e.g. "hoy 10:00" once it's 13:00).
  const pickupInstant = new Date(`${pickupDateTime}-05:00`);
  if (!Number.isNaN(pickupInstant.getTime()) && pickupInstant.getTime() < now.getTime()) {
    return errorResult(
      "La fecha y hora de recogida ya pasaron. Elige una hora más tarde de hoy o una fecha futura.",
    );
  }

  const selected_days = computeSelectedDays(pickupDateTime, returnDateTime);

  // Non-positive duration (same instant, inverted range, or an unparseable date
  // → NaN → 0). computeSelectedDays stays faithful to the funnel rule (0 here);
  // we turn that into a clean ES error instead of letting encodeQuote throw.
  if (selected_days <= 0) {
    return errorResult(
      "Revisa las fechas y horas: la devolución debe ser posterior a la recogida.",
    );
  }

  let result: unknown;
  try {
    result = await searchAvailability({
      pickupLocation: code,
      returnLocation: code,
      pickupDateTime,
      returnDateTime,
    });
  } catch (e) {
    if (e instanceof ServiceError) return errorResult(serviceErrorMessage(e));
    return errorResult(
      "Error al consultar disponibilidad. Intenta de nuevo más tarde.",
    );
  }

  const items = Array.isArray(result) ? (result as AvailabilityItem[]) : [];
  if (items.length === 0) {
    return errorResult(
      "No hay disponibilidad para esas fechas y sede. Prueba con otras fechas.",
    );
  }

  // Drop gamas the dashboard hid for this city (category_city_visibility). Localiza
  // returns its full fleet per branch; the business restricts some gamas per city
  // (e.g. CX not offered in Barranquilla). Fail OPEN: any lookup error leaves the
  // full list rather than blocking a quote.
  let visibleItems = items;
  try {
    const citySlug = directory.find((l) => l.code === code)?.city;
    if (citySlug) {
      const hidden = await getHiddenCategoryCodesForCitySlug(citySlug);
      if (hidden.size > 0) {
        const filtered = items.filter(
          (it) => !hidden.has(it.categoryCode.toUpperCase()),
        );
        // Only apply if it leaves something — an empty result is more likely a
        // data gap than "no car is available in this city".
        if (filtered.length > 0) visibleItems = filtered;
      }
    }
  } catch (e) {
    console.error("[mcp] category visibility filter failed", e);
  }

  // Build a quote per category. A malformed item (missing numeric field → NaN →
  // encodeQuote's zod rejects it) is SKIPPED, not allowed to crash the whole
  // response — degrade to the categories that priced cleanly.
  const categorias: Array<Record<string, unknown>> = [];
  for (const item of visibleItems) {
    try {
      const pricing = deriveStandardPricing(item);
      const quote = encodeQuote({
        pickupLocation: code,
        returnLocation: code,
        pickupDateTime,
        returnDateTime,
        selected_days,
        categoryCode: item.categoryCode,
        referenceToken: item.referenceToken,
        rateQualifier: item.rateQualifier,
        ...pricing,
      });
      categorias.push({
        categoria: item.categoryCode,
        // Guard the one output field with no upstream validation: the prices go
        // through encodeQuote's zod (a bad number skips the category), but
        // descripcion is never quoted. If Localiza omits it / sends a non-string,
        // a declared outputSchema (descripcion: z.string()) would make the SDK
        // reject the WHOLE response. Degrade to the code instead.
        descripcion:
          typeof item.categoryDescription === "string"
            ? item.categoryDescription
            : item.categoryCode,
        dias: selected_days,
        precio_total: pricing.total_price,
        precio_a_pagar: pricing.total_price_to_pay,
        iva: pricing.iva_fee,
        // Surfaced so the bot/orchestrator can answer "how much is an extra hour"
        // directly. Both are baked into precio_total already; these expose the
        // line item. 0 when the return time is not later than the pickup time.
        horas_extra: pricing.extra_hours,
        precio_hora_extra: pricing.extra_hours_price,
        quote,
      });
    } catch {
      // skip the unpriceable category
    }
  }

  if (categorias.length === 0) {
    return errorResult(
      "No pude preparar la cotización para las gamas disponibles. Intenta de nuevo más tarde.",
    );
  }

  return jsonResult({ sede: code, dias: selected_days, categorias });
}

// ---------------------------------------------------------------------------
// Tool 2: crear_solicitud_reserva
// ---------------------------------------------------------------------------
export const crearSolicitudReservaInputSchema = {
  quote: z
    .string()
    .min(1)
    .describe(
      "El 'quote' opaco devuelto por buscar_disponibilidad para la categoría elegida.",
    ),
  fullname: z.string().min(1).describe("Nombre completo del cliente."),
  identification_type: z
    .string()
    .min(1)
    .describe("Tipo de documento (CC, CE, PA, NIT…)."),
  identification: z.string().min(1).describe("Número de documento."),
  email: z.string().min(1).describe("Correo del cliente."),
  phone: z.string().min(1).describe("Teléfono del cliente."),
  franchise: z
    .string()
    .min(1)
    .describe("Franquicia (p. ej. alquilatucarro) — define plantillas y marca."),
  extra_driver: z.boolean().optional().describe("Conductor adicional."),
  baby_seat: z.boolean().optional().describe("Silla para bebé."),
  wash: z.boolean().optional().describe("Lavado."),
  flight: z.boolean().optional().describe("Llega en vuelo."),
  aeroline: z.string().optional().describe("Aerolínea (si llega en vuelo)."),
  flight_number: z.string().optional().describe("Número de vuelo."),
};

/**
 * Tool annotations (issue #172 WS3). crear writes (creates a reservation in
 * Localiza) and reaches an external system, but it is not destructive of
 * existing data and is not idempotent (each call is a new request).
 */
export const crearSolicitudReservaAnnotations = {
  title: "Crear solicitud de reserva",
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

/** Output schema (issue #172 WS3). Matches the success payload of jsonResult. */
export const crearSolicitudReservaOutputSchema = {
  estado: z.string(),
  numero_solicitud: z.string(),
  mensaje: z.string(),
};

interface CrearSolicitudReservaArgs {
  quote: string;
  fullname: string;
  identification_type: string;
  identification: string;
  email: string;
  phone: string;
  franchise: string;
  extra_driver?: boolean;
  baby_seat?: boolean;
  wash?: boolean;
  flight?: boolean;
  aeroline?: string;
  flight_number?: string;
  // Defensive: NOT in the input schema (seguro total is out of Phase 1), but
  // guarded at runtime so a direct/forged call can never book with it.
  total_insurance?: boolean;
}

export async function crearSolicitudReserva(
  args: CrearSolicitudReservaArgs,
): Promise<CallToolResult> {
  // Seguro total is out of Phase 1 (design Non-goals). The schema doesn't expose
  // it; reject defensively if it ever arrives true.
  if (args.total_insurance === true) {
    return errorResult(
      "El seguro total no está disponible por este canal todavía. Realiza la reserva sin seguro total.",
    );
  }

  let ctx;
  try {
    ctx = decodeQuote(args.quote);
  } catch (e) {
    // decodeQuote throws a ready ES message; the service is never called.
    return errorResult((e as Error).message);
  }

  const pickup = splitDateTime(ctx.pickupDateTime);
  const ret = splitDateTime(ctx.returnDateTime);

  const input: CreateReservationInput = {
    pickup_location: ctx.pickupLocation,
    return_location: ctx.returnLocation,
    pickup_date: pickup.date,
    pickup_hour: pickup.hour,
    return_date: ret.date,
    return_hour: ret.hour,
    selected_days: ctx.selected_days,
    category: ctx.categoryCode,
    reference_token: ctx.referenceToken,
    rate_qualifier: ctx.rateQualifier,
    total_price: ctx.total_price,
    total_price_to_pay: ctx.total_price_to_pay,
    tax_fee: ctx.tax_fee,
    iva_fee: ctx.iva_fee,
    coverage_days: ctx.coverage_days,
    coverage_price: ctx.coverage_price,
    return_fee: ctx.return_fee,
    extra_hours: ctx.extra_hours,
    extra_hours_price: ctx.extra_hours_price,
    fullname: args.fullname,
    identification_type: args.identification_type,
    identification: args.identification,
    email: args.email,
    phone: args.phone,
    franchise: args.franchise,
    extra_driver: args.extra_driver,
    baby_seat: args.baby_seat,
    wash: args.wash,
    flight: args.flight,
    aeroline: args.aeroline,
    flight_number: args.flight_number,
  };

  let result;
  try {
    result = await createReservation(input);
  } catch (e) {
    if (e instanceof ServiceError) return errorResult(serviceErrorMessage(e));
    return errorResult(
      "Error al crear la reserva. Intenta de nuevo más tarde.",
    );
  }

  return jsonResult({
    estado: result.reservationStatus,
    numero_solicitud: result.reserveCode,
    mensaje: reservationMessage(result.reservationStatus, result.reserveCode),
  });
}
