import Link from "next/link";
import { getReferrals } from "@/lib/queries/referrals";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { columns } from "./columns";

export default async function ReferralsPage() {
  const referrals = await getReferrals();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Referidos</h1>
        <Button asChild>
          <Link href="/referrals/new">Nuevo Referido</Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={referrals}
        searchPlaceholder="Buscar referido..."
        searchColumn="name"
      />
    </div>
  );
}
