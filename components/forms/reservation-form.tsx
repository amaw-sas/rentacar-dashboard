"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
import { updateCustomerContact } from "@/lib/actions/customers";
import { customerContactSchema } from "@/lib/schemas/customer";
import { getReturnTo } from "@/lib/navigation/return-to";
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
import { Combobox } from "@/components/ui/combobox";
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
  // The reservation's linked customer, resolved server-side from the FK
  // (edit only). `customers` is capped at 1000 rows by PostgREST, so the
  // linked customer is often absent from it (issue #75); this guarantees the
  // selected customer is always available to seed the section and the combobox
  // label, independent of that window.
  selectedCustomer?: CustomerOption;
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

// Inline customer contact editing (#36). These fields are not part of
// reservationSchema — they live in local state and persist via their own
// action. Module-scoped so the re-seed effect has a stable reference.
type CustomerContactDraft = {
  first_name: string;
  last_name: string;
  identification_type: string;
  identification_number: string;
  phone: string;
  email: string;
};

const EMPTY_CONTACT: CustomerContactDraft = {
  first_name: "",
  last_name: "",
  identification_type: "CC",
  identification_number: "",
  phone: "",
  email: "",
};

function contactFromCustomer(
  c: CustomerOption | undefined,
): CustomerContactDraft {
  if (!c) return EMPTY_CONTACT;
  return {
    first_name: c.first_name ?? "",
    last_name: c.last_name ?? "",
    identification_type: c.identification_type ?? "CC",
    identification_number: c.identification_number ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
  };
}

