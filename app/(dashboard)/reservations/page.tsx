import { getReservationsPage } from "@/lib/queries/reservations";
import { getReferrals } from "@/lib/queries/referrals";
import { getCities } from "@/lib/queries/cities";
import { parseListParams } from "@/lib/reservations/list-params";
import { ReturnLink } from "@/components/data-table/return-link";
import { Button } from "@/components/ui/button";
import { ReservationsTable } from "./reservations-table";
import type { ReservationRow } from "./columns";

function toSearchParams(
  sp: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      // Repeated keys: take the first — the URL contract is single-valued.
      if (value[0] !== undefined) out.set(key, value[0]);
    } else {
      out.set(key, value);
    }
  }
  return out;
}

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseListParams(toSearchParams(await searchParams));

  const [page, referrals, cities] = await Promise.all([
    getReservationsPage(params),
    getReferrals(),
    getCities(),
  ]);

  const pageCount = Math.max(1, Math.ceil(page.total / params.pageSize));

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
          <ReturnLink href="/reservations/new">Nueva Reserva</ReturnLink>
        </Button>
      </div>

      <ReservationsTable
        data={page.rows as unknown as ReservationRow[]}
        total={page.total}
        approximate={page.approximate}
        pageCount={pageCount}
        referrals={referralOptions}
        cities={cityOptions}
      />
    </div>
  );
}
