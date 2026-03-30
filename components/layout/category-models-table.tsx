"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryModelForm } from "@/components/forms/category-model-form";
import { deleteCategoryModel } from "@/lib/actions/category-models";

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
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(modelId: string) {
    if (!confirm("¿Eliminar este modelo?")) return;
    setDeletingId(modelId);
    await deleteCategoryModel(modelId, categoryId);
    setDeletingId(null);
    router.refresh();
  }

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

        {models.length === 0 && !showForm ? (
          <p className="text-sm text-muted-foreground">
            No hay modelos registrados para esta categoría.
          </p>
        ) : (
          <div className="space-y-4">
            {models.map((model) =>
              editingId === model.id ? (
                <CategoryModelForm
                  key={model.id}
                  categoryId={categoryId}
                  id={model.id}
                  defaultValues={{
                    category_id: model.category_id,
                    name: model.name,
                    description: model.description,
                    image_url: model.image_url,
                    is_default: model.is_default,
                    status: model.status as "active" | "inactive",
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div
                  key={model.id}
                  className="flex items-center justify-between rounded-lg border border-border p-3"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium">{model.name}</p>
                      {model.description && (
                        <p className="text-sm text-muted-foreground">
                          {model.description}
                        </p>
                      )}
                    </div>
                    {model.is_default && (
                      <Badge variant="default">Por defecto</Badge>
                    )}
                    <Badge
                      variant={
                        model.status === "active" ? "outline" : "secondary"
                      }
                    >
                      {model.status === "active" ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(model.id)}
                      disabled={!!editingId || showForm}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(model.id)}
                      disabled={deletingId === model.id}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
