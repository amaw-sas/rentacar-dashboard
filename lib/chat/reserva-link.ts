import { decodeQuote } from "@/lib/api/mcp/quote";
import { getFranchiseBranding } from "@/lib/constants/franchises";
import type { LocationDirectoryItem } from "@/lib/api/location-directory";

/**
 * Fallback links for when the bot can't create the reservation (provider down,
 * no availability). Instead of looping retries, the agent hands the customer two
 * pre-filled shortcuts so the lead isn't lost:
 *  - webUrl: the website search deep-link (city/sede/dates/hours/gama already set),
 *    resolved by the same slug contract the site's router consumes.
 *  - whatsappUrl: the brand advisor's wa.me with every reservation field pre-typed.
 *
 * Built server-side because only the chat route has both the quote context and the
 * customer data. Returns null when the quote can't be decoded or the sede isn't in
 * the directory (caller degrades to the plain brand site).
 */

export interface FallbackLinkInput {
  brand: string;
  quote: string;
  gamaDescripcion?: string;
  customer: {
    fullname: string;
    identification_type: string;
    identification: string;
    email: string;
    phone: string;
  };
}

export interface FallbackLinks {
  webUrl: string;
  whatsappUrl: string;
}

/** date = YYYY-MM-DD, hour = HH:mm (24h) — same split the booking input uses. */
function splitDateTime(dt: string): { date: string; hour: string } {
  const [date, timeRaw = "00:00"] = dt.split("T");
  return { date, hour: timeRaw.slice(0, 5) };
}

export function buildFallbackLinks(
  input: FallbackLinkInput,
  directory: LocationDirectoryItem[],
): FallbackLinks | null {
  let ctx;
  try {
    ctx = decodeQuote(input.quote);
  } catch {
    return null;
  }

  const pickup = directory.find((l) => l.code === ctx.pickupLocation);
  if (!pickup) return null;
  const ret = directory.find((l) => l.code === ctx.returnLocation) ?? pickup;

  const branding = getFranchiseBranding(input.brand);
  const p = splitDateTime(ctx.pickupDateTime);
  const r = splitDateTime(ctx.returnDateTime);
  const categoria = ctx.categoryCode.toLowerCase();

  const webUrl =
    `${branding.website}/${pickup.city}/buscar-vehiculos` +
    `/lugar-recogida/${pickup.slug}/lugar-devolucion/${ret.slug}` +
    `/fecha-recogida/${p.date}/fecha-devolucion/${r.date}` +
    `/hora-recogida/${p.hour}/hora-devolucion/${r.hour}` +
    `/categoria/${categoria}`;

  const gama = input.gamaDescripcion
    ? `${ctx.categoryCode} (${input.gamaDescripcion})`
    : ctx.categoryCode;
  const msg = [
    "Hola, intenté reservar por el chat y no se pudo. Quiero completar mi reserva:",
    `• Gama: ${gama}`,
    `• Sede: ${pickup.name}`,
    `• Fechas: ${p.date} ${p.hour} → ${r.date} ${r.hour}`,
    `• Nombre: ${input.customer.fullname}`,
    `• Documento: ${input.customer.identification_type} ${input.customer.identification}`,
    `• Correo: ${input.customer.email}`,
    `• Teléfono: ${input.customer.phone}`,
  ].join("\n");

  const whatsappUrl = `https://wa.me/${branding.whatsapp}?text=${encodeURIComponent(msg)}`;

  return { webUrl, whatsappUrl };
}
