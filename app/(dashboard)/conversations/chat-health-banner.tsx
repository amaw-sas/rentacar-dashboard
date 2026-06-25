import { TriangleAlert } from "lucide-react";
import type { ToolHealth } from "@/lib/queries/chat-tool-health";

// Visible health alert for the chat tools (Inc. 4 "Escudo"). Renders only when a
// tool's failure rate over the trailing 24h is spiking — otherwise nothing. This
// is how the operator finds out cotizar/crear_reserva are failing without waiting
// for a customer complaint.

const TOOL_LABEL: Record<string, string> = {
  cotizar: "la cotización",
  crear_reserva: "la creación de reservas",
};

export function ChatHealthBanner({ health }: { health: ToolHealth[] }) {
  if (health.length === 0) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
    >
      <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">
          El chat está fallando seguido en las últimas 24 horas
        </p>
        <ul className="space-y-0.5 text-destructive/90">
          {health.map((h) => (
            <li key={h.tool}>
              {TOOL_LABEL[h.tool] ?? h.tool}: {Math.round(h.failRate * 100)}% de
              fallos ({h.failed} de {h.total}). Revisa el proveedor (Localiza) y
              los logs.
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
