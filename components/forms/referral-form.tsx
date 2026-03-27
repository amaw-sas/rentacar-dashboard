"use client";

import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  referralSchema,
  type ReferralFormData,
} from "@/lib/schemas/referral";
import {
  createReferral,
  updateReferral,
} from "@/lib/actions/referrals";
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

interface ReferralFormProps {
  defaultValues?: Partial<ReferralFormData>;
  id?: string;
}

export function ReferralForm({ defaultValues, id }: ReferralFormProps) {
  const router = useRouter();
  const isEditing = !!id;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ReferralFormData>({
    resolver: zodResolver(referralSchema) as Resolver<ReferralFormData>,
    defaultValues: {
      code: "",
      name: "",
      type: "company",
      contact_name: "",
      contact_email: "",
      contact_phone: "",
      commission_notes: "",
      notes: "",
      status: "active",
      ...defaultValues,
    },
  });

  const status = watch("status");
  const type = watch("type");

  async function onSubmit(data: ReferralFormData) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(data)) {
      if (value != null) {
        formData.append(key, String(value));
      }
    }

    const result = isEditing
      ? await updateReferral(id, formData)
      : await createReferral(formData);

    if (result.error) {
      setError("root", { message: result.error });
      return;
    }

    router.push("/referrals");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Card>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="code">Código</Label>
            <Input id="code" {...register("code")} />
            <p className="text-xs text-muted-foreground">
              Solo letras minúsculas, números y guiones (URL-safe)
            </p>
            {errors.code && (
              <p className="text-sm text-destructive">{errors.code.message}</p>
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
            <Label htmlFor="type">Tipo</Label>
            <Select
              value={type}
              onValueChange={(value: "company" | "hotel" | "salesperson" | "other") =>
                setValue("type", value)
              }
            >
              <SelectTrigger id="type">
                <SelectValue placeholder="Seleccionar tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="company">Empresa</SelectItem>
                <SelectItem value="hotel">Hotel</SelectItem>
                <SelectItem value="salesperson">Vendedor</SelectItem>
                <SelectItem value="other">Otro</SelectItem>
              </SelectContent>
            </Select>
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

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="commission_notes">Notas de comisión</Label>
            <Textarea
              id="commission_notes"
              rows={3}
              {...register("commission_notes")}
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="notes">Notas</Label>
            <Textarea
              id="notes"
              rows={3}
              {...register("notes")}
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
            onClick={() => router.push("/referrals")}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Guardando..."
              : isEditing
                ? "Guardar cambios"
                : "Crear referido"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
