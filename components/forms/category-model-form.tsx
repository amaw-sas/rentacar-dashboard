"use client";

import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  categoryModelSchema,
  type CategoryModelFormData,
} from "@/lib/schemas/category-model";
import {
  createCategoryModel,
  updateCategoryModel,
} from "@/lib/actions/category-models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CategoryModelFormProps {
  categoryId: string;
  defaultValues?: Partial<CategoryModelFormData>;
  id?: string;
  onCancel?: () => void;
}

export function CategoryModelForm({
  categoryId,
  defaultValues,
  id,
  onCancel,
}: CategoryModelFormProps) {
  const router = useRouter();
  const isEditing = !!id;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CategoryModelFormData>({
    resolver: zodResolver(categoryModelSchema) as Resolver<CategoryModelFormData>,
    defaultValues: {
      category_id: categoryId,
      name: "",
      description: "",
      image_url: "",
      is_default: false,
      status: "active",
      ...defaultValues,
    },
  });

  const isDefault = watch("is_default");
  const status = watch("status");

  async function onSubmit(data: CategoryModelFormData) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(data)) {
      if (value != null && value !== "") {
        formData.append(key, String(value));
      }
    }

    const result = isEditing
      ? await updateCategoryModel(id, formData)
      : await createCategoryModel(formData);

    if (result.error) {
      setError("root", { message: result.error });
      return;
    }

    router.refresh();
    onCancel?.();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input type="hidden" {...register("category_id")} />

      <Card>
        <CardHeader>
          <CardTitle>
            {isEditing ? "Editar Modelo" : "Nuevo Modelo"}
          </CardTitle>
        </CardHeader>

        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="model-name">Nombre</Label>
            <Input id="model-name" {...register("name")} />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="image_url">URL de imagen</Label>
            <Input id="image_url" {...register("image_url")} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="description">Descripcion</Label>
            <Input id="description" {...register("description")} />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="is_default"
              checked={isDefault}
              onCheckedChange={(checked) =>
                setValue("is_default", checked === true)
              }
            />
            <Label htmlFor="is_default" className="font-normal">
              Modelo por defecto
            </Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="model-status">Estado</Label>
            <Select
              value={status}
              onValueChange={(v) =>
                setValue("status", v as "active" | "inactive")
              }
            >
              <SelectTrigger id="model-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Activo</SelectItem>
                <SelectItem value="inactive">Inactivo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {errors.root && (
            <div className="sm:col-span-2">
              <p className="text-sm text-destructive">{errors.root.message}</p>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Guardando..."
              : isEditing
                ? "Guardar cambios"
                : "Crear modelo"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
