import { Badge } from "@/components/ui/badge";

// Defensive renderer for a single AI SDK v6 UIMessage part. The exact shape is
// trusted from the installed `ai` types (text/reasoning/step-start/tool-<name>/
// dynamic-tool), but this NEVER throws on a malformed part: anything unrecognized
// degrades to the message's plain `content` (handled by the caller) or is
// skipped. Keying tool cards off the `tool-`/`dynamic-tool` prefix keeps the
// renderer working if a new tool is added or a part is partially populated.

type AnyPart = Record<string, unknown>;

function isToolPart(type: string): boolean {
  return type.startsWith("tool-") || type === "dynamic-tool";
}

function toolName(part: AnyPart, type: string): string {
  if (type === "dynamic-tool" && typeof part.toolName === "string")
    return part.toolName;
  return type.startsWith("tool-") ? type.slice("tool-".length) : type;
}

function JsonBlock({ value }: { value: unknown }) {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-muted/60 p-2 text-xs whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}

function ToolCard({ part, type }: { part: AnyPart; type: string }) {
  const name = toolName(part, type);
  const state = typeof part.state === "string" ? part.state : undefined;
  const errorText =
    typeof part.errorText === "string" ? part.errorText : undefined;
  const hasInput = "input" in part && part.input !== undefined;
  const hasOutput = "output" in part && part.output !== undefined;

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 text-sm">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">herramienta</Badge>
        <span className="font-mono font-medium">{name}</span>
        {state && (
          <Badge variant={state === "output-error" ? "destructive" : "outline"}>
            {state}
          </Badge>
        )}
      </div>

      {errorText && (
        <p className="mt-2 text-destructive">{errorText}</p>
      )}

      {hasInput && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground select-none">
            Entrada
          </summary>
          <JsonBlock value={part.input} />
        </details>
      )}

      {hasOutput && (
        <details className="mt-2" open>
          <summary className="cursor-pointer text-xs text-muted-foreground select-none">
            Resultado
          </summary>
          <JsonBlock value={part.output} />
        </details>
      )}
    </div>
  );
}

export function MessagePart({ part }: { part: unknown }) {
  if (!part || typeof part !== "object") return null;
  const p = part as AnyPart;
  const type = typeof p.type === "string" ? p.type : "";

  if (type === "text" || type === "reasoning") {
    const text = typeof p.text === "string" ? p.text : "";
    if (!text) return null;
    return (
      <p
        className={
          type === "reasoning"
            ? "whitespace-pre-wrap text-sm text-muted-foreground italic"
            : "whitespace-pre-wrap text-sm"
        }
      >
        {text}
      </p>
    );
  }

  // step-start and any other structural marker render nothing.
  if (type === "step-start") return null;

  if (isToolPart(type)) return <ToolCard part={p} type={type} />;

  // Unknown part type: show its JSON so nothing is silently lost, but don't crash.
  return <JsonBlock value={p} />;
}
