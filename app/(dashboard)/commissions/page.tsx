import Link from "next/link";
import { getCommissions } from "@/lib/queries/commissions";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { columns } from "./columns";
import {
  MATCH_STATUSES,
  PAYMENT_STATUSES,
  MATCH_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/schemas/commission";

export default async function CommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    match_status?: string;
    payment_status?: string;
    import_batch_id?: string;
  }>;
}) {
  const params = await searchParams;
  const commissions = await getCommissions({
    match_status: params.match_status,
    payment_status: params.payment_status,
    import_batch_id: params.import_batch_id,
  });

  const activeMatchStatus = params.match_status;
  const activePaymentStatus = params.payment_status;

  function buildFilterUrl(key: string, value: string | undefined) {
    const p = new URLSearchParams();
    if (params.import_batch_id) p.set("import_batch_id", params.import_batch_id);

    if (key === "match_status") {
      if (value && value !== activeMatchStatus) p.set("match_status", value);
      if (activePaymentStatus) p.set("payment_status", activePaymentStatus);
    } else if (key === "payment_status") {
      if (activeMatchStatus) p.set("match_status", activeMatchStatus);
      if (value && value !== activePaymentStatus) p.set("payment_status", value);
    }

    const qs = p.toString();
    return `/commissions${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Comisiones</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/commissions/imports">Historial de importaciones</Link>
          </Button>
          <Button asChild>
            <Link href="/commissions/import">Importar Excel</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">
          Vinculacion:
        </span>
        {MATCH_STATUSES.map((status) => (
          <Link key={status} href={buildFilterUrl("match_status", status)}>
            <Badge
              variant={activeMatchStatus === status ? "default" : "outline"}
              className="cursor-pointer"
            >
              {MATCH_STATUS_LABELS[status]}
            </Badge>
          </Link>
        ))}

        <span className="ml-4 text-sm font-medium text-muted-foreground">
          Pago:
        </span>
        {PAYMENT_STATUSES.map((status) => (
          <Link key={status} href={buildFilterUrl("payment_status", status)}>
            <Badge
              variant={activePaymentStatus === status ? "default" : "outline"}
              className="cursor-pointer"
            >
              {PAYMENT_STATUS_LABELS[status]}
            </Badge>
          </Link>
        ))}

        {(activeMatchStatus || activePaymentStatus) && (
          <Link
            href={
              params.import_batch_id
                ? `/commissions?import_batch_id=${params.import_batch_id}`
                : "/commissions"
            }
          >
            <Badge variant="secondary" className="cursor-pointer">
              Limpiar filtros
            </Badge>
          </Link>
        )}
      </div>

      <DataTable
        columns={columns}
        data={commissions}
        searchPlaceholder="Buscar por cliente..."
        searchColumn="customer_name_raw"
      />
    </div>
  );
}
