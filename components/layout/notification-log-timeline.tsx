"use client";

import { useState } from "react";
import { Mail, MessageSquare, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotificationPreviewDialog } from "./notification-preview-dialog";
import { resendNotification } from "@/lib/actions/notification-logs";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

const TYPE_LABELS: Record<string, string> = {
  reservado_cliente: "Reserva aprobada (cliente)",
  pendiente_cliente: "Reserva pendiente (cliente)",
  sin_disponibilidad_cliente: "Sin disponibilidad (cliente)",
  solicitud_reserva: "Solicitud de reserva (cliente)",
  pendiente_localiza: "Reserva en espera (Localiza)",
  seguro_total_localiza: "Seguro total (Localiza)",
  extras_localiza: "Servicios adicionales (Localiza)",
  whatsapp_reservado: "WhatsApp reserva confirmada",
  whatsapp_pendiente: "WhatsApp reserva pendiente",
  whatsapp_sin_disponibilidad: "WhatsApp sin disponibilidad",
  whatsapp_mensualidad: "WhatsApp mensualidad",
  mensualidad_localiza: "Reserva mensual (Localiza)",
  mensualidad_localiza_reenvio: "Reserva mensual (Localiza) - reenvío",
  mensualidad_cliente: "Reserva mensual (cliente)",
  mensualidad_cliente_reenvio: "Reserva mensual (cliente) - reenvío",
};

interface NotificationLog {
  id: string;
  channel: string;
  notification_type: string;
  recipient: string;
  subject: string | null;
  html_content: string | null;
  status: string;
  error_message: string | null;
  sent_at: string;
}

interface NotificationLogTimelineProps {
  logs: NotificationLog[];
}

export function NotificationLogTimeline({ logs }: NotificationLogTimelineProps) {
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  function openPreview(html: string, subject: string) {
    setPreviewHtml(html);
    setPreviewSubject(subject);
    setPreviewOpen(true);
  }

  async function handleResend(logId: string) {
    setResendingId(logId);
    const result = await resendNotification(logId);
    setResendingId(null);
    if (result.error) {
      toast.error("Error al reenviar", { description: result.error });
    } else {
      toast.success("Notificación reenviada");
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Historial de Notificaciones</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No se han enviado notificaciones
            </p>
          ) : (
            <div className="space-y-3">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 rounded-lg border p-3"
                >
                  <div className="mt-0.5 rounded-full bg-muted p-2">
                    {log.channel === "email" ? (
                      <Mail className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {TYPE_LABELS[log.notification_type] || log.notification_type}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {log.recipient}
                    </p>
                    {log.error_message && (
                      <p className="text-xs text-destructive mt-1">
                        {log.error_message}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant={log.status === "sent" ? "default" : "destructive"}
                    >
                      {log.status === "sent" ? "Enviado" : "Fallido"}
                    </Badge>

                    {log.channel === "email" && log.html_content && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          openPreview(log.html_content!, log.subject ?? "Email")
                        }
                      >
                        Ver
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleResend(log.id)}
                      disabled={resendingId === log.id}
                    >
                      <RotateCw className={`h-3 w-3 mr-1 ${resendingId === log.id ? "animate-spin" : ""}`} />
                      {resendingId === log.id ? "..." : "Reenviar"}
                    </Button>
                  </div>

                  <span className="text-xs text-muted-foreground shrink-0 mt-0.5">
                    {formatDistanceToNow(new Date(log.sent_at), {
                      addSuffix: true,
                      locale: es,
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <NotificationPreviewDialog
        html={previewHtml}
        subject={previewSubject}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
}
