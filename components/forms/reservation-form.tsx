"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  reservationSchema,
  FRANCHISES,
  BOOKING_TYPES,
  BOOKING_TYPE_LABELS,
  type ReservationFormData,
} from "@/lib/schemas/reservation";
import {
  createReservation,
  updateReservation,
} from "@/lib/actions/reservations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SelectOption {
  id: string;
  name: string;
  code?: string;
}

interface ReservationFormProps {
  defaultValues?: Partial<ReservationFormData>;
  id?: string;
  customers: { id: string; first_name: string; last_name: string }[];
  rentalCompanies: SelectOption[];
  locations: SelectOption[];
  referrals: SelectOption[];
}

export function ReservationForm({
  defaultValues,
  id,
  customers,
  rentalCompanies,
  locations,
  referrals,
}: ReservationFormProps) {
  const router = useRouter();
  const isEditing = !!id;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ReservationFormData>({
    resolver: zodResolver(reservationSchema) as Resolver<ReservationFormData>,
    defaultValues: {
      customer_id: "",
      rental_company_id: "",
      referral_id: null,
      referral_raw: null,
      pickup_location_id: "",
      return_location_id: "",
      franchise: "alquilatucarro",
      booking_type: "standard",
      reservation_code: null,
      reference_token: null,
      rate_qualifier: null,
      category_code: "",
      pickup_date: "",
      pickup_hour: "",
      return_date: "",
      return_hour: "",
      selected_days: 1,
      total_price: 0,
      total_price_to_pay: 0,
      total_price_localiza: 0,
      tax_fee: 0,
      iva_fee: 0,
      coverage_days: 0,
      coverage_price: 0,
      return_fee: 0,
      extra_hours: 0,
      extra_hours_price: 0,
      total_insurance: 0,
      extra_driver: false,
      baby_seat: false,
      wash: false,
      aeroline: null,
      flight_number: null,
      monthly_mileage: null,
      notification_required: false,
      status: "nueva",
      ...defaultValues,
    },
  });

  const franchise = watch("franchise");
  const bookingType = watch("booking_type");
  const customerId = watch("customer_id");
  const rentalCompanyId = watch("rental_company_id");
  const pickupLocationId = watch("pickup_location_id");
  const returnLocationId = watch("return_location_id");
  const referralId = watch("referral_id");
  const extraDriver = watch("extra_driver");
  const babySeat = watch("baby_seat");
  const washValue = watch("wash");
  const totalInsurance = watch("total_insurance");

  // Compute notification_required
  useEffect(() => {
    const hasInsurance = bookingType === "standard_with_insurance";
    const isMonthly = bookingType === "monthly";
    const hasExtras = extraDriver || babySeat || washValue;
    setValue("notification_required", hasInsurance || isMonthly || hasExtras);
  }, [bookingType, extraDriver, babySeat, washValue, totalInsurance, setValue]);

  async function onSubmit(data: ReservationFormData) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(data)) {
      if (value != null) {
        formData.append(key, String(value));
      }
    }

    const result = isEditing
      ? await updateReservation(id, formData)
      : await createReservation(formData);

    if (result.error) {
      setError("root", { message: result.error });
      return;
    }

    router.push("/reservations");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Cliente */}
      <Card>
        <CardHeader>
          <CardTitle>Cliente</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="customer_id">Cliente</Label>
            <Select
              value={customerId}
              onValueChange={(value) => setValue("customer_id", value)}
            >
              <SelectTrigger id="customer_id">
                <SelectValue placeholder="Seleccionar cliente" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.first_name} {c.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.customer_id && (
              <p className="text-sm text-destructive">{errors.customer_id.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="referral_id">Referido</Label>
            <Select
              value={referralId ?? "none"}
              onValueChange={(value) =>
                setValue("referral_id", value === "none" ? null : value)
              }
            >
              <SelectTrigger id="referral_id">
                <SelectValue placeholder="Sin referido" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin referido</SelectItem>
                {referrals.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name} {r.code ? `(${r.code})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="referral_raw">Referido (texto libre)</Label>
            <Input
              id="referral_raw"
              {...register("referral_raw")}
              placeholder="Referido manual"
            />
          </div>
        </CardContent>
      </Card>

      {/* Reserva */}
      <Card>
        <CardHeader>
          <CardTitle>Reserva</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="franchise">Franquicia</Label>
            <Select
              value={franchise}
              onValueChange={(value: (typeof FRANCHISES)[number]) =>
                setValue("franchise", value)
              }
            >
              <SelectTrigger id="franchise">
                <SelectValue placeholder="Seleccionar franquicia" />
              </SelectTrigger>
              <SelectContent>
                {FRANCHISES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="booking_type">Tipo de Reserva</Label>
            <Select
              value={bookingType}
              onValueChange={(value: (typeof BOOKING_TYPES)[number]) =>
                setValue("booking_type", value)
              }
            >
              <SelectTrigger id="booking_type">
                <SelectValue placeholder="Seleccionar tipo" />
              </SelectTrigger>
              <SelectContent>
                {BOOKING_TYPES.map((bt) => (
                  <SelectItem key={bt} value={bt}>
                    {BOOKING_TYPE_LABELS[bt]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
            <Label htmlFor="category_code">Categoría</Label>
            <Input id="category_code" {...register("category_code")} />
            {errors.category_code && (
              <p className="text-sm text-destructive">
                {errors.category_code.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pickup_location_id">Ubicación Recogida</Label>
            <Select
              value={pickupLocationId}
              onValueChange={(value) => setValue("pickup_location_id", value)}
            >
              <SelectTrigger id="pickup_location_id">
                <SelectValue placeholder="Seleccionar ubicación" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.pickup_location_id && (
              <p className="text-sm text-destructive">
                {errors.pickup_location_id.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="return_location_id">Ubicación Devolución</Label>
            <Select
              value={returnLocationId}
              onValueChange={(value) => setValue("return_location_id", value)}
            >
              <SelectTrigger id="return_location_id">
                <SelectValue placeholder="Seleccionar ubicación" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.return_location_id && (
              <p className="text-sm text-destructive">
                {errors.return_location_id.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pickup_date">Fecha Recogida</Label>
            <Input id="pickup_date" type="date" {...register("pickup_date")} />
            {errors.pickup_date && (
              <p className="text-sm text-destructive">
                {errors.pickup_date.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pickup_hour">Hora Recogida</Label>
            <Input id="pickup_hour" type="time" {...register("pickup_hour")} />
            {errors.pickup_hour && (
              <p className="text-sm text-destructive">
                {errors.pickup_hour.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="return_date">Fecha Devolución</Label>
            <Input id="return_date" type="date" {...register("return_date")} />
            {errors.return_date && (
              <p className="text-sm text-destructive">
                {errors.return_date.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="return_hour">Hora Devolución</Label>
            <Input id="return_hour" type="time" {...register("return_hour")} />
            {errors.return_hour && (
              <p className="text-sm text-destructive">
                {errors.return_hour.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="selected_days">Días Seleccionados</Label>
            <Input
              id="selected_days"
              type="number"
              min={1}
              {...register("selected_days")}
            />
            {errors.selected_days && (
              <p className="text-sm text-destructive">
                {errors.selected_days.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reservation_code">Código de Reserva</Label>
            <Input id="reservation_code" {...register("reservation_code")} />
          </div>
        </CardContent>
      </Card>

      {/* Precios */}
      <Card>
        <CardHeader>
          <CardTitle>Precios</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="total_price">Precio Total</Label>
            <Input
              id="total_price"
              type="number"
              step="0.01"
              min={0}
              {...register("total_price")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="total_price_to_pay">Total a Pagar</Label>
            <Input
              id="total_price_to_pay"
              type="number"
              step="0.01"
              min={0}
              {...register("total_price_to_pay")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="total_price_localiza">Precio Localiza</Label>
            <Input
              id="total_price_localiza"
              type="number"
              step="0.01"
              min={0}
              {...register("total_price_localiza")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tax_fee">Impuestos</Label>
            <Input
              id="tax_fee"
              type="number"
              step="0.01"
              min={0}
              {...register("tax_fee")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="iva_fee">IVA</Label>
            <Input
              id="iva_fee"
              type="number"
              step="0.01"
              min={0}
              {...register("iva_fee")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="coverage_days">Días de Cobertura</Label>
            <Input
              id="coverage_days"
              type="number"
              min={0}
              {...register("coverage_days")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="coverage_price">Precio Cobertura</Label>
            <Input
              id="coverage_price"
              type="number"
              step="0.01"
              min={0}
              {...register("coverage_price")}
            />
          </div>
        </CardContent>
      </Card>

      {/* Extras */}
      <Card>
        <CardHeader>
          <CardTitle>Extras</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="return_fee">Cargo Devolución</Label>
            <Input
              id="return_fee"
              type="number"
              step="0.01"
              min={0}
              {...register("return_fee")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="extra_hours">Horas Extra</Label>
            <Input
              id="extra_hours"
              type="number"
              min={0}
              {...register("extra_hours")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="extra_hours_price">Precio Horas Extra</Label>
            <Input
              id="extra_hours_price"
              type="number"
              step="0.01"
              min={0}
              {...register("extra_hours_price")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="total_insurance">Seguro Total</Label>
            <Input
              id="total_insurance"
              type="number"
              step="0.01"
              min={0}
              {...register("total_insurance")}
            />
          </div>

          <div className="flex items-center gap-2 pt-6">
            <Checkbox
              id="extra_driver"
              checked={extraDriver}
              onCheckedChange={(checked) =>
                setValue("extra_driver", checked === true)
              }
            />
            <Label htmlFor="extra_driver">Conductor Adicional</Label>
          </div>

          <div className="flex items-center gap-2 pt-6">
            <Checkbox
              id="baby_seat"
              checked={babySeat}
              onCheckedChange={(checked) =>
                setValue("baby_seat", checked === true)
              }
            />
            <Label htmlFor="baby_seat">Silla de Bebé</Label>
          </div>

          <div className="flex items-center gap-2 pt-6">
            <Checkbox
              id="wash"
              checked={washValue}
              onCheckedChange={(checked) =>
                setValue("wash", checked === true)
              }
            />
            <Label htmlFor="wash">Lavado</Label>
          </div>
        </CardContent>
      </Card>

      {/* Vuelo */}
      <Card>
        <CardHeader>
          <CardTitle>Vuelo (opcional)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="aeroline">Aerolínea</Label>
            <Input id="aeroline" {...register("aeroline")} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="flight_number">Número de Vuelo</Label>
            <Input id="flight_number" {...register("flight_number")} />
          </div>
        </CardContent>
      </Card>

      {/* Mensualidad */}
      {bookingType === "monthly" && (
        <Card>
          <CardHeader>
            <CardTitle>Mensualidad</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-w-sm">
              <Label htmlFor="monthly_mileage">Kilometraje Mensual</Label>
              <Input
                id="monthly_mileage"
                type="number"
                min={0}
                {...register("monthly_mileage")}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hidden notification_required */}
      <input type="hidden" {...register("notification_required")} />

      {/* Error & Submit */}
      <Card>
        <CardFooter className="flex justify-between pt-6">
          <div>
            {errors.root && (
              <p className="text-sm text-destructive">{errors.root.message}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/reservations")}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "Guardando..."
                : isEditing
                  ? "Guardar cambios"
                  : "Crear reserva"}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </form>
  );
}
