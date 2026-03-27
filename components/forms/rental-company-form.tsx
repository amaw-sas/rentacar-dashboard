"use client";

import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  rentalCompanySchema,
  type RentalCompanyFormData,
} from "@/lib/schemas/rental-company";
import {
  createRentalCompany,
  updateRentalCompany,
} from "@/lib/actions/rental-companies";
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

interface RentalCompanyFormProps {
  defaultValues?: Partial<RentalCompanyFormData>;
  id?: string;
}

export function RentalCompanyForm({ defaultValues, id }: RentalCompanyFormProps) {
  const router = useRouter();
  const isEditing = !!id;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RentalCompanyFormData>({
    resolver: zodResolver(rentalCompanySchema) as Resolver<RentalCompanyFormData>,
    defaultValues: {
      name: "",
      code: "",
      commission_rate_min: null,
      commission_rate_max: null,
      contact_name: "",
      contact_email: "",
      contact_phone: "",
      api_base_url: "",
      extra_driver_day_price: 0,
      baby_seat_day_price: 0,
      wash_price: 0,
      status: "active",
      ...defaultValues,
    },
  });

  const status = watch("status");

  async function onSubmit(data: RentalCompanyFormData) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(data)) {
      if (value != null) {
        formData.append(key, String(value));
      }
    }

    const result = isEditing
      ? await updateRentalCompany(id, formData)
      : await createRentalCompany(formData);

    if (result.error) {
      setError("root", { message: result.error });
      return;
    }

    router.push("/rental-companies");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Card>
        <CardContent className="grid gap-6 sm:grid-cols-2">
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
            <Label htmlFor="commission_rate_min">Comisión mínima (%)</Label>
            <Input
              id="commission_rate_min"
              type="number"
              step="0.01"
              {...register("commission_rate_min")}
            />
            {errors.commission_rate_min && (
              <p className="text-sm text-destructive">
                {errors.commission_rate_min.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="commission_rate_max">Comisión máxima (%)</Label>
            <Input
              id="commission_rate_max"
              type="number"
              step="0.01"
              {...register("commission_rate_max")}
            />
            {errors.commission_rate_max && (
              <p className="text-sm text-destructive">
                {errors.commission_rate_max.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact_name">Nombre de contacto</Label>
            <Input id="contact_name" {...register("contact_name")} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact_email">Email de contacto</Label>
            <Input
              id="contact_email"
              type="email"
              {...register("contact_email")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact_phone">Teléfono de contacto</Label>
            <Input id="contact_phone" {...register("contact_phone")} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="api_base_url">URL base de API</Label>
            <Input id="api_base_url" {...register("api_base_url")} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="extra_driver_day_price">
              Precio conductor extra/día
            </Label>
            <Input
              id="extra_driver_day_price"
              type="number"
              step="0.01"
              {...register("extra_driver_day_price")}
            />
            {errors.extra_driver_day_price && (
              <p className="text-sm text-destructive">
                {errors.extra_driver_day_price.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="baby_seat_day_price">Precio silla bebé/día</Label>
            <Input
              id="baby_seat_day_price"
              type="number"
              step="0.01"
              {...register("baby_seat_day_price")}
            />
            {errors.baby_seat_day_price && (
              <p className="text-sm text-destructive">
                {errors.baby_seat_day_price.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="wash_price">Precio lavado</Label>
            <Input
              id="wash_price"
              type="number"
              step="0.01"
              {...register("wash_price")}
            />
            {errors.wash_price && (
              <p className="text-sm text-destructive">
                {errors.wash_price.message}
              </p>
            )}
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
            onClick={() => router.push("/rental-companies")}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Guardando..."
              : isEditing
                ? "Guardar cambios"
                : "Crear rentadora"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
