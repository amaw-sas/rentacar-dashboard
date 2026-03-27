import { getCustomers } from "@/lib/queries/customers";
import { getRentalCompanies } from "@/lib/queries/rental-companies";
import { getLocations } from "@/lib/queries/locations";
import { getReferrals } from "@/lib/queries/referrals";
import { ReservationForm } from "@/components/forms/reservation-form";

export default async function NewReservationPage() {
  const [customers, rentalCompanies, locations, referrals] = await Promise.all([
    getCustomers(),
    getRentalCompanies(),
    getLocations(),
    getReferrals(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Nueva Reserva</h1>
      <ReservationForm
        customers={customers}
        rentalCompanies={rentalCompanies}
        locations={locations}
        referrals={referrals}
      />
    </div>
  );
}
