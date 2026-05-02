import Link from "next/link";
import { getReservations } from "@/lib/queries/reservations";
import { getReferrals } from "@/lib/queries/referrals";
import { getCities } from "@/lib/queries/cities";
import { Button } from "@/components/ui/button";
import { ReservationsTable } from "./reservations-table";
import type { ReservationRow } from "./columns";

export default async function ReservationsPage() {
  const [reservations, referrals, cities] = await Promise.all([
    getReservations(),
    getReferrals(),
    getCities(),
  ]);

  const referralOptions = (referrals ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
  }));

  const cityOptions = (cities ?? [])
    .filter((c) => (c.status as string) === "active")
    .map((c) => ({ id: c.id as string, name: c.name as string }));

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
        cities={cityOptions}
      />
    </div>
  );
}
