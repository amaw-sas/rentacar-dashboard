"use client";

import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  locationSchema,
  type LocationFormData,
} from "@/lib/schemas/location";
import {
  createLocation,
  updateLocation,
} from "@/lib/actions/locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LocationFormProps {
  defaultValues?: Partial<LocationFormData>;
  id?: string;
  rentalCompanies: { id: string; name: string }[];
  cities?: { id: string; name: string }[];
}

export function LocationForm({ defaultValues, id, rentalCompanies, cities }: LocationFormProps) {
  const router = useRouter();
  const isEditing = !!id;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LocationFormData>({
    resolver: zodResolver(locationSchema) as Resolver<LocationFormData>,
    defaultValues: {
      rental_company_id: "",
      code: "",
      name: "",
      city: "",
      pickup_address: "",
      pickup_map: "",
      return_address: null,
      return_map: null,
      city_id: null,
      slug: "",
      status: "active",
      ...defaultValues,
    },
  });

  const status = watch("status");
  const rentalCompanyId = watch("rental_company_id");
  const cityId = watch("city_id");

  async function onSubmit(data: LocationFormData) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(data)) {
      if (value != null && typeof value !== "object") {
        formData.append(key, String(value));
      }
    }

    const result = isEditing
      ? await updateLocation(id, formData)
      : await createLocation(formData);

    if (result.error) {
      setError("root", { message: result.error });
      return;
    }

    router.push("/locations");
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
            <Label htmlFor="city">Ciudad (texto)</Label>
            <Input id="city" {...register("city")} />
          </div>

          {cities && cities.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="city_id">Ciudad (referencia)</Label>
              <Select
                value={cityId ?? "__none__"}
                onValueChange={(value) =>
                  setValue("city_id", value === "__none__" ? null : value)
                }
              >
                <SelectTrigger id="city_id">
                  <SelectValue placeholder="Seleccionar ciudad (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin asignar</SelectItem>
                  {cities.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="pickup_address">Dirección de recogida</Label>
            <Input id="pickup_address" {...register("pickup_address")} />
            {errors.pickup_address && (
              <p className="text-sm text-destructive">{errors.pickup_address.message}</p>
            )}
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="pickup_map">Mapa de recogida (URL)</Label>
            <Input id="pickup_map" {...register("pickup_map")} />
            {errors.pickup_map && (
              <p className="text-sm text-destructive">{errors.pickup_map.message}</p>
            )}
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="return_address">Dirección de devolución (opcional)</Label>
            <Input
              id="return_address"
              {...register("return_address", {
                setValueAs: (value) => (value === "" ? null : value),
              })}
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="return_map">Mapa de devolución (URL, opcional)</Label>
            <Input
              id="return_map"
              {...register("return_map", {
                setValueAs: (value) => (value === "" ? null : value),
              })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">Slug</Label>
            <Input id="slug" {...register("slug")} />
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
            onClick={() => router.push("/locations")}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Guardando..."
              : isEditing
                ? "Guardar cambios"
                : "Crear sucursal"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
