import Link from "next/link";
import { getRentalCompanies } from "@/lib/queries/rental-companies";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { columns } from "./columns";

export default async function RentalCompaniesPage() {
  const rentalCompanies = await getRentalCompanies();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Rentadoras</h1>
        <Button asChild>
          <Link href="/rental-companies/new">Nueva Rentadora</Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rentalCompanies}
        searchPlaceholder="Buscar rentadora..."
        searchColumn="name"
      />
    </div>
  );
}
