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

const COP = new Intl.NumberFormat("es-CO");

/** Orchestrator quote table (`data-quoteTable`) — render the gamas + prices, not raw JSON. */
function QuoteTableCard({ data }: { data: AnyPart }) {
  const filas = Array.isArray(data.filas) ? (data.filas as AnyPart[]) : [];
  const dias = typeof data.dias === "number" ? data.dias : undefined;
  const sede = typeof data.sede === "string" ? data.sede : undefined;
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 text-sm">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">cotización</Badge>
        {dias != null && (
          <span className="text-xs text-muted-foreground">{dias} día(s)</span>
        )}
        {sede && <span className="text-xs text-muted-foreground">· {sede}</span>}
      </div>
      <table className="mt-2 w-full text-xs">
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-t border-border/50">
              <td className="py-1 pr-2 font-mono font-medium">
                {String(f.categoria ?? "")}
              </td>
              <td className="py-1 pr-2 text-muted-foreground">
                {String(f.descripcion ?? "")}
              </td>
              <td className="py-1 text-right tabular-nums">
                ${COP.format(Number(f.precioTotal ?? 0))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Orchestrator vehicle cards (`data-gamaCards`) — gama + model thumbnails/names. */
function GamaCardsCard({ data }: { data: AnyPart }) {
  const gama = typeof data.gama === "string" ? data.gama : "";
  const modelos = Array.isArray(data.modelos) ? (data.modelos as AnyPart[]) : [];
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 text-sm">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">modelos</Badge>
        <span className="font-medium">Gama {gama}</span>
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-1 text-xs">
        {modelos.map((m, i) => (
          <li key={i} className="flex items-center gap-2">
            {typeof m.imagen === "string" && m.imagen ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.imagen}
                alt={String(m.nombre ?? "")}
                className="h-8 w-12 rounded object-cover"
              />
            ) : null}
            <span>{String(m.nombre ?? "")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Orchestrator fallback/on-demand links (`data-buttons`) — web and/or advisor WhatsApp. */
function ButtonsCard({ data }: { data: AnyPart }) {
  const web = typeof data.web === "string" && data.web ? data.web : undefined;
  const whatsapp =
    typeof data.whatsapp === "string" && data.whatsapp ? data.whatsapp : undefined;
  if (!web && !whatsapp) return null;
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 text-sm">
      <Badge variant="secondary">botones</Badge>
      <div className="mt-2 flex flex-col gap-1 text-xs">
        {web && (
          <a
            href={web}
            target="_blank"
            rel="noreferrer"
            className="break-all text-primary underline"
          >
            Reservar en la web
          </a>
        )}
        {whatsapp && (
          <a
            href={whatsapp}
            target="_blank"
            rel="noreferrer"
            className="break-all text-primary underline"
          >
            Escribir a un asesor
          </a>
        )}
      </div>
    </div>
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

  // Orchestrator data parts (code-emitted) — render readable, not raw JSON.
  const data =
    p.data && typeof p.data === "object" ? (p.data as AnyPart) : undefined;
  if (type === "data-quoteTable" && data) return <QuoteTableCard data={data} />;
  if (type === "data-gamaCards" && data) return <GamaCardsCard data={data} />;
  if (type === "data-buttons" && data) return <ButtonsCard data={data} />;

  if (isToolPart(type)) return <ToolCard part={p} type={type} />;

  // Unknown part type: show its JSON so nothing is silently lost, but don't crash.
  return <JsonBlock value={p} />;
}
