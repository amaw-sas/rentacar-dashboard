import { NextResponse } from "next/server";
import {
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai";
import { buildStreamConfig, extractLatestQuotes } from "@/lib/chat/agent";
import {
  createConversation,
  appendMessages,
  countRecentMessages,
  countConversationsByIp,
  loadMessages,
  type PersistedMessage,
} from "@/lib/chat/persistence";
import { hashClientIp } from "@/lib/chat/client-ip";

// Public, anonymous chatbot endpoint (V1). Quoting + FAQ only — no reservation
// side effects — so it follows the public-read pattern of /api/locations: no
// API key, wildcard CORS, abuse bounded by the Vercel WAF plus a soft
// per-conversation cap in Supabase. nodejs runtime: uses the admin Supabase
// client and the in-process quote services; AI SDK edge runtime is unverified.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 60s (not 30): a booking turn runs the LLM, streams the opaque quote as the
// crear_reserva input, and then calls the Localiza proxy — which alone consumes
// the ~30s the website's /api/reservations route budgets for booking. The chat
// adds the model + tool overhead on top, so it needs the extra headroom.
export const maxDuration = 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "x-conversation-id",
} as const;

// Soft anti-abuse: per conversation, cap messages within a rolling window.
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_MAX_MESSAGES = 40;

// Per-IP cap on NEW conversations within the window. Closes the bypass where an
// abuser dodges the per-conversation cap by opening a fresh conversation each time
// (Inc. 4). Overridable per environment. Skipped when there's no IP hash (no salt).
function maxConversationsPerIp(): number {
  const n = Number(process.env.CHAT_MAX_CONVERSATIONS_PER_IP_PER_HOUR);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 8;
}

// Input-size caps: bound the request so a single call can't stuff the context
// (cost abuse) or smuggle a huge prompt-injection payload (Inc. 4, Pieza 2).
const MAX_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 16000;

interface ChatBody {
  messages: UIMessage[];
  conversationId?: string;
  brand: string;
}

/** Concatenate the text parts of a UIMessage into a plain string. */
function extractText(message: UIMessage): string {
  if (!Array.isArray(message.parts)) return "";
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: CORS_HEADERS });
}

/**
 * Adapt a persisted row to the UIMessage shape `convertToModelMessages` expects
 * (it accepts messages without an `id`). `parts` is reused VERBATIM when present
 * so tool calls/results round-trip; legacy rows (null parts, pre history-reload)
 * fall back to a single text part so old conversations still load. Tool-role rows
 * are never persisted today — drop them defensively (UIMessage has no tool role).
 */
