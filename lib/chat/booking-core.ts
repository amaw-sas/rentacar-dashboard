import { getFranchiseBranding } from "@/lib/constants/franchises";
import {
  validateCustomerData,
  normalizeIdentification,
  type CustomerData,
} from "@/lib/chat/customer-validation";
import { runCrearReserva } from "@/lib/chat/reserva-tool";
import { buildFallbackLinks } from "@/lib/chat/reserva-link";
import { getLocationDirectory } from "@/lib/api/location-directory";
import {
  recordToolEvent,
  countSuccessfulBookingsForConversation,
  countSuccessfulBookingsForIp,
} from "@/lib/chat/tool-events";

/**
 * Shared booking core (Rediseño híbrido · Etapa 3). The SINGLE source of truth for
 * the reservation side effect: gate → validate → rate caps → provider call →
 * telemetry → fallback links. Both callers reuse it so the gate, caps and
 * fail-open/fallback semantics never drift:
 *   - the LLM tool `crear_reserva` (lib/chat/agent.ts), which resolves the quote
 *     from history (staleness check) before calling here, and
 *   - the deterministic orchestrator (lib/chat/orchestrator), which resolves the
 *     quote from its server-side `lastQuote` table.
 *
 * The caller passes the ALREADY-RESOLVED `quote` blob — category→quote resolution
 * (and any staleness policy) is the caller's job, kept out of this module so each
 * path keeps its own resolution rule.
 */

export interface BookingContext {
  conversationId?: string | null;
  ipHash?: string | null;
}

/** Pre-filled fallback links handed over when a booking can't be created in chat. */
export interface BookingFallbackLinks {
  webUrl: string;
  whatsappUrl: string;
}

export type BookingOutcome =
  | { kind: "ok"; data: unknown }
  | { kind: "disabled"; website: string }
  // Customer data failed format validation → re-ask, NO fallback links.
  | { kind: "invalid"; message: string }
  // Rate cap hit → hand over the fallback links (lead not lost).
  | { kind: "blocked"; message: string; links: BookingFallbackLinks | null }
  // Provider failed for real → hand over the fallback links.
  | { kind: "failed"; message: string; links: BookingFallbackLinks | null };

/** Positive integer env with a fallback (shared by the booking rate caps). */
export function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Trim an error message into the short `error_code` column (telemetry only). */
export function toErrorCode(message: string): string {
  return message.slice(0, 200);
}

/**
 * The booking gate (single definition): off by default so the public endpoint
 * never books until enabled per brand. Exposed so a caller can short-circuit to
 * its own "finish on the site" message BEFORE resolving a quote — `executeBooking`
 * re-checks it authoritatively regardless.
 */
export function reservationsEnabled(): boolean {
  return process.env.CHAT_RESERVATIONS_ENABLED === "true";
}

/**
 * Issue #199 (Fase 0): when on, the chat stamps `attribution_channel = 'chat-bot'`
 * on every reservation it creates, making bot bookings distinguishable in the
 * dashboard. Off by default so it never changes the recorded channel until
 * enabled per environment (matches the issue's "everything behind a flag").
 */
function attributionBotEnabled(): boolean {
  return process.env.CHAT_ATTRIBUTION_BOT === "true";
}

/**
 * Build the pre-filled fallback links (finish-on-web + advisor WhatsApp) for a
 * booking that couldn't be created in chat — provider failure OR a rate cap, so
 * the lead is never lost. Best-effort: any failure resolving them returns null.
 */
async function buildBookingFallback(params: {
  brand: string;
  quote: string;
  gamaDescripcion?: string;
  customer: CustomerData;
}): Promise<BookingFallbackLinks | null> {
  try {
    const directory = await getLocationDirectory();
    return buildFallbackLinks(
      {
        brand: params.brand,
        quote: params.quote,
        gamaDescripcion: params.gamaDescripcion,
        customer: {
          fullname: params.customer.fullname,
          identification_type: params.customer.identification_type,
          identification: params.customer.identification,
          email: params.customer.email,
          phone: params.customer.phone,
        },
      },
      directory,
    );
  } catch (e) {
    console.error("[chat] buildFallbackLinks failed", e);
    return null;
  }
}

