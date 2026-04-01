import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getVehicleCategory } from "@/lib/queries/vehicle-categories";
import { getCategoryPricing } from "@/lib/queries/category-pricing";
import { getCategoryModels } from "@/lib/queries/category-models";
import { getCategoryVisibility } from "@/lib/queries/category-city-visibility";
import { getCities } from "@/lib/queries/cities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryPricingTable } from "@/components/layout/category-pricing-table";
import { CategoryModelsTable } from "@/components/layout/category-models-table";
import { CategoryVisibilitySection } from "@/components/layout/category-visibility-section";

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

  const [pricing, models, visibleCityIds, allCities] = await Promise.all([
    getCategoryPricing(id),
    getCategoryModels(id),
    getCategoryVisibility(id),
    getCities(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3"><Button variant="outline" size="icon" asChild><Link href="/categories"><ArrowLeft className="h-4 w-4" /></Link></Button><h1 className="text-2xl font-semibold">{category.name}</h1></div>
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

      <CategoryModelsTable categoryId={id} models={models} />

      <CategoryPricingTable categoryId={id} pricing={pricing} />

      <CategoryVisibilitySection
        categoryId={id}
        currentMode={
          (category.visibility_mode as "all" | "restricted") ?? "all"
        }
        visibleCityIds={visibleCityIds}
        allCities={allCities.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
