"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  reservationSchema,
  FRANCHISES,
  BOOKING_TYPES,
  BOOKING_TYPE_LABELS,
  MONTHLY_MILEAGE_OPTIONS,
  type ReservationFormData,
  type ReservationStatus,
} from "@/lib/schemas/reservation";
import {
  createReservation,
  updateReservation,
} from "@/lib/actions/reservations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReservationStatusActions } from "@/components/layout/reservation-status-actions";

interface SelectOption {
  id: string;
  name: string;
  code?: string;
}

interface CustomerOption {
  id: string;
  first_name: string;
  last_name: string;
  identification_type?: string | null;
  identification_number?: string | null;
  phone?: string | null;
  email?: string | null;
}

interface VehicleCategoryOption {
  id: string;
  code: string;
  name: string;
  rental_company_id: string;
  status: string;
}

interface ReservationFormProps {
  defaultValues?: Partial<ReservationFormData>;
  id?: string;
  customers: CustomerOption[];
  rentalCompanies: SelectOption[];
  locations: SelectOption[];
  referrals: SelectOption[];
  vehicleCategories: VehicleCategoryOption[];
}

const ID_TYPE_LABELS: Record<string, string> = {
  CC: "Cédula Ciudadanía",
  CE: "Cédula Extranjería",
  NIT: "NIT",
  PP: "Pasaporte",
  TI: "Tarjeta Identidad",
};

