import Link from "next/link";
import { getCommissionImports } from "@/lib/queries/commissions";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { columns } from "./columns";

export default async function CommissionImportsPage() {
  const imports = await getCommissionImports();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Historial de importaciones</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/commissions">Volver a comisiones</Link>
          </Button>
          <Button asChild>
            <Link href="/commissions/import">Nueva importacion</Link>
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={imports}
        searchPlaceholder="Buscar por archivo..."
        searchColumn="file_name"
      />
    </div>
  );
}
