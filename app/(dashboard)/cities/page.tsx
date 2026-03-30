import Link from "next/link";
import { getCities } from "@/lib/queries/cities";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { columns } from "./columns";

export default async function CitiesPage() {
  const cities = await getCities();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Ciudades</h1>
        <Button asChild>
          <Link href="/cities/new">Nueva Ciudad</Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={cities}
        searchPlaceholder="Buscar ciudad..."
        searchColumn="name"
      />
    </div>
  );
}
