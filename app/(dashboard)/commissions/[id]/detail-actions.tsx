"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateCommission } from "@/lib/actions/commissions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Commission = {
  id: string;
  payment_status: string;
  invoice_number: string | null;
  invoice_date: string | null;
  payment_date: string | null;
  notes: string | null;
};

export function CommissionDetailActions({
  commission,
}: {
  commission: Commission;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpdate(formData: FormData) {
    setLoading(true);
    setError(null);
    const result = await updateCommission(commission.id, formData);
    if (result.error) {
      setError(result.error);
    } else {
      router.refresh();
    }
    setLoading(false);
  }

  async function handleStatusChange(newStatus: string) {
    setLoading(true);
    setError(null);
    const formData = new FormData();
    formData.set("payment_status", newStatus);
    if (newStatus === "paid") {
      formData.set("payment_date", new Date().toISOString().split("T")[0]);
    }
    const result = await updateCommission(commission.id, formData);
    if (result.error) {
      setError(result.error);
    } else {
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Payment status actions */}
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Estado de pago</h2>

        <div className="flex items-center gap-2">
          {commission.payment_status === "pending" && (
            <Button
              size="sm"
              onClick={() => handleStatusChange("invoiced")}
              disabled={loading}
            >
              Marcar como facturada
            </Button>
          )}
          {commission.payment_status === "invoiced" && (
            <Button
              size="sm"
              onClick={() => handleStatusChange("paid")}
              disabled={loading}
            >
              Marcar como pagada
            </Button>
          )}
          {commission.payment_status === "paid" && (
            <p className="text-sm text-muted-foreground">
              Esta comision ya fue pagada.
            </p>
          )}
        </div>

        <form action={handleUpdate} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="invoice_number">Numero de factura</Label>
            <Input
              id="invoice_number"
              name="invoice_number"
              defaultValue={commission.invoice_number ?? ""}
              placeholder="Ej: FV-001234"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice_date">Fecha de factura</Label>
            <Input
              id="invoice_date"
              name="invoice_date"
              type="date"
              defaultValue={commission.invoice_date ?? ""}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment_date">Fecha de pago</Label>
            <Input
              id="payment_date"
              name="payment_date"
              type="date"
              defaultValue={commission.payment_date ?? ""}
            />
          </div>

          <Button type="submit" variant="outline" size="sm" disabled={loading}>
            Guardar datos factura
          </Button>
        </form>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </Card>

      {/* Notes */}
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Notas</h2>

        <form action={handleUpdate} className="space-y-3">
          <Textarea
            name="notes"
            defaultValue={commission.notes ?? ""}
            placeholder="Agregar notas sobre esta comision..."
            rows={5}
          />
          <Button type="submit" variant="outline" size="sm" disabled={loading}>
            Guardar notas
          </Button>
        </form>
      </Card>
    </div>
  );
}
