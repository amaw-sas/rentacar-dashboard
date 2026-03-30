"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryModelForm } from "@/components/forms/category-model-form";

interface CategoryModelRecord {
  id: string;
  category_id: string;
  name: string;
  description: string;
  image_url: string;
  is_default: boolean;
  status: string;
}

interface CategoryModelsTableProps {
  categoryId: string;
  models: CategoryModelRecord[];
}

export function CategoryModelsTable({
  categoryId,
  models,
}: CategoryModelsTableProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingRecord = editingId
    ? models.find((m) => m.id === editingId)
    : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Modelos</CardTitle>
        {!showForm && !editingId && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            Agregar Modelo
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {showForm && (
          <CategoryModelForm
            categoryId={categoryId}
            onCancel={() => setShowForm(false)}
          />
        )}

        {editingId && editingRecord && (
          <CategoryModelForm
            categoryId={categoryId}
            id={editingId}
            defaultValues={{
              category_id: editingRecord.category_id,
              name: editingRecord.name,
              description: editingRecord.description,
              image_url: editingRecord.image_url,
              is_default: editingRecord.is_default,
              status: editingRecord.status as "active" | "inactive",
            }}
            onCancel={() => setEditingId(null)}
          />
        )}

        {models.length === 0 && !showForm ? (
          <p className="text-sm text-muted-foreground">
            No hay modelos registrados para esta categoria.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full caption-bottom text-sm">
              <thead className="border-b border-border bg-muted/50">
                <tr>
                  <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                    Nombre
                  </th>
                  <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                    Descripcion
                  </th>
                  <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                    Por defecto
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
                {models.map((model) => (
                  <tr
                    key={model.id}
                    className="border-b border-border transition-colors hover:bg-muted/50"
                  >
                    <td className="px-3 py-2 align-middle font-medium">
                      {model.name}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {model.description || "—"}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {model.is_default ? (
                        <Badge variant="default">Si</Badge>
                      ) : (
                        "No"
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <Badge
                        variant={
                          model.status === "active" ? "default" : "secondary"
                        }
                      >
                        {model.status === "active" ? "Activo" : "Inactivo"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(model.id)}
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
