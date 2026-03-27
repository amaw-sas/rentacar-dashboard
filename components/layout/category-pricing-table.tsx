"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryPricingForm } from "@/components/forms/category-pricing-form";

interface CategoryPricingRecord {
  id: string;
  category_id: string;
  total_coverage_unit_charge: number;
  monthly_1k_price: number | null;
  monthly_2k_price: number | null;
  monthly_3k_price: number | null;
  monthly_insurance_price: number | null;
  monthly_one_day_price: number | null;
  valid_from: string;
  valid_until: string | null;
  status: string;
}

interface CategoryPricingTableProps {
  categoryId: string;
  pricing: CategoryPricingRecord[];
}

function formatCOP(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatVigencia(from: string, until: string | null): string {
  const fromDate = new Date(from + "T00:00:00").toLocaleDateString("es-CO");
  if (!until) return `${fromDate} — Indefinido`;
  const untilDate = new Date(until + "T00:00:00").toLocaleDateString("es-CO");
  return `${fromDate} — ${untilDate}`;
}

export function CategoryPricingTable({
  categoryId,
  pricing,
}: CategoryPricingTableProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingRecord = editingId
    ? pricing.find((p) => p.id === editingId)
    : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Precios</CardTitle>
        {!showForm && !editingId && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            Agregar Precios
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {showForm && (
          <CategoryPricingForm
            categoryId={categoryId}
            onCancel={() => setShowForm(false)}
          />
        )}

        {editingId && editingRecord && (
          <CategoryPricingForm
            categoryId={categoryId}
            id={editingId}
            defaultValues={{
              category_id: editingRecord.category_id,
              total_coverage_unit_charge: editingRecord.total_coverage_unit_charge,
              monthly_1k_price: editingRecord.monthly_1k_price,
              monthly_2k_price: editingRecord.monthly_2k_price,
              monthly_3k_price: editingRecord.monthly_3k_price,
              monthly_insurance_price: editingRecord.monthly_insurance_price,
              monthly_one_day_price: editingRecord.monthly_one_day_price,
              valid_from: editingRecord.valid_from,
              valid_until: editingRecord.valid_until,
              status: editingRecord.status as "active" | "inactive",
            }}
            onCancel={() => setEditingId(null)}
          />
        )}

        {pricing.length === 0 && !showForm ? (
          <p className="text-sm text-muted-foreground">
            No hay precios registrados para esta categoría.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full caption-bottom text-sm">
              <thead className="border-b border-border bg-muted/50">
                <tr>
                  <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                    Vigencia
                  </th>
                  <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                    Seguro Total/día
                  </th>
                  <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                    Mensual 1K
                  </th>
                  <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                    Mensual 2K
                  </th>
                  <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                    Mensual 3K
                  </th>
                  <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                    Estado
                  </th>
                  <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {pricing.map((record) => (
                  <tr
                    key={record.id}
                    className="border-b border-border transition-colors hover:bg-muted/50"
                  >
                    <td className="px-3 py-2 align-middle">
                      {formatVigencia(record.valid_from, record.valid_until)}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {formatCOP(record.total_coverage_unit_charge)}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {formatCOP(record.monthly_1k_price)}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {formatCOP(record.monthly_2k_price)}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {formatCOP(record.monthly_3k_price)}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <Badge
                        variant={
                          record.status === "active" ? "default" : "secondary"
                        }
                      >
                        {record.status === "active" ? "Activo" : "Inactivo"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(record.id)}
                        disabled={!!editingId || showForm}
                      >
                        Editar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
