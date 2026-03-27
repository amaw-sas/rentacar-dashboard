"use client";

import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  vehicleCategorySchema,
  type VehicleCategoryFormData,
} from "@/lib/schemas/vehicle-category";
import {
  createVehicleCategory,
  updateVehicleCategory,
} from "@/lib/actions/vehicle-categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RentalCompanyOption {
  id: string;
  name: string;
}

interface VehicleCategoryFormProps {
  defaultValues?: Partial<VehicleCategoryFormData>;
  id?: string;
  rentalCompanies: RentalCompanyOption[];
}

export function VehicleCategoryForm({
  defaultValues,
  id,
  rentalCompanies,
}: VehicleCategoryFormProps) {
  const router = useRouter();
  const isEditing = !!id;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<VehicleCategoryFormData>({
    resolver: zodResolver(vehicleCategorySchema) as Resolver<VehicleCategoryFormData>,
    defaultValues: {
      rental_company_id: "",
      code: "",
      name: "",
      description: "",
      image_url: "",
      passenger_count: 0,
      luggage_count: 0,
      has_ac: true,
      transmission: "manual",
      status: "active",
      ...defaultValues,
    },
  });

  const rentalCompanyId = watch("rental_company_id");
  const transmission = watch("transmission");
  const status = watch("status");
  const hasAc = watch("has_ac");

  async function onSubmit(data: VehicleCategoryFormData) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(data)) {
      if (value != null) {
        formData.append(key, String(value));
      }
    }

    const result = isEditing
      ? await updateVehicleCategory(id, formData)
      : await createVehicleCategory(formData);

    if (result.error) {
      setError("root", { message: result.error });
      return;
    }

    router.push("/categories");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Card>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="rental_company_id">Rentadora</Label>
            <Select
              value={rentalCompanyId}
              onValueChange={(value) => setValue("rental_company_id", value)}
            >
              <SelectTrigger id="rental_company_id">
                <SelectValue placeholder="Seleccionar rentadora" />
              </SelectTrigger>
              <SelectContent>
                {rentalCompanies.map((rc) => (
                  <SelectItem key={rc.id} value={rc.id}>
                    {rc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.rental_company_id && (
              <p className="text-sm text-destructive">
                {errors.rental_company_id.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" {...register("name")} />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="code">Código</Label>
            <Input id="code" {...register("code")} />
            {errors.code && (
              <p className="text-sm text-destructive">{errors.code.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descripción</Label>
            <Input id="description" {...register("description")} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="passenger_count">Pasajeros</Label>
            <Input
              id="passenger_count"
              type="number"
              min="0"
              {...register("passenger_count")}
            />
            {errors.passenger_count && (
              <p className="text-sm text-destructive">
                {errors.passenger_count.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="luggage_count">Equipaje</Label>
            <Input
              id="luggage_count"
              type="number"
              min="0"
              {...register("luggage_count")}
            />
            {errors.luggage_count && (
              <p className="text-sm text-destructive">
                {errors.luggage_count.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="transmission">Transmisión</Label>
            <Select
              value={transmission}
              onValueChange={(value: "automatic" | "manual") =>
                setValue("transmission", value)
              }
            >
              <SelectTrigger id="transmission">
                <SelectValue placeholder="Seleccionar transmisión" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="automatic">Automática</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
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
                <SelectItem value="active">Activa</SelectItem>
                <SelectItem value="inactive">Inactiva</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 sm:col-span-2">
            <Checkbox
              id="has_ac"
              checked={hasAc}
              onCheckedChange={(checked) =>
                setValue("has_ac", checked === true)
              }
            />
            <Label htmlFor="has_ac" className="cursor-pointer">
              Aire Acondicionado
            </Label>
          </div>

          {errors.root && (
            <div className="sm:col-span-2">
              <p className="text-sm text-destructive">{errors.root.message}</p>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/categories")}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Guardando..."
              : isEditing
                ? "Guardar cambios"
                : "Crear categoría"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
