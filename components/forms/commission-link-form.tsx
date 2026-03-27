"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { linkCommission } from "@/lib/actions/commissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type ReservationResult = {
  id: string;
  reservation_code: string | null;
  status: string;
  total_price: number;
  customers: { first_name: string; last_name: string }[] | null;
};

const copFormat = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 0,
});

export function CommissionLinkForm({
  commissionId,
}: {
  commissionId: string;
}) {
  const router = useRouter();
  const [searchCode, setSearchCode] = useState("");
  const [results, setResults] = useState<ReservationResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    if (!searchCode.trim()) return;
    setSearching(true);
    setError(null);
    setResults([]);

    const supabase = createClient();
    const { data, error: searchError } = await supabase
      .from("reservations")
      .select(
        "id, reservation_code, status, total_price, customers(first_name, last_name)"
      )
      .ilike("reservation_code", `%${searchCode.trim()}%`)
      .limit(10);

    if (searchError) {
      setError(searchError.message);
    } else {
      setResults((data as ReservationResult[]) ?? []);
      if (!data || data.length === 0) {
        setError("No se encontraron reservas con ese codigo");
      }
    }
    setSearching(false);
  }

  async function handleLink(reservationId: string) {
    setLinking(true);
    setError(null);
    const result = await linkCommission(commissionId, reservationId);
    if (result.error) {
      setError(result.error);
      setLinking(false);
    } else {
      router.refresh();
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <h3 className="text-sm font-semibold">Vincular reserva manualmente</h3>

      <div className="space-y-2">
        <Label htmlFor="search_code">Buscar por codigo de reserva</Label>
        <div className="flex gap-2">
          <Input
            id="search_code"
            value={searchCode}
            onChange={(e) => setSearchCode(e.target.value)}
            placeholder="Codigo de reserva..."
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSearch();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSearch}
            disabled={searching}
          >
            {searching ? "Buscando..." : "Buscar"}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((reservation) => (
            <div
              key={reservation.id}
              className="flex items-center justify-between rounded-md border p-2 text-sm"
            >
              <div>
                <span className="font-mono font-medium">
                  {reservation.reservation_code}
                </span>
                {" — "}
                {reservation.customers?.[0]
                  ? `${reservation.customers[0].first_name} ${reservation.customers[0].last_name}`
                  : "Sin cliente"}
                {" — "}
                {copFormat.format(reservation.total_price)}
                {" — "}
                <span className="text-muted-foreground">
                  {reservation.status}
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleLink(reservation.id)}
                disabled={linking}
              >
                Vincular
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
