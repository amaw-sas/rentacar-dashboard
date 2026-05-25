import { getFranchises } from "@/lib/queries/franchises";
import { DataTable } from "@/components/data-table/data-table";
import { ReturnLink } from "@/components/data-table/return-link";
import { Button } from "@/components/ui/button";
import { columns } from "./columns";

export default async function FranchisesPage() {
  const franchises = await getFranchises();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Franquicias</h1>
        <Button asChild>
          <ReturnLink href="/franchises/new">Nueva Franquicia</ReturnLink>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={franchises}
        searchPlaceholder="Buscar franquicia..."
        searchColumn="display_name"
      />
    </div>
  );
}
