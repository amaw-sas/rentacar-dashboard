import { getRentalCompanies } from "@/lib/queries/rental-companies";
import { VehicleCategoryForm } from "@/components/forms/vehicle-category-form";

export default async function NewCategoryPage() {
  const rentalCompanies = await getRentalCompanies();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Nueva Categoría</h1>
      <VehicleCategoryForm rentalCompanies={rentalCompanies} />
    </div>
  );
}
