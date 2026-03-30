"use client";

import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  franchiseSchema,
  type FranchiseFormData,
} from "@/lib/schemas/franchise";
import {
  createFranchise,
  updateFranchise,
} from "@/lib/actions/franchises";
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

interface FranchiseFormProps {
  defaultValues?: Partial<FranchiseFormData>;
  id?: string;
}

export function FranchiseForm({ defaultValues, id }: FranchiseFormProps) {
  const router = useRouter();
  const isEditing = !!id;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FranchiseFormData>({
    resolver: zodResolver(franchiseSchema) as Resolver<FranchiseFormData>,
    defaultValues: {
      code: "",
      display_name: "",
      website: "",
      phone: "",
      whatsapp: "",
      logo_url: "",
      sender_email: "",
      sender_name: "",
      status: "active",
      ...defaultValues,
    },
  });

  const status = watch("status");

  async function onSubmit(data: FranchiseFormData) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(data)) {
      if (value != null) {
        formData.append(key, String(value));
      }
    }

    const result = isEditing
      ? await updateFranchise(id, formData)
      : await createFranchise(formData);

    if (result.error) {
      setError("root", { message: result.error });
      return;
    }

    router.push("/franchises");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Card>
        <CardContent className="space-y-8">
          <div>
            <h3 className="text-lg font-medium mb-4">Datos de Marca</h3>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="code">Código</Label>
                <Input id="code" {...register("code")} />
                {errors.code && (
                  <p className="text-sm text-destructive">{errors.code.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="display_name">Nombre</Label>
                <Input id="display_name" {...register("display_name")} />
                {errors.display_name && (
                  <p className="text-sm text-destructive">
                    {errors.display_name.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="website">Sitio web</Label>
                <Input id="website" {...register("website")} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Teléfono</Label>
                <Input id="phone" {...register("phone")} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="whatsapp">WhatsApp</Label>
                <Input id="whatsapp" {...register("whatsapp")} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="logo_url">URL del logo</Label>
                <Input id="logo_url" {...register("logo_url")} />
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-medium mb-4">Configuración de Email</h3>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sender_email">Email remitente</Label>
                <Input
                  id="sender_email"
                  type="email"
                  {...register("sender_email")}
                />
                {errors.sender_email && (
                  <p className="text-sm text-destructive">
                    {errors.sender_email.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="sender_name">Nombre remitente</Label>
                <Input id="sender_name" {...register("sender_name")} />
                {errors.sender_name && (
                  <p className="text-sm text-destructive">
                    {errors.sender_name.message}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
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
          </div>

          {errors.root && (
            <div>
              <p className="text-sm text-destructive">{errors.root.message}</p>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/franchises")}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Guardando..."
              : isEditing
                ? "Guardar cambios"
                : "Crear franquicia"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
