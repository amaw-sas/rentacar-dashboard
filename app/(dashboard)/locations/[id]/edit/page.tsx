import { notFound } from "next/navigation";
import { getLocation } from "@/lib/queries/locations";
import { getRentalCompanies } from "@/lib/queries/rental-companies";
import { getCities } from "@/lib/queries/cities";
import { LocationForm } from "@/components/forms/location-form";

export default async function EditLocationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let location;
  try {
    location = await getLocation(id);
  } catch {
    notFound();
  }

  const [rentalCompanies, cities] = await Promise.all([
    getRentalCompanies(),
    getCities(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Editar Sucursal</h1>
      <LocationForm
        defaultValues={location}
        id={id}
        rentalCompanies={rentalCompanies}
        cities={cities}
      />
    </div>
  );
}
