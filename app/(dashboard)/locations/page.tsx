import Link from "next/link";
import { getLocations } from "@/lib/queries/locations";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { columns } from "./columns";

export default async function LocationsPage() {
  const locations = await getLocations();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sucursales</h1>
        <Button asChild>
          <Link href="/locations/new">Nueva Sucursal</Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={locations}
        searchPlaceholder="Buscar sucursal..."
        searchColumn="name"
      />
    </div>
  );
}
