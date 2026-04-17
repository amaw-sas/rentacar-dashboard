import Link from "next/link";
import { getReservations } from "@/lib/queries/reservations";
import { getReferrals } from "@/lib/queries/referrals";
import { Button } from "@/components/ui/button";
import { ReservationsTable } from "./reservations-table";
import type { ReservationRow } from "./columns";

export default async function ReservationsPage() {
  const [reservations, referrals] = await Promise.all([
    getReservations(),
    getReferrals(),
  ]);

  const referralOptions = (referrals ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reservas</h1>
        <Button asChild>
          <Link href="/reservations/new">Nueva Reserva</Link>
        </Button>
      </div>

      <ReservationsTable
        data={reservations as unknown as ReservationRow[]}
        referrals={referralOptions}
      />
    </div>
  );
}
