import { notFound } from "next/navigation";
import { getReservation } from "@/lib/queries/reservations";
import { getCustomers } from "@/lib/queries/customers";
import { getRentalCompanies } from "@/lib/queries/rental-companies";
import { getLocations } from "@/lib/queries/locations";
import { getReferrals } from "@/lib/queries/referrals";
import { ReservationForm } from "@/components/forms/reservation-form";

export default async function EditReservationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let reservation;
  try {
    reservation = await getReservation(id);
  } catch {
    notFound();
  }

  const [customers, rentalCompanies, locations, referrals] = await Promise.all([
    getCustomers(),
    getRentalCompanies(),
    getLocations(),
    getReferrals(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Editar Reserva</h1>
      <ReservationForm
        id={id}
        defaultValues={{
          customer_id: reservation.customer_id,
          rental_company_id: reservation.rental_company_id,
          referral_id: reservation.referral_id,
          referral_raw: reservation.referral_raw,
          pickup_location_id: reservation.pickup_location_id,
          return_location_id: reservation.return_location_id,
          franchise: reservation.franchise,
          booking_type: reservation.booking_type,
          reservation_code: reservation.reservation_code,
          reference_token: reservation.reference_token,
          rate_qualifier: reservation.rate_qualifier,
          category_code: reservation.category_code,
          pickup_date: reservation.pickup_date,
          pickup_hour: reservation.pickup_hour,
          return_date: reservation.return_date,
          return_hour: reservation.return_hour,
          selected_days: reservation.selected_days,
          total_price: reservation.total_price,
          total_price_to_pay: reservation.total_price_to_pay,
          total_price_localiza: reservation.total_price_localiza,
          tax_fee: reservation.tax_fee,
          iva_fee: reservation.iva_fee,
          coverage_days: reservation.coverage_days,
          coverage_price: reservation.coverage_price,
          return_fee: reservation.return_fee,
          extra_hours: reservation.extra_hours,
          extra_hours_price: reservation.extra_hours_price,
          total_insurance: reservation.total_insurance,
          extra_driver: reservation.extra_driver,
          baby_seat: reservation.baby_seat,
          wash: reservation.wash,
          aeroline: reservation.aeroline,
          flight_number: reservation.flight_number,
          monthly_mileage: reservation.monthly_mileage,
          notification_required: reservation.notification_required,
          status: reservation.status,
        }}
        customers={customers}
        rentalCompanies={rentalCompanies}
        locations={locations}
        referrals={referrals}
      />
    </div>
  );
}
