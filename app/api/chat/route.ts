import { NextResponse } from "next/server";
import {
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai";
import { buildStreamConfig } from "@/lib/chat/agent";
import {
  createConversation,
  appendMessages,
  countRecentMessages,
  type PersistedMessage,
} from "@/lib/chat/persistence";

// Public, anonymous chatbot endpoint (V1). Quoting + FAQ only — no reservation
// side effects — so it follows the public-read pattern of /api/locations: no
// API key, wildcard CORS, abuse bounded by the Vercel WAF plus a soft
// per-conversation cap in Supabase. nodejs runtime: uses the admin Supabase
// client and the in-process quote services; AI SDK edge runtime is unverified.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "x-conversation-id",
} as const;

// Soft anti-abuse: per conversation, cap messages within a rolling window. The
// hard IP-level limit is the Vercel WAF.
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_MAX_MESSAGES = 40;

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

  // Resolve / open the conversation. A new conversation has no cap check yet.
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
    try {
      conversationId = await createConversation(brand);
    } catch (e) {
      console.error("[chat] createConversation failed", e);
    }
  }

  // Persist the incoming user message before streaming (best-effort).
  const lastUser = messages[messages.length - 1];
  if (conversationId && lastUser?.role === "user") {
    appendMessages(conversationId, [
      { role: "user", content: extractText(lastUser), parts: lastUser.parts },
    ]).catch((e) => console.error("[chat] persist user failed", e));
  }

  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(messages);
  } catch {
    return jsonError("Mensajes con formato inválido", 400);
  }

  const result = streamText(await buildStreamConfig(brand, modelMessages));

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
