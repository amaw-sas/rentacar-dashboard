import { getRentalCompanies } from "@/lib/queries/rental-companies";
import { LocationForm } from "@/components/forms/location-form";

export default async function NewLocationPage() {
  const rentalCompanies = await getRentalCompanies();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Nueva Sucursal</h1>
      <LocationForm rentalCompanies={rentalCompanies} />
    </div>
  );
}
