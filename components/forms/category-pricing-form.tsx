"use client";

import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  categoryPricingSchema,
  type CategoryPricingFormData,
} from "@/lib/schemas/category-pricing";
import {
  createCategoryPricing,
  updateCategoryPricing,
} from "@/lib/actions/category-pricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CategoryPricingFormProps {
  categoryId: string;
  defaultValues?: Partial<CategoryPricingFormData>;
  id?: string;
  onCancel?: () => void;
}

export function CategoryPricingForm({
  categoryId,
  defaultValues,
  id,
  onCancel,
}: CategoryPricingFormProps) {
  const router = useRouter();
  const isEditing = !!id;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CategoryPricingFormData>({
    resolver: zodResolver(categoryPricingSchema) as Resolver<CategoryPricingFormData>,
    defaultValues: {
      category_id: categoryId,
      total_coverage_unit_charge: 0,
      monthly_1k_price: null,
      monthly_2k_price: null,
      monthly_3k_price: null,
      monthly_insurance_price: null,
      monthly_one_day_price: null,
      valid_from: "",
      valid_until: null,
      status: "active",
      ...defaultValues,
    },
  });

  const status = watch("status");

  async function onSubmit(data: CategoryPricingFormData) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(data)) {
      if (value != null && value !== "") {
        formData.append(key, String(value));
      }
    }

    const result = isEditing
      ? await updateCategoryPricing(id, formData)
      : await createCategoryPricing(formData);

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
          <CardTitle>{isEditing ? "Editar Precios" : "Nuevos Precios"}</CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Seguro Total */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Seguro Total
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="total_coverage_unit_charge">Cargo unitario seguro total</Label>
                <Input
                  id="total_coverage_unit_charge"
                  type="number"
                  min="0"
                  step="0.01"
                  {...register("total_coverage_unit_charge")}
                />
                {errors.total_coverage_unit_charge && (
                  <p className="text-sm text-destructive">
                    {errors.total_coverage_unit_charge.message}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Mensualidades */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Mensualidades
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="monthly_1k_price">Mensual 1.000 km</Label>
                <Input
                  id="monthly_1k_price"
                  type="number"
                  min="0"
                  step="0.01"
                  {...register("monthly_1k_price")}
                />
                {errors.monthly_1k_price && (
                  <p className="text-sm text-destructive">
                    {errors.monthly_1k_price.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="monthly_2k_price">Mensual 2.000 km</Label>
                <Input
                  id="monthly_2k_price"
                  type="number"
                  min="0"
                  step="0.01"
                  {...register("monthly_2k_price")}
                />
                {errors.monthly_2k_price && (
                  <p className="text-sm text-destructive">
                    {errors.monthly_2k_price.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="monthly_3k_price">Mensual 3.000 km</Label>
                <Input
                  id="monthly_3k_price"
                  type="number"
                  min="0"
                  step="0.01"
                  {...register("monthly_3k_price")}
                />
                {errors.monthly_3k_price && (
                  <p className="text-sm text-destructive">
                    {errors.monthly_3k_price.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="monthly_insurance_price">Mensual seguro</Label>
                <Input
                  id="monthly_insurance_price"
                  type="number"
                  min="0"
                  step="0.01"
                  {...register("monthly_insurance_price")}
                />
                {errors.monthly_insurance_price && (
                  <p className="text-sm text-destructive">
                    {errors.monthly_insurance_price.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="monthly_one_day_price">Mensual un día</Label>
                <Input
                  id="monthly_one_day_price"
                  type="number"
                  min="0"
                  step="0.01"
                  {...register("monthly_one_day_price")}
                />
                {errors.monthly_one_day_price && (
                  <p className="text-sm text-destructive">
                    {errors.monthly_one_day_price.message}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Vigencia y estado */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="valid_from">Vigente desde</Label>
              <Input
                id="valid_from"
                type="date"
                {...register("valid_from")}
              />
              {errors.valid_from && (
                <p className="text-sm text-destructive">
                  {errors.valid_from.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="valid_until">Vigente hasta (opcional)</Label>
              <Input
                id="valid_until"
                type="date"
                {...register("valid_until")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Estado</Label>
              <Select
                value={status}
                onValueChange={(value: "active" | "inactive") =>
                  setValue("status", value)
                }
              >
                <SelectTrigger id="status">
                  <SelectValue placeholder="Seleccionar estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Activo</SelectItem>
                  <SelectItem value="inactive">Inactivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {errors.root && (
            <p className="text-sm text-destructive">{errors.root.message}</p>
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
                : "Crear precios"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