export function ReservationForm({
  defaultValues,
  id,
  customers,
  selectedCustomer,
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
    formState: { errors, isSubmitting, dirtyFields },
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
      total_insurance: false,
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

  const [customerDraft, setCustomerDraft] =
    useState<CustomerContactDraft>(EMPTY_CONTACT);
  const [customerSnapshot, setCustomerSnapshot] =
    useState<CustomerContactDraft>(EMPTY_CONTACT);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);

  // Re-seed draft + snapshot ONLY when the selected customer changes
  // (SCEN-006: switching customer discards unsaved edits). Intentionally NOT
  // keyed on `customers`: a post-save router.refresh() hands down a fresh
  // `customers` array, and re-seeding on that reference would clobber the
  // just-saved draft (dual-writer race) and wipe unsaved edits on any
  // unrelated revalidation. The combobox label still resyncs because it
  // reads the refreshed `customers` prop directly.
  useEffect(() => {
    // Prefer the loaded list; fall back to the server-resolved linked customer
    // when the active customer is outside the 1000-row window (issue #75). The
    // fallback is id-scoped so switching to another (in-window) customer still
    // re-seeds from the list, never from the stale linked record.
    const resolved =
      customers.find((c) => c.id === customerId) ??
      (customerId === selectedCustomer?.id ? selectedCustomer : undefined);
    const seeded = contactFromCustomer(resolved);
    setCustomerDraft(seeded);
    setCustomerSnapshot(seeded);
    setCustomerError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  // The combobox resolves its selected label from its options. When the linked
  // customer is outside the loaded window (issue #75), merge it in so the label
  // renders the customer's name instead of the "Seleccionar cliente" placeholder.
  const customerOptions = useMemo(
    () =>
      selectedCustomer && !customers.some((c) => c.id === selectedCustomer.id)
        ? [selectedCustomer, ...customers]
        : customers,
    [customers, selectedCustomer],
  );

  const isCustomerDirty = useMemo(
    () =>
      (Object.keys(EMPTY_CONTACT) as (keyof CustomerContactDraft)[]).some(
        (k) => customerDraft[k] !== customerSnapshot[k],
      ),
    [customerDraft, customerSnapshot],
  );

  // Issue #90: a status change fires its notification from live DB data. If the
  // operator has unsaved reservation-form OR customer-contact edits, that
  // notification would carry stale values. Block the status button until saved.
  // Use `dirtyFields` (not `formState.isDirty`): RHF only populates it after a
  // real change event, so it is immune to the string-vs-number mount mismatch
  // of the numeric inputs (`register` emits strings, defaults are numbers) that
  // would make `isDirty` report a false positive on a freshly loaded form.
  const hasUnsavedChanges =
    Object.keys(dirtyFields).length > 0 || isCustomerDirty;

  const setContactField = (
    field: keyof CustomerContactDraft,
    value: string,
  ) => {
    setCustomerDraft((prev) => ({ ...prev, [field]: value }));
  };

  async function handleSaveCustomer() {
    if (!customerId) return;
    setCustomerError(null);

    const parsed = customerContactSchema.safeParse(customerDraft);
    if (!parsed.success) {
      setCustomerError(parsed.error.issues[0].message);
      return;
    }

    setSavingCustomer(true);
    try {
      const fd = new FormData();
      for (const [key, value] of Object.entries(parsed.data)) {
        fd.append(key, value);
      }
      // When editing an existing reservation, pass its id so the inline contact
      // edit re-snapshots ONLY this reservation (issue #26, SCEN-009). On a new
      // reservation `id` is undefined → no re-snapshot (no row exists yet).
      const result = await updateCustomerContact(customerId, fd, id);

      if (result.error) {
        setCustomerError(result.error);
        return;
      }

      // Snapshot AND draft = exactly-persisted (trimmed) values: dirty resets
      // and the fields show the saved values immediately (SCEN-001). The
      // contact inputs and the combobox are disabled while saving, so the
      // selected customer cannot change mid-flight. router.refresh() syncs the
      // combobox label from the refreshed `customers` prop; the re-seed effect
      // does NOT refire (customerId unchanged) — no dual-writer race.
      setCustomerDraft(parsed.data);
      setCustomerSnapshot(parsed.data);
      router.refresh();
    } catch {
      // The action threw (transport/server failure) instead of returning
      // {error}. Without this, savingCustomer would stay true forever and
      // freeze the customer section with no error shown.
      setCustomerError("No se pudo guardar el cliente. Intenta de nuevo.");
    } finally {
      setSavingCustomer(false);
    }
  }

  const canSaveCustomer =
    customerId !== "" && isCustomerDirty && !savingCustomer;

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

    router.push(getReturnTo("/reservations"));
  }

  function onInvalid(
    fieldErrors: Record<string, { message?: string } | undefined>,
  ) {
    const details = Object.entries(fieldErrors)
      .map(([field, err]) => `${field}: ${err?.message ?? "inválido"}`)
      .join(" · ");
    setError("root", {
      message: `Revisa los campos con error — ${details}`,
    });
  }

  const persistedStatus = (defaultValues?.status ?? "nueva") as ReservationStatus;

  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-6">
      <div className={isEditing ? "grid gap-6 lg:grid-cols-3" : ""}>
      {/* Cliente */}
      <Card className={isEditing ? "lg:col-span-2" : ""}>
        <CardHeader>
          <CardTitle>Cliente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="customer_id">Cliente</Label>
            <Combobox<CustomerOption>
              id="customer_id"
              options={customerOptions}
              value={customerId}
              onChange={(value) =>
                setValue("customer_id", value, {
                  shouldValidate: true,
                  shouldDirty: true,
                })
              }
              getId={(c) => c.id}
              getLabel={(c) => `${c.first_name} ${c.last_name}`.trim()}
              getSearchKeys={(c) => [
                c.first_name,
                c.last_name,
                c.identification_number ?? "",
              ]}
              placeholder="Seleccionar cliente"
              searchPlaceholder="Buscar por nombre o identificación…"
              emptyMessage="Sin clientes que coincidan"
              disabled={savingCustomer}
            />
            {errors.customer_id && (
              <p className="text-sm text-destructive">{errors.customer_id.message}</p>
            )}
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="customer_first_name">Nombre</Label>
              <Input
                id="customer_first_name"
                value={customerDraft.first_name}
                onChange={(e) => setContactField("first_name", e.target.value)}
                disabled={!customerId || savingCustomer}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customer_last_name">Apellido</Label>
              <Input
                id="customer_last_name"
                value={customerDraft.last_name}
                onChange={(e) => setContactField("last_name", e.target.value)}
                disabled={!customerId || savingCustomer}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customer_id_type">Tipo identificación</Label>
              <Select
                value={customerDraft.identification_type}
                onValueChange={(value) =>
                  setContactField("identification_type", value)
                }
                disabled={!customerId || savingCustomer}
              >
                <SelectTrigger id="customer_id_type" className="w-full min-w-0">
                  <SelectValue placeholder="Seleccionar tipo" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ID_TYPE_LABELS).map(([code, label]) => (
                    <SelectItem key={code} value={code}>
                      {code} — {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="customer_identification">Identificación</Label>
              <Input
                id="customer_identification"
                value={customerDraft.identification_number}
                onChange={(e) =>
                  setContactField("identification_number", e.target.value)
                }
                disabled={!customerId || savingCustomer}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customer_phone">Teléfono</Label>
              <Input
                id="customer_phone"
                value={customerDraft.phone}
                onChange={(e) => setContactField("phone", e.target.value)}
                disabled={!customerId || savingCustomer}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="customer_email">Email</Label>
              <Input
                id="customer_email"
                type="email"
                value={customerDraft.email}
                onChange={(e) => setContactField("email", e.target.value)}
                disabled={!customerId || savingCustomer}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Editar afecta los datos del cliente en todas sus reservas.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={handleSaveCustomer}
              disabled={!canSaveCustomer}
            >
              {savingCustomer ? "Guardando..." : "Guardar cliente"}
            </Button>
          </div>
          {customerError && (
            <p className="text-sm text-destructive">{customerError}</p>
          )}
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
              hasUnsavedChanges={hasUnsavedChanges}
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
              onValueChange={(value) =>
                setValue("category_code", value, { shouldDirty: true })
              }
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
              onValueChange={(value) =>
                setValue("rental_company_id", value, { shouldDirty: true })
              }
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
                setValue("booking_type", value, { shouldDirty: true })
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
                onValueChange={(value) =>
                  setValue("pickup_location_id", value, { shouldDirty: true })
                }
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
                onValueChange={(value) =>
                  setValue("return_location_id", value, { shouldDirty: true })
                }
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
                {...register("selected_days", {
                  setValueAs: (v) => (v === "" ? 0 : Number(v)),
                })}
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
                setValue("franchise", value, { shouldDirty: true })
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
                setValue("referral_id", value === "none" ? null : value, {
                  shouldDirty: true,
                })
              }
              disabled={isEditing}
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

          <div className="flex items-center gap-2">
            <Checkbox
              id="total_insurance"
              checked={totalInsurance}
              onCheckedChange={(checked) =>
                setValue("total_insurance", checked === true, {
                  shouldDirty: true,
                })
              }
            />
            <Label htmlFor="total_insurance" className="cursor-pointer">
              Seguro Total
            </Label>
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
                setValue("extra_driver", checked === true, {
                  shouldDirty: true,
                })
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
                setValue("baby_seat", checked === true, {
                  shouldDirty: true,
                })
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
                setValue("wash", checked === true, { shouldDirty: true })
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
              disabled={isEditing}
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
              {...register("coverage_days", {
                setValueAs: (v) => (v === "" ? 0 : Number(v)),
              })}
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
              {...register("extra_hours", {
                setValueAs: (v) => (v === "" ? 0 : Number(v)),
              })}
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
              onClick={() => router.back()}
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
