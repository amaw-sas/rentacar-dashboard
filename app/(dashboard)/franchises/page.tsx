import Link from "next/link";
import { getFranchises } from "@/lib/queries/franchises";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { columns } from "./columns";

export default async function FranchisesPage() {
  const franchises = await getFranchises();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Franquicias</h1>
        <Button asChild>
          <Link href="/franchises/new">Nueva Franquicia</Link>
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