function toUIMessage(row: PersistedMessage): Omit<UIMessage, "id"> | null {
  if (row.role !== "user" && row.role !== "assistant" && row.role !== "system") {
    return null;
  }
  const parts = Array.isArray(row.parts)
    ? (row.parts as UIMessage["parts"])
    : ([{ type: "text", text: row.content ?? "" }] as UIMessage["parts"]);
  return { role: row.role, parts };
}

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    console.error("[chat] Missing OPENAI_API_KEY");
    return jsonError("Configuración del servidor incompleta", 500);
  }

  let body: ChatBody;
  try {
    body = await request.json();
  } catch {
    return jsonError("Cuerpo de solicitud inválido", 400);
  }

  const { messages, brand } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError("Campo 'messages' requerido y no vacío", 400);
  }
  if (!brand || typeof brand !== "string") {
    return jsonError("Campo 'brand' requerido", 400);
  }

  // Input-size caps (anti-stuffing / anti-injection). Reject oversized payloads
  // before any model or DB work.
  if (messages.length > MAX_MESSAGES) {
    return jsonError("Demasiados mensajes en la solicitud", 400);
  }
  let totalChars = 0;
  for (const m of messages) {
    const len = extractText(m).length;
    if (len > MAX_MESSAGE_CHARS) {
      return jsonError("Un mensaje supera el tamaño máximo permitido", 400);
    }
    totalChars += len;
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    return jsonError("La conversación supera el tamaño máximo permitido", 400);
  }

  // Salted hash of the client IP (never the raw IP) for the per-IP rate limits.
  // Null when no salt/IP — those limits then degrade off (the per-conversation
  // cap and the Vercel WAF still apply).
  const ipHash = hashClientIp(request.headers);

  // Resolve / open the conversation.
  let conversationId = body.conversationId;
  if (conversationId) {
    try {
      const recent = await countRecentMessages(
        conversationId,
        new Date(Date.now() - RATE_WINDOW_MS).toISOString(),
      );
      if (recent >= RATE_MAX_MESSAGES) {
        return jsonError(
          "Has alcanzado el límite de mensajes por ahora. Intenta más tarde o escríbenos por WhatsApp.",
          429,
        );
      }
    } catch (e) {
      console.error("[chat] rate check failed", e);
    }
  } else {
    // Per-IP cap on NEW conversations — closes the "fresh conversation" bypass.
    // Fail open on a count error so a DB hiccup never blocks legitimate users.
    if (ipHash) {
      try {
        const recentConvos = await countConversationsByIp(
          ipHash,
          new Date(Date.now() - RATE_WINDOW_MS).toISOString(),
        );
        if (recentConvos >= maxConversationsPerIp()) {
          return jsonError(
            "Has iniciado demasiadas conversaciones por ahora. Intenta más tarde o escríbenos por WhatsApp.",
            429,
          );
        }
      } catch (e) {
        console.error("[chat] per-IP conversation cap check failed", e);
      }
    }
    try {
      conversationId = await createConversation(brand, null, ipHash);
    } catch (e) {
      console.error("[chat] createConversation failed", e);
    }
  }

  const lastUser = messages[messages.length - 1];

  // Reload prior turns from Supabase (the server is the source of truth) so tool
  // context — the opaque `cotizar` quote among it — survives across turns; the
  // widget only resends plain text. READ BEFORE persisting the incoming user
  // message below, so history never contains the current turn regardless of that
  // fire-and-forget write. Any load failure degrades to the request messages.
  // Gate on the REQUEST id, not the resolved one: a just-created conversation
  // has no prior turns, so skip the empty round-trip on the first message.
  let history: PersistedMessage[] | null = null;
  if (body.conversationId) {
    try {
      history = await loadMessages(body.conversationId);
    } catch (e) {
      console.error("[chat] loadMessages failed", e);
    }
  }

  // Persist the incoming user message before streaming (best-effort).
  if (conversationId && lastUser?.role === "user") {
    appendMessages(conversationId, [
      { role: "user", content: extractText(lastUser), parts: lastUser.parts },
    ]).catch((e) => console.error("[chat] persist user failed", e));
  }

  // Model context = reloaded history + the current incoming user message. New
  // conversation or load failure → fall back to the request body (prior behavior).
  const uiContext: Array<Omit<UIMessage, "id">> =
    history && history.length > 0
      ? [...history.flatMap((m) => toUIMessage(m) ?? []), lastUser]
      : messages;

  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(uiContext, {
      ignoreIncompleteToolCalls: true,
    });
  } catch {
    return jsonError("Mensajes con formato inválido", 400);
  }

  // Resolve the latest cotizar quotes server-side so the booking tool injects the
  // quote by gama code — the LLM corrupts the opaque blob when echoing it back.
  const latestQuotes = history ? extractLatestQuotes(history) : undefined;

  const result = streamText(
    await buildStreamConfig(brand, modelMessages, latestQuotes, {
      conversationId,
      ipHash,
    }),
  );

  // Drain even if the client disconnects, so onFinish persists the reply.
  result.consumeStream();

  const response = result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: ({ messages: finalMessages }) => {
      if (!conversationId) return;
      const assistant = finalMessages[finalMessages.length - 1];
      if (!assistant || assistant.role !== "assistant") return;
      const row: PersistedMessage = {
        role: "assistant",
        content: extractText(assistant),
        parts: assistant.parts,
      };
      appendMessages(conversationId, [row]).catch((e) =>
        console.error("[chat] persist assistant failed", e),
      );
    },
  });

  // Layer CORS + the conversation id onto the streamed response so the widget
  // (cross-origin) can keep using the same conversation across turns.
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  if (conversationId) headers.set("x-conversation-id", conversationId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