/**
 * Create the reservation, enforcing the same gate, validation, rate caps and
 * telemetry for every caller. The `quote` is already resolved by the caller.
 *
 * Flow: gate (CHAT_RESERVATIONS_ENABLED) → customer-data validation → per-
 * conversation cap → per-IP cap → provider call + fire-and-forget telemetry. Caps
 * fail open (a DB hiccup never blocks a genuine booking). On a cap hit or a
 * provider failure we build the fallback links so the lead isn't lost.
 */
export async function executeBooking(params: {
  brand: string;
  quote: string;
  customer: CustomerData;
  gamaDescripcion?: string;
  ctx?: BookingContext;
}): Promise<BookingOutcome> {
  const { brand, quote, customer, gamaDescripcion, ctx } = params;

  // Gated: off by default so the public endpoint never books until enabled per
  // brand. Degrades to "finish on the site".
  if (!reservationsEnabled()) {
    return { kind: "disabled", website: getFranchiseBranding(brand).website };
  }

  // Hard-validate the customer data FORMAT so a public endpoint can't be fed junk
  // to create fake bookings. Relayed friendly + re-asked; not a provider failure,
  // so no tool event is recorded.
  const valid = validateCustomerData(customer);
  if (!valid.ok) return { kind: "invalid", message: valid.error };

  // Anti-abuse rate caps (only when the caller threaded context). Counts PRIOR
  // successful bookings; both fail open. On a cap hit, hand over the fallback so
  // the lead isn't lost.
  if (ctx?.conversationId) {
    const n = await countSuccessfulBookingsForConversation(ctx.conversationId);
    if (n >= envInt("CHAT_MAX_BOOKINGS_PER_CONVERSATION", 3)) {
      const links = await buildBookingFallback({
        brand,
        quote,
        gamaDescripcion,
        customer,
      });
      return {
        kind: "blocked",
        message:
          "Ya registré varias reservas en esta conversación; abajo te dejo las opciones para terminar.",
        links,
      };
    }
  }
  if (ctx?.ipHash) {
    const sinceISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const n = await countSuccessfulBookingsForIp(ctx.ipHash, sinceISO);
    if (n >= envInt("CHAT_MAX_BOOKINGS_PER_IP_PER_DAY", 5)) {
      const links = await buildBookingFallback({
        brand,
        quote,
        gamaDescripcion,
        customer,
      });
      return {
        kind: "blocked",
        message:
          "Por hoy alcanzaste el máximo de reservas; abajo te dejo las opciones para terminar.",
        links,
      };
    }
  }

  const start = Date.now();
  const result = await runCrearReserva({
    quote,
    fullname: customer.fullname,
    identification_type: customer.identification_type,
    identification: normalizeIdentification(
      customer.identification_type,
      customer.identification,
    ),
    email: customer.email,
    phone: customer.phone,
    franchise: brand,
    attribution_channel: attributionBotEnabled() ? "chat-bot" : undefined,
  });
  // Telemetry for the real provider attempt (drives the dashboard health alert AND
  // the booking caps above). Fire-and-forget — never await, never block the turn.
  void recordToolEvent({
    tool: "crear_reserva",
    ok: result.ok,
    errorCode: result.ok ? null : toErrorCode(result.message),
    brand,
    conversationId: ctx?.conversationId ?? null,
    ipHash: ctx?.ipHash ?? null,
    latencyMs: Date.now() - start,
  });

  if (result.ok) return { kind: "ok", data: result.data };

  // Booking failed for real (provider down / no availability). Don't loop — hand
  // the customer the pre-filled fallback links so the lead isn't lost.
  const links = await buildBookingFallback({
    brand,
    quote,
    gamaDescripcion,
    customer,
  });
  return { kind: "failed", message: result.message, links };
}
