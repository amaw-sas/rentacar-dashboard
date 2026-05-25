import { getVehicleCategories } from "@/lib/queries/vehicle-categories";
import { DataTable } from "@/components/data-table/data-table";
import { ReturnLink } from "@/components/data-table/return-link";
import { Button } from "@/components/ui/button";
import { columns } from "./columns";

export default async function CategoriesPage() {
  const categories = await getVehicleCategories();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Categorías de Vehículos</h1>
        <Button asChild>
          <ReturnLink href="/categories/new">Nueva Categoría</ReturnLink>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={categories}
        searchPlaceholder="Buscar categoría..."
        searchColumn="name"
      />
    </div>
  );
}