export function ReservationForm({
  defaultValues,
  id,
  customers,
  rentalCompanies,
  locations,
  referrals,
  vehicleCategories,
}: ReservationFormProps) {
  const router = useRouter();
  const isEditing = !!id;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    control,
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
      nota: null,
      ...defaultValues,
    },
  });

  const franchise = watch("franchise");
  const bookingType = watch("booking_type");
  const customerId = watch("customer_id");
  const rentalCompanyId = watch("rental_company_id");
  const categoryCode = watch("category_code");
  const pickupLocationId = watch("pickup_location_id");
  const returnLocationId = watch("return_location_id");
  const referralId = watch("referral_id");
  const extraDriver = watch("extra_driver");
  const babySeat = watch("baby_seat");
  const washValue = watch("wash");
  const totalInsurance = watch("total_insurance");

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId),
    [customers, customerId],
  );

  const availableCategories = useMemo(() => {
    if (!rentalCompanyId) return [];
    return vehicleCategories.filter(
      (c) => c.rental_company_id === rentalCompanyId,
    );
  }, [vehicleCategories, rentalCompanyId]);

  const categoryValueMissing =
    !!categoryCode &&
    !availableCategories.some((c) => c.code === categoryCode);

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

  const customerIdTypeLabel = selectedCustomer?.identification_type
    ? ID_TYPE_LABELS[selectedCustomer.identification_type] ?? selectedCustomer.identification_type
    : "";

  const persistedStatus = (defaultValues?.status ?? "nueva") as ReservationStatus;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className={isEditing ? "grid gap-6 lg:grid-cols-3" : ""}>
      {/* Cliente */}
      <Card className={isEditing ? "lg:col-span-2" : ""}>
        <CardHeader>
          <CardTitle>Cliente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
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

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="customer_name">Nombre</Label>
              <Input
                id="customer_name"
                value={
                  selectedCustomer
                    ? `${selectedCustomer.first_name} ${selectedCustomer.last_name}`.trim()
                    : ""
                }
                readOnly
                tabIndex={-1}
                className="bg-muted"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customer_id_type">Tipo identificación</Label>
              <Input
                id="customer_id_type"
                value={customerIdTypeLabel}
                readOnly
                tabIndex={-1}
                className="bg-muted"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customer_identification">Identificación</Label>
              <Input
                id="customer_identification"
                value={selectedCustomer?.identification_number ?? ""}
                readOnly
                tabIndex={-1}
                className="bg-muted"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customer_phone">Teléfono</Label>
              <Input
                id="customer_phone"
                value={selectedCustomer?.phone ?? ""}
                readOnly
                tabIndex={-1}
                className="bg-muted"
              />
            </div>

            <div className="space-y-2 sm:col-span-1 lg:col-span-2">
              <Label htmlFor="customer_email">Email</Label>
              <Input
                id="customer_email"
                value={selectedCustomer?.email ?? ""}
                readOnly
                tabIndex={-1}
                className="bg-muted"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {isEditing && id && (
        <Card>
          <CardHeader>
            <CardTitle>Estado</CardTitle>
          </CardHeader>
          <CardContent>
            <ReservationStatusActions
              reservationId={id}
              currentStatus={persistedStatus}
            />
          </CardContent>
        </Card>
      )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
      {/* Vehículo */}
      <Card>
        <CardHeader>
          <CardTitle>Vehículo</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="category_code">Categoría</Label>
            <Select
              value={categoryCode ?? ""}
              onValueChange={(value) => setValue("category_code", value)}
              disabled={!rentalCompanyId}
            >
              <SelectTrigger id="category_code" className="w-full min-w-0">
                <SelectValue
                  placeholder={
                    rentalCompanyId
                      ? "Seleccionar categoría"
                      : "Selecciona una rentadora primero"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availableCategories.map((c) => (
                  <SelectItem key={c.id} value={c.code}>
                    {c.code} — {c.name}
                  </SelectItem>
                ))}
                {categoryValueMissing && (
                  <SelectItem value={categoryCode} disabled>
                    {categoryCode} (inactiva)
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {errors.category_code && (
              <p className="text-sm text-destructive">
                {errors.category_code.message}
              </p>
            )}
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
        </CardContent>
      </Card>

      {/* Precios */}
      <Card>
        <CardHeader>
          <CardTitle>Precios</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="total_price">Precio sin IVA con tasa</Label>
            <Controller
              name="total_price"
              control={control}
              render={({ field }) => (
                <MoneyInput
                  id="total_price"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="total_price_to_pay">Precio total a pagar</Label>
            <Controller
              name="total_price_to_pay"
              control={control}
              render={({ field }) => (
                <MoneyInput
                  id="total_price_to_pay"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="total_price_localiza">Valor OC</Label>
            <Controller
              name="total_price_localiza"
              control={control}
              render={({ field }) => (
                <MoneyInput
                  id="total_price_localiza"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
          </div>
        </CardContent>
      </Card>
      </div>

      {/* Recogida y Retorno */}
      <Card>
        <CardHeader>
          <CardTitle>Recogida y Retorno</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="pickup_location_id">Lugar recogida</Label>
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
              <Label htmlFor="pickup_date">Día recogida</Label>
              <Input id="pickup_date" type="date" {...register("pickup_date")} />
              {errors.pickup_date && (
                <p className="text-sm text-destructive">
                  {errors.pickup_date.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="pickup_hour">Hora recogida</Label>
              <Input id="pickup_hour" type="time" {...register("pickup_hour")} />
              {errors.pickup_hour && (
                <p className="text-sm text-destructive">
                  {errors.pickup_hour.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="return_location_id">Lugar retorno</Label>
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
              <Label htmlFor="return_date">Día retorno</Label>
              <Input id="return_date" type="date" {...register("return_date")} />
              {errors.return_date && (
                <p className="text-sm text-destructive">
                  {errors.return_date.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="return_hour">Hora retorno</Label>
              <Input id="return_hour" type="time" {...register("return_hour")} />
              {errors.return_hour && (
                <p className="text-sm text-destructive">
                  {errors.return_hour.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="selected_days">Días reservados</Label>
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
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
      {/* Reserva */}
      <Card>
        <CardHeader>
          <CardTitle>Reserva</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-3">
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
            <Label htmlFor="reservation_code">Código de reserva</Label>
            <Input id="reservation_code" {...register("reservation_code")} />
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
        </CardContent>
      </Card>

      {/* Operación */}
      <Card>
        <CardHeader>
          <CardTitle>Operación</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="monthly_mileage">Kilometraje</Label>
            <Controller
              name="monthly_mileage"
              control={control}
              render={({ field }) => {
                const current = field.value;
                const isLegacy =
                  current != null &&
                  !MONTHLY_MILEAGE_OPTIONS.some((o) => o.value === current);
                return (
                  <Select
                    value={current == null ? "none" : String(current)}
                    onValueChange={(value) =>
                      field.onChange(value === "none" ? null : Number(value))
                    }
                  >
                    <SelectTrigger id="monthly_mileage" className="w-full min-w-0">
                      <SelectValue placeholder="Sin especificar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin especificar</SelectItem>
                      {MONTHLY_MILEAGE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={String(o.value)}>
                          {o.label}
                        </SelectItem>
                      ))}
                      {isLegacy && (
                        <SelectItem value={String(current)} disabled>
                          {current} km (legacy)
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                );
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="total_insurance">Seguro Total</Label>
            <Controller
              name="total_insurance"
              control={control}
              render={({ field }) => (
                <MoneyInput
                  id="total_insurance"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
          </div>
        </CardContent>
      </Card>

      </div>

      <div className="grid gap-6 lg:grid-cols-2">
      {/* Adicionales */}
      <Card>
        <CardHeader>
          <CardTitle>Adicionales</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="extra_driver"
              checked={extraDriver}
              onCheckedChange={(checked) =>
                setValue("extra_driver", checked === true)
              }
            />
            <Label htmlFor="extra_driver" className="cursor-pointer">
              Conductor adicional
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="baby_seat"
              checked={babySeat}
              onCheckedChange={(checked) =>
                setValue("baby_seat", checked === true)
              }
            />
            <Label htmlFor="baby_seat" className="cursor-pointer">
              Silla bebé
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="wash"
              checked={washValue}
              onCheckedChange={(checked) =>
                setValue("wash", checked === true)
              }
            />
            <Label htmlFor="wash" className="cursor-pointer">
              Lavado
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Vuelo */}
      <Card>
        <CardHeader>
          <CardTitle>Vuelo</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="aeroline">Aerolínea</Label>
            <Input id="aeroline" {...register("aeroline")} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="flight_number">Número de vuelo</Label>
            <Input id="flight_number" {...register("flight_number")} />
          </div>
        </CardContent>
      </Card>
      </div>

      {/* Datos adicionales (no visibles en legacy pero requeridos internamente) */}
      <Card>
        <CardHeader>
          <CardTitle>Datos adicionales</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="referral_raw">Referido (texto libre)</Label>
            <Input
              id="referral_raw"
              {...register("referral_raw")}
              placeholder="Referido manual"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tax_fee">Impuestos</Label>
            <Controller
              name="tax_fee"
              control={control}
              render={({ field }) => (
                <MoneyInput
                  id="tax_fee"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="iva_fee">IVA</Label>
            <Controller
              name="iva_fee"
              control={control}
              render={({ field }) => (
                <MoneyInput
                  id="iva_fee"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="coverage_days">Días de cobertura</Label>
            <Input
              id="coverage_days"
              type="number"
              min={0}
              {...register("coverage_days")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="coverage_price">Precio cobertura</Label>
            <Controller
              name="coverage_price"
              control={control}
              render={({ field }) => (
                <MoneyInput
                  id="coverage_price"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="return_fee">Cargo devolución</Label>
            <Controller
              name="return_fee"
              control={control}
              render={({ field }) => (
                <MoneyInput
                  id="return_fee"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="extra_hours">Horas extra</Label>
            <Input
              id="extra_hours"
              type="number"
              min={0}
              {...register("extra_hours")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="extra_hours_price">Precio horas extra</Label>
            <Controller
              name="extra_hours_price"
              control={control}
              render={({ field }) => (
                <MoneyInput
                  id="extra_hours_price"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
          </div>
        </CardContent>
      </Card>

      {/* Nota */}
      <Card>
        <CardHeader>
          <CardTitle>Nota</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="nota">Nota operativa</Label>
            <Textarea
              id="nota"
              rows={4}
              placeholder="Anotaciones internas sobre la reserva"
              {...register("nota")}
            />
            {errors.nota && (
              <p className="text-sm text-destructive">{errors.nota.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <input type="hidden" {...register("notification_required")} />
      <input type="hidden" {...register("reference_token")} />
      <input type="hidden" {...register("rate_qualifier")} />
      <input type="hidden" {...register("status")} />

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
