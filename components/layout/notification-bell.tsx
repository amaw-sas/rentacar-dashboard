"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bell, CheckCheck, ExternalLink, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { OperatorNotification } from "@/lib/schemas/operator-notification";
import {
  markAllRead,
  resolveNotification,
  resendOperatorNotification,
} from "@/lib/actions/operator-notifications";

// Operator notification center (#215). Bell + unread badge in the dashboard header,
// visible in every view (SCEN-006). The popover lists persisted alerts (SCEN-005:
// not ephemeral toasts) with a link to the affected reservation and the resend /
// resolve actions. Data comes from the server layout; actions revalidate the layout
// so the badge refreshes.

/** "hace 3 h" / "hace 2 d" — light relative time, computed client-side. Floors
 *  each bucket so 90 min reads "hace 1 h", not "hace 2 h". */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

export function NotificationBell({
  items,
  unreadCount,
}: {
  items: OperatorNotification[];
  /** `null` = the unread read failed; show a degraded state, not "all clear". */
  unreadCount: number | null;
}) {
  const unavailable = unreadCount === null;
  const count = unreadCount ?? 0;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function runAction(
    fn: () => Promise<{ error?: string }>,
    successMsg: string,
  ) {
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(successMsg);
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unavailable
              ? "Notificaciones: no se pudieron cargar"
              : count > 0
                ? `Notificaciones: ${count} sin leer`
                : "Notificaciones"
          }
        >
          <Bell className="size-5" aria-hidden />
          {unavailable ? (
            <span
              className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-background"
              data-testid="notification-unavailable"
              aria-hidden
            />
          ) : (
            count > 0 && (
              <Badge
                variant="destructive"
                className="absolute -right-1 -top-1 h-5 min-w-5 justify-center rounded-full px-1 text-xs tabular-nums"
                data-testid="notification-badge"
              >
                {count > 99 ? "99+" : count}
              </Badge>
            )
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">Notificaciones</span>
          {count > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={pending}
              onClick={() =>
                runAction(markAllRead, "Marcadas como leídas")
              }
            >
              <CheckCheck className="size-3.5" aria-hidden />
              Marcar todas como leídas
            </Button>
          )}
        </div>

        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {unavailable
              ? "No se pudieron cargar las notificaciones"
              : "Sin alertas"}
          </p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {items.map((n) => {
              const isUnread = n.status === "unread";
              const link =
                n.resource_type === "reservation" && n.resource_id
                  ? `/reservations/${n.resource_id}`
                  : null;
              return (
                <li
                  key={n.id}
                  className={
                    isUnread ? "bg-destructive/5 px-4 py-3" : "px-4 py-3"
                  }
                >
                  <div className="flex items-start gap-2">
                    <TriangleAlert
                      className="mt-0.5 size-4 shrink-0 text-destructive"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium leading-snug">
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-xs text-muted-foreground">
                          {n.body}
                        </p>
                      )}
                      <div className="flex items-center gap-3 pt-1 text-xs">
                        <span className="text-muted-foreground">
                          {relativeTime(n.created_at)}
                        </span>
                        {link && (
                          <Link
                            href={link}
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                            onClick={() => setOpen(false)}
                          >
                            <ExternalLink className="size-3" aria-hidden />
                            Ver reserva
                          </Link>
                        )}
                      </div>
                      {isUnread && (
                        <div className="flex items-center gap-2 pt-2">
                          {n.action === "resend" && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 text-xs"
                              disabled={pending}
                              onClick={() =>
                                runAction(
                                  () => resendOperatorNotification(n.id),
                                  "Notificación reenviada",
                                )
                              }
                            >
                              <RefreshCw className="size-3.5" aria-hidden />
                              Reenviar
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={pending}
                            onClick={() =>
                              runAction(
                                () => resolveNotification(n.id),
                                "Marcada como resuelta",
                              )
                            }
                          >
                            Marcar resuelta
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
