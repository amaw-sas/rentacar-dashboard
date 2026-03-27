import { notFound } from "next/navigation";
import { getVehicleCategory } from "@/lib/queries/vehicle-categories";
import { getRentalCompanies } from "@/lib/queries/rental-companies";
import { VehicleCategoryForm } from "@/components/forms/vehicle-category-form";

export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let category;
  try {
    category = await getVehicleCategory(id);
  } catch {
    notFound();
  }

  const rentalCompanies = await getRentalCompanies();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Editar Categoría</h1>
      <VehicleCategoryForm
        defaultValues={category}
        id={id}
        rentalCompanies={rentalCompanies}
      />
    </div>
  );
}
