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
  // Issue #153: before dispatching a status change, the parent form autosaves
  // any unsaved reservation/customer edits so the notification fires from fresh
  // DB data (inverts the #90 block). Resolving false (save failed/invalid)
  // aborts the dispatch. The detail page omits this prop (read-only, nothing to
  // save) → status dispatches directly, preserving current behavior.
  onBeforeStatusChange?: () => Promise<boolean>;
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
  onBeforeStatusChange,
}: ReservationStatusActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The autosave (onBeforeStatusChange) awaits BEFORE startTransition, so
  // `isPending` is false during the save window. Track it explicitly to disable
  // the buttons and reject re-entrant clicks (issue #153, SCEN-014) — saves can
  // take 20s–2min (#100), and a second click would double-dispatch.
  const [autosaving, setAutosaving] = useState(false);

  const validTargets = VALID_TRANSITIONS[currentStatus] ?? [];

  async function handleTransition(newStatus: ReservationStatus) {
    // Re-entrancy guard: ignore clicks while a dispatch or autosave is in flight.
    if (isPending || autosaving) return;

    // Confirmations first (cheap): a cancelled confirm must abort before any
    // autosave runs (issue #153, SCEN-007 — confirm-before-save invariant).
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

    // Autosave any unsaved form/customer edits before dispatching, so the
    // status-change notification reads fresh DB data (issue #153). Resolving
    // false (validation/server error) aborts — the error is already surfaced by
    // the form. Absent prop (detail page) → dispatch directly. The `autosaving`
    // flag disables the buttons across the await (SCEN-014).
    if (onBeforeStatusChange) {
      setAutosaving(true);
      try {
        const ok = await onBeforeStatusChange();
        if (!ok) return;
      } finally {
        setAutosaving(false);
      }
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
              type="button"
              size="sm"
              variant={DANGEROUS_TARGETS.includes(target) ? "destructive" : "outline"}
              disabled={isPending || autosaving}
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
