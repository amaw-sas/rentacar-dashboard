"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { importCommissions } from "@/lib/actions/commissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";

type RentalCompany = {
  id: string;
  name: string;
};

type ImportResult = {
  importId: string;
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
};

export default function ImportCommissionsPage() {
  const [rentalCompanies, setRentalCompanies] = useState<RentalCompany[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    async function loadCompanies() {
      const supabase = createClient();
      const { data } = await supabase
        .from("rental_companies")
        .select("id, name")
        .eq("status", "active")
        .order("name");
      setRentalCompanies(data ?? []);
    }
    loadCompanies();
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);

    try {
      const response = await importCommissions(formData);
      if (response.error) {
        setError(response.error);
      } else {
        setResult({
          importId: response.importId!,
          totalRows: response.totalRows!,
          matchedRows: response.matchedRows!,
          unmatchedRows: response.unmatchedRows!,
        });
      }
    } catch {
      setError("Error inesperado al importar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Importar comisiones</h1>
        <Button variant="outline" asChild>
          <Link href="/commissions">Volver a comisiones</Link>
        </Button>
      </div>

      {!result ? (
        <Card className="max-w-lg p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rental_company_id">Rentadora</Label>
              <select
                id="rental_company_id"
                name="rental_company_id"
                required
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Seleccionar rentadora...</option>
                {rentalCompanies.map((rc) => (
                  <option key={rc.id} value={rc.id}>
                    {rc.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="period_label">Periodo (opcional)</Label>
              <Input
                id="period_label"
                name="period_label"
                placeholder="Ej: Enero 2026"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="file">Archivo Excel (.xlsx)</Label>
              <Input
                id="file"
                name="file"
                type="file"
                accept=".xlsx"
                required
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button type="submit" disabled={loading}>
              {loading ? "Importando..." : "Importar"}
            </Button>
          </form>
        </Card>
      ) : (
        <Card className="max-w-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold">Importacion completada</h2>

          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold">{result.totalRows}</p>
              <p className="text-sm text-muted-foreground">Total</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">
                {result.matchedRows}
              </p>
              <p className="text-sm text-muted-foreground">Vinculadas</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-600">
                {result.unmatchedRows}
              </p>
              <p className="text-sm text-muted-foreground">Sin vincular</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="default">
              {Math.round((result.matchedRows / result.totalRows) * 100)}% vinculadas
            </Badge>
          </div>

          <div className="flex gap-2">
            <Button asChild>
              <Link
                href={`/commissions?import_batch_id=${result.importId}`}
              >
                Ver comisiones importadas
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/commissions/import">Importar otro archivo</Link>
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
