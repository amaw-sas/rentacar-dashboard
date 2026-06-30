import { decodeQuote } from "@/lib/api/mcp/quote";
import { getFranchiseBranding } from "@/lib/constants/franchises";
import { botReferralCode } from "@/lib/chat/bot-referral";
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
  /** All-in total of the chosen gama (COP) — only the self-serve SHARE message uses it. */
  precioTotal?: number;
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

export interface SelfServeLinks {
  webUrl: string;
  /** wa.me WITHOUT a number → WhatsApp opens the contact picker so the customer can
   * forward the quote to anyone (or save it to themselves). Pre-filled with the quote. */
  shareUrl: string;
}

const COP = new Intl.NumberFormat("es-CO");

/** date = YYYY-MM-DD, hour = HH:mm (24h) — same split the booking input uses. */
function splitDateTime(dt: string): { date: string; hour: string } {
  const [date, timeRaw = "00:00"] = dt.split("T");
  return { date, hour: timeRaw.slice(0, 5) };
}

/**
 * The shared part of every reservation link: decode the quote, resolve pickup/return
 * sedes from the directory, and build the website deep-link + the human-readable
 * gama/sede/period fields. Returns null when the quote can't be decoded or the pickup
 * sede isn't in the directory — both builders below short-circuit on that. The webUrl
 * is IDENTICAL across builders (only the WhatsApp message text differs).
 */
interface LinkContext {
  webUrl: string;
  whatsapp: string;
  gama: string;
  sedeName: string;
  periodo: string;
}

function buildLinkContext(
  input: FallbackLinkInput,
  directory: LocationDirectoryItem[],
): LinkContext | null {
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

  // Stamp the bot's referido in the deep-link (the site's `/referido/<code>/` route
  // sets the referente → "Referido" column), so a customer who finishes on the web
  // via the BOT's link is credited to the bot — but one who uses an advisor's own
  // link keeps that advisor. The code is the bot's identity, so the link always
  // carries it (the CHAT_ATTRIBUTION_BOT flag gates the in-chat booking, not the link).
  const referralCode = botReferralCode(input.brand);
  const referralSeg = referralCode ? `/referido/${referralCode}` : "";

  const webUrl =
    `${branding.website}/${pickup.city}/buscar-vehiculos${referralSeg}` +
    `/lugar-recogida/${pickup.slug}/lugar-devolucion/${ret.slug}` +
    `/fecha-recogida/${p.date}/fecha-devolucion/${r.date}` +
    `/hora-recogida/${p.hour}/hora-devolucion/${r.hour}` +
    `/categoria/${categoria}`;

  const gama = input.gamaDescripcion
    ? `${ctx.categoryCode} (${input.gamaDescripcion})`
    : ctx.categoryCode;

  return {
    webUrl,
    whatsapp: branding.whatsapp,
    gama,
    sedeName: pickup.name,
    periodo: `${p.date} ${p.hour} → ${r.date} ${r.hour}`,
  };
}

export function buildFallbackLinks(
  input: FallbackLinkInput,
  directory: LocationDirectoryItem[],
): FallbackLinks | null {
  const link = buildLinkContext(input, directory);
  if (!link) return null;

  const msg = [
    "Hola, intenté reservar por el chat y no se pudo. Quiero completar mi reserva:",
    `• Gama: ${link.gama}`,
    `• Sede: ${link.sedeName}`,
    `• Fechas: ${link.periodo}`,
    `• Nombre: ${input.customer.fullname}`,
    `• Documento: ${input.customer.identification_type} ${input.customer.identification}`,
    `• Correo: ${input.customer.email}`,
    `• Teléfono: ${input.customer.phone}`,
  ].join("\n");

  const whatsappUrl = `https://wa.me/${link.whatsapp}?text=${encodeURIComponent(msg)}`;
  return { webUrl: link.webUrl, whatsappUrl };
}

/**
 * On-demand reservation links (Rediseño híbrido · Etapa 4). Same webUrl as the
 * fallback, but a NEUTRAL WhatsApp message ("quiero reservar / recibir información")
 * for when the customer asks for the link/advisor mid-flow — NOT after a failure.
 * Customer lines that are still empty are omitted (no "undefined" in the text).
 * Returns null on the same conditions as the fallback (undecodable quote / unknown sede).
 */
export function buildOnDemandLinks(
  input: FallbackLinkInput,
  directory: LocationDirectoryItem[],
): FallbackLinks | null {
  const link = buildLinkContext(input, directory);
  if (!link) return null;

  const c = input.customer;
  const lines = [
    "Hola, quiero reservar / recibir información:",
    `• Gama: ${link.gama}`,
    `• Sede: ${link.sedeName}`,
    `• Fechas: ${link.periodo}`,
  ];
  if (c.fullname) lines.push(`• Nombre: ${c.fullname}`);
  const doc = [c.identification_type, c.identification].filter(Boolean).join(" ");
  if (doc) lines.push(`• Documento: ${doc}`);
  if (c.email) lines.push(`• Correo: ${c.email}`);
  if (c.phone) lines.push(`• Teléfono: ${c.phone}`);

  const msg = lines.join("\n");
  const whatsappUrl = `https://wa.me/${link.whatsapp}?text=${encodeURIComponent(msg)}`;
  return { webUrl: link.webUrl, whatsappUrl };
}

/**
 * Self-serve links (P3 · CHAT_SELFSERVE_LINK) for when the customer defers after a quote
 * ("déjame pensarlo"): the same website deep-link PLUS a SHARE message. The share uses a
 * numberless `wa.me/?text=` so WhatsApp opens the contact picker — the customer forwards the
 * quote to whoever decides with them, or keeps it. The message carries the quote summary AND
 * the deep-link, so the recipient can book straight from it. Null on the same conditions as
 * the other builders (undecodable quote / unknown sede).
 */
export function buildSelfServeLinks(
  input: FallbackLinkInput,
  directory: LocationDirectoryItem[],
): SelfServeLinks | null {
  const link = buildLinkContext(input, directory);
  if (!link) return null;

  const precio =
    typeof input.precioTotal === "number" && input.precioTotal > 0
      ? `\n• Total: $${COP.format(input.precioTotal)} (todo incluido)`
      : "";
  const msg =
    `Mira esta cotización de alquiler de carro:\n` +
    `• Gama: ${link.gama}\n` +
    `• Sede: ${link.sedeName}\n` +
    `• Fechas: ${link.periodo}${precio}\n` +
    `Resérvala aquí: ${link.webUrl}`;

  const shareUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  return { webUrl: link.webUrl, shareUrl };
}
