"use client";

import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  customerSchema,
  type CustomerFormData,
} from "@/lib/schemas/customer";
import {
  createCustomer,
  updateCustomer,
} from "@/lib/actions/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CustomerFormProps {
  defaultValues?: Partial<CustomerFormData>;
  id?: string;
}

export function CustomerForm({ defaultValues, id }: CustomerFormProps) {
  const router = useRouter();
  const isEditing = !!id;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CustomerFormData>({
    resolver: zodResolver(customerSchema) as Resolver<CustomerFormData>,
    defaultValues: {
      first_name: "",
      last_name: "",
      identification_type: "CC",
      identification_number: "",
      phone: "",
      email: "",
      notes: "",
      status: "active",
      ...defaultValues,
    },
  });

  const status = watch("status");
  const identificationType = watch("identification_type");

  async function onSubmit(data: CustomerFormData) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(data)) {
      if (value != null) {
        formData.append(key, String(value));
      }
    }

    const result = isEditing
      ? await updateCustomer(id, formData)
      : await createCustomer(formData);

    if (result.error) {
      setError("root", { message: result.error });
      return;
    }

    router.push("/customers");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Card>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="first_name">Nombre</Label>
            <Input id="first_name" {...register("first_name")} />
            {errors.first_name && (
              <p className="text-sm text-destructive">{errors.first_name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="last_name">Apellido</Label>
            <Input id="last_name" {...register("last_name")} />
            {errors.last_name && (
              <p className="text-sm text-destructive">{errors.last_name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="identification_type">Tipo de identificación</Label>
            <Select
              value={identificationType}
              onValueChange={(value: "CC" | "CE" | "NIT" | "PP" | "TI") =>
                setValue("identification_type", value)
              }
            >
              <SelectTrigger id="identification_type">
                <SelectValue placeholder="Seleccionar tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CC">CC - Cédula de Ciudadanía</SelectItem>
                <SelectItem value="CE">CE - Cédula de Extranjería</SelectItem>
                <SelectItem value="NIT">NIT</SelectItem>
                <SelectItem value="PP">PP - Pasaporte</SelectItem>
                <SelectItem value="TI">TI - Tarjeta de Identidad</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="identification_number">Número de identificación</Label>
            <Input id="identification_number" {...register("identification_number")} />
            {errors.identification_number && (
              <p className="text-sm text-destructive">
                {errors.identification_number.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Teléfono</Label>
            <Input id="phone" {...register("phone")} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...register("email")} />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="notes">Notas</Label>
            <Textarea id="notes" rows={3} {...register("notes")} />
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
            onClick={() => router.push("/customers")}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Guardando..."
              : isEditing
                ? "Guardar cambios"
                : "Crear cliente"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
