import Link from "next/link";
import { getCustomers } from "@/lib/queries/customers";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { columns } from "./columns";

export default async function CustomersPage() {
  const customers = await getCustomers();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clientes</h1>
        <Button asChild>
          <Link href="/customers/new">Nuevo Cliente</Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={customers}
        searchPlaceholder="Buscar por apellido..."
        searchColumn="full_name"
      />
    </div>
  );
}
