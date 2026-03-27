import Link from "next/link";
import { getReservations } from "@/lib/queries/reservations";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { columns } from "./columns";

export default async function ReservationsPage() {
  const reservations = await getReservations();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reservas</h1>
        <Button asChild>
          <Link href="/reservations/new">Nueva Reserva</Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={reservations}
        searchPlaceholder="Buscar por cliente..."
        searchColumn="customer"
      />
    </div>
  );
}
