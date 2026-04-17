import Image from "next/image";
import QRCode from "react-qr-code";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { getFranchiseBranding } from "@/lib/constants/franchises";
import { computeLocalizaFinances } from "@/lib/calculations/reservation-finances";
import {
  splitVehicleName,
  formatIncludedFees,
  formatExtras,
  pickVehicleImage,
  type CategoryModelImage,
} from "@/lib/reservation/libro-helpers";

type LibroReservation = {
  id: string;
  franchise: string;
  reservation_code: string | null;
  pickup_date: string;
  pickup_hour: string;
  return_date: string;
  return_hour: string;
  selected_days: number;
  total_price_to_pay: number;
  total_insurance: number | null;
  monthly_mileage: number | null;
  extra_hours_price: number | null;
  return_fee: number | null;
  baby_seat: boolean;
  wash: boolean;
  extra_driver: boolean;
  pickup_location: {
    name: string;
    pickup_address: string;
    return_address: string | null;
    city: string | null;
  } | null;
  return_location: {
    name: string;
    pickup_address: string;
    return_address: string | null;
    city: string | null;
  } | null;
  rental_companies: { name: string } | null;
};

type LibroCategory = { name: string; image_url: string | null } | null;

const currencyFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return format(date, "d 'de' MMM. 'de' yyyy", { locale: es });
}

function formatHour(hour: string) {
  const [hStr = "0", mStr = "0"] = hour.split(":");
  let h = Number(hStr);
  const m = Number(mStr);
  const suffix = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

function renderLocation(
  loc: LibroReservation["pickup_location"],
  companyName: string | undefined,
  kind: "pickup" | "return" = "pickup",
) {
  if (!loc) return "—";
  const address =
    kind === "return" ? (loc.return_address ?? loc.pickup_address) : loc.pickup_address;
  const parts = [loc.name, address].filter(Boolean).join(" ");
  return companyName ? `${parts} - ${companyName}` : parts;
}

export function Libro({
  reservation,
  category,
  models,
}: {
  reservation: LibroReservation;
  category: LibroCategory;
  models: CategoryModelImage[] | null;
}) {
  const branding = getFranchiseBranding(reservation.franchise);
  const color = branding.color;
  const finances = computeLocalizaFinances(
    Number(reservation.total_price_to_pay ?? 0),
    Number(reservation.return_fee ?? 0),
    Number(reservation.extra_hours_price ?? 0),
  );
  const includedFees = formatIncludedFees({
    selected_days: reservation.selected_days,
    total_insurance: reservation.total_insurance,
    monthly_mileage: reservation.monthly_mileage,
  });
  const extras = formatExtras({
    baby_seat: reservation.baby_seat,
    wash: reservation.wash,
    extra_driver: reservation.extra_driver,
  });
  const [vehicleLine1, vehicleLine2] = splitVehicleName(category?.name ?? "");
  const vehicleImage = pickVehicleImage(category, models);
  const companyName = reservation.rental_companies?.name ?? "";
  const reservationCode = reservation.reservation_code ?? "";

  return (
    <div className="libro mx-auto flex min-h-screen w-full max-w-[1280px] flex-col bg-white text-neutral-900">
      <div className="libro-bar h-10 w-full" style={{ background: color }} />

      <div className="grid flex-1 grid-cols-2 gap-12 px-12 py-10">
        <section className="space-y-6">
          <div
            className="-mt-16 flex h-44 w-44 items-center justify-center bg-white p-3 shadow-sm"
          >
            {reservationCode ? (
              <QRCode
                value={reservationCode}
                size={152}
                style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                viewBox="0 0 152 152"
              />
            ) : null}
          </div>

          <div>
            <p className="text-lg">Código de Reserva</p>
            <p className="text-3xl font-bold tracking-tight">
              {reservationCode || "—"}
            </p>
          </div>

          <FieldRow label="Fecha recogida" value={formatDate(reservation.pickup_date)} />
          <FieldRow label="Hora recogida" value={formatHour(reservation.pickup_hour)} />
          <FieldRow
            label="Lugar recogida"
            value={renderLocation(reservation.pickup_location, companyName, "pickup")}
            multiline
          />

          <FieldRow label="Fecha retorno" value={formatDate(reservation.return_date)} />
          <FieldRow label="Hora retorno" value={formatHour(reservation.return_hour)} />
          <FieldRow
            label="Lugar retorno"
            value={renderLocation(reservation.return_location, companyName, "return")}
            multiline
          />
        </section>

        <section className="space-y-6">
          <h2 className="text-center text-2xl font-bold">
            Datos del Vehículo
          </h2>
          <div className="flex items-center justify-center gap-6">
            {vehicleImage ? (
              <Image
                src={vehicleImage}
                alt={category?.name ?? ""}
                width={220}
                height={120}
                unoptimized
                className="h-auto w-[220px] object-contain"
              />
            ) : (
              <div className="h-[120px] w-[220px] bg-neutral-100" />
            )}
            <div className="leading-tight">
              <p className="text-xl font-semibold">{vehicleLine1}</p>
              {vehicleLine2 ? (
                <p className="text-xl font-semibold">{vehicleLine2}</p>
              ) : null}
            </div>
          </div>

          <h2 className="text-center text-2xl font-bold">
            Datos Financieros
          </h2>
          <dl className="space-y-1 text-base">
            <FinanceRow label="Tarifa:" value={currencyFormatter.format(finances.tarifa)} />
            <FinanceRow label="Subtotal:" value={currencyFormatter.format(finances.subtotal)} />
            <FinanceRow
              label="+ Tasa Admin (10%):"
              value={currencyFormatter.format(finances.tax)}
            />
            <FinanceRow
              label="+ Impuesto IVA (19%):"
              value={currencyFormatter.format(finances.iva)}
            />
            <FinanceRow label="Total a pagar:" value={currencyFormatter.format(finances.total)} />
          </dl>

          <div>
            <p className="font-semibold">El valor Incluye:</p>
            <p>{includedFees}</p>
          </div>

          {extras.length > 0 ? (
            <div>
              <p className="font-semibold">Extras:</p>
              <ul className="list-disc pl-5">
                {extras.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <p className="font-semibold">Método de Pago:</p>
            <p>Tarjeta de Crédito en Sede</p>
          </div>
        </section>
      </div>

      <div className="libro-bar mt-auto h-10 w-full" style={{ background: color }} />
    </div>
  );
}

function FieldRow({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <span className="shrink-0 pt-1">{label}:</span>
      <span
        className={
          multiline
            ? "text-lg leading-snug"
            : "text-2xl font-bold"
        }
      >
        {value}
      </span>
    </div>
  );
}

function FinanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-neutral-200 py-1">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
