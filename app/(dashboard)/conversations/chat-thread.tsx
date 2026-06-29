import { cn } from "@/lib/utils";
import type { ConversationMessage } from "@/lib/queries/chat-conversations";
import { MessagePart } from "./message-part";

const ROLE_LABEL: Record<string, string> = {
  user: "Cliente",
  assistant: "Bot",
  tool: "Herramienta",
  system: "Sistema",
};

const timeFormatter = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: "America/Bogota",
});

function formatTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : timeFormatter.format(d);
}

// Renders one message: its parts via the defensive MessagePart renderer, falling
// back to the plain `content` column when parts is absent or not an array (the
// safety net the column exists for).
function MessageBubble({ message }: { message: ConversationMessage }) {
  const isUser = message.role === "user";
  // 'system' rows are turn-error markers (lib/chat/turn-error.ts) — render them as
  // an error so a failed turn jumps out when reading the thread.
  const isError = message.role === "system";
  const parts = Array.isArray(message.parts) ? message.parts : null;
  const renderedParts = parts
    ? parts.map((part, i) => <MessagePart key={i} part={part} />)
    : null;

  // If parts is missing/empty, or every part rendered to null, show content.
  const hasParts = parts && parts.length > 0;

  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        isUser ? "items-end" : "items-start",
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">
          {ROLE_LABEL[message.role] ?? message.role}
        </span>
        <span>{formatTime(message.created_at)}</span>
      </div>
      <div
        className={cn(
          "max-w-[80%] space-y-2 rounded-2xl border px-4 py-3",
          isError
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : isUser
              ? "border-primary/30 bg-primary/5"
              : "border-border bg-card",
        )}
      >
        {hasParts ? (
          renderedParts
        ) : message.content ? (
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            (mensaje sin contenido)
          </p>
        )}
      </div>
    </div>
  );
}

export function ChatThread({ messages }: { messages: ConversationMessage[] }) {
  if (messages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Esta conversación no tiene mensajes.
      </p>
    );
  }
  // Kill-proof failed-turn signal: the user message is persisted BEFORE the reply
  // streams, so a turn that crashed/timed out (even a hard function kill that no
  // try/catch can catch) leaves the last message as the customer's with no answer.
  // This catches what recordTurnError can't (e.g. a 90s timeout), without any extra
  // write — it's derived from the messages already on screen.
  const last = messages[messages.length - 1];
  const botDidNotReply = last.role === "user";
  return (
    <div className="space-y-4">
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      {botDidNotReply && (
        <p className="text-sm text-destructive">
          ⚠️ El bot no respondió a este último mensaje (el turno falló: se cayó o
          expiró). Revisa los Runtime Logs de Vercel para el detalle.
        </p>
      )}
    </div>
  );
}
