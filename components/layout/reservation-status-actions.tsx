"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  VALID_TRANSITIONS,
  STATUS_LABELS,
  type ReservationStatus,
} from "@/lib/schemas/reservation";
import { updateReservationStatus } from "@/lib/actions/reservations";
import { toast } from "sonner";

interface ReservationStatusActionsProps {
  reservationId: string;
  currentStatus: ReservationStatus;
  // When the parent form has unsaved edits, a status change would fire its
  // notification from stale DB data (issue #90). The detail page omits this
  // prop (read-only, nothing to lose) → default false preserves behavior.
  hasUnsavedChanges?: boolean;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  nueva: "outline",
  pendiente: "secondary",
  reservado: "default",
  sin_disponibilidad: "secondary",
  utilizado: "default",
  no_contactado: "secondary",
  baneado: "destructive",
  no_recogido: "destructive",
  pendiente_pago: "secondary",
  pendiente_modificar: "secondary",
  cancelado: "destructive",
  indeterminado: "outline",
  mensualidad: "default",
};

const DANGEROUS_TARGETS: ReservationStatus[] = ["cancelado", "baneado"];
// Reactivating a reservation that has already been closed is unusual enough to warrant a prompt.
const CONSOLIDATED_SOURCES: ReservationStatus[] = [
  "cancelado",
  "utilizado",
  "no_recogido",
  "baneado",
];

export function ReservationStatusActions({
  reservationId,
  currentStatus,
  hasUnsavedChanges = false,
}: ReservationStatusActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const validTargets = VALID_TRANSITIONS[currentStatus] ?? [];

  async function handleTransition(newStatus: ReservationStatus) {
    // Guard first: with unsaved form/customer edits, the notification would
    // render from stale DB data (issue #90). Block before any confirm or
    // dispatch — the operator must save so the notification matches the screen.
    if (hasUnsavedChanges) {
      const message =
        "Tienes cambios sin guardar en el formulario. Guárdalos antes de cambiar el estado para que la notificación use los datos correctos.";
      setError(message);
      toast.error("Cambios sin guardar", {
        description: "Guarda el formulario antes de cambiar el estado.",
      });
      return;
    }

    if (DANGEROUS_TARGETS.includes(newStatus)) {
      const confirmed = window.confirm(
        `¿Cambiar el estado a "${STATUS_LABELS[newStatus]}"? Esta acción es delicada.`
      );
      if (!confirmed) return;
    } else if (CONSOLIDATED_SOURCES.includes(currentStatus)) {
      const confirmed = window.confirm(
        `Estás reactivando una reserva en estado "${STATUS_LABELS[currentStatus]}". ¿Continuar y cambiarla a "${STATUS_LABELS[newStatus]}"?`
      );
      if (!confirmed) return;
    }

    setError(null);
    startTransition(async () => {
      const result = await updateReservationStatus(reservationId, newStatus);
      if (result.error) {
        setError(result.error);
        toast.error("Error al cambiar estado", { description: result.error });
      } else {
        toast.success("Estado actualizado", {
          description: `Reserva cambiada a ${STATUS_LABELS[newStatus]}`,
        });
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Estado actual:</span>
        <Badge variant={STATUS_VARIANT[currentStatus] ?? "secondary"}>
          {STATUS_LABELS[currentStatus]}
        </Badge>
      </div>

      {validTargets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {validTargets.map((target) => (
            <Button
              key={target}
              size="sm"
              variant={DANGEROUS_TARGETS.includes(target) ? "destructive" : "outline"}
              disabled={isPending}
              onClick={() => handleTransition(target)}
            >
              {STATUS_LABELS[target]}
            </Button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
