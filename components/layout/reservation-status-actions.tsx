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

interface ReservationStatusActionsProps {
  reservationId: string;
  currentStatus: ReservationStatus;
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

const DANGEROUS_STATUSES: ReservationStatus[] = ["cancelado"];

export function ReservationStatusActions({
  reservationId,
  currentStatus,
}: ReservationStatusActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const validTargets = VALID_TRANSITIONS[currentStatus] ?? [];

  async function handleTransition(newStatus: ReservationStatus) {
    if (DANGEROUS_STATUSES.includes(newStatus)) {
      const confirmed = window.confirm(
        `¿Estás seguro de cambiar el estado a "${STATUS_LABELS[newStatus]}"? Esta acción no se puede deshacer.`
      );
      if (!confirmed) return;
    }

    setError(null);
    startTransition(async () => {
      const result = await updateReservationStatus(reservationId, newStatus);
      if (result.error) {
        setError(result.error);
      } else {
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
              variant={DANGEROUS_STATUSES.includes(target) ? "destructive" : "outline"}
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
