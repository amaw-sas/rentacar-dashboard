import Link from "next/link";
import { notFound } from "next/navigation";
import { getVehicleCategory } from "@/lib/queries/vehicle-categories";
import { getCategoryPricing } from "@/lib/queries/category-pricing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryPricingTable } from "@/components/layout/category-pricing-table";

export default async function CategoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let category;
  try {
    category = await getVehicleCategory(id);
  } catch {
    notFound();
  }

  const pricing = await getCategoryPricing(id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{category.name}</h1>
        <Button asChild>
          <Link href={`/categories/${id}/edit`}>Editar</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Información General</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground">Código</p>
            <p className="font-medium">{category.code}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Rentadora</p>
            <p className="font-medium">
              {category.rental_companies?.name ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Pasajeros</p>
            <p className="font-medium">{category.passenger_count}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Equipaje</p>
            <p className="font-medium">{category.luggage_count}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Transmisión</p>
            <Badge
              variant={
                category.transmission === "automatic" ? "default" : "secondary"
              }
            >
              {category.transmission === "automatic" ? "Automática" : "Manual"}
            </Badge>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Aire Acondicionado</p>
            <p className="font-medium">{category.has_ac ? "Sí" : "No"}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Estado</p>
            <Badge
              variant={
                category.status === "active" ? "default" : "secondary"
              }
            >
              {category.status === "active" ? "Activa" : "Inactiva"}
            </Badge>
          </div>
          {category.description && (
            <div className="sm:col-span-2">
              <p className="text-sm text-muted-foreground">Descripción</p>
              <p className="font-medium">{category.description}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <CategoryPricingTable categoryId={id} pricing={pricing} />
    </div>
  );
}
