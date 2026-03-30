"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  updateVisibilityMode,
  updateCategoryVisibility,
} from "@/lib/actions/category-city-visibility";

interface CategoryVisibilitySectionProps {
  categoryId: string;
  currentMode: "all" | "restricted";
  visibleCityIds: string[];
  allCities: { id: string; name: string }[];
}

export function CategoryVisibilitySection({
  categoryId,
  currentMode,
  visibleCityIds,
  allCities,
}: CategoryVisibilitySectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [checkedCities, setCheckedCities] = useState<Set<string>>(
    new Set(visibleCityIds)
  );

  function handleToggleCity(cityId: string, checked: boolean) {
    setCheckedCities((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(cityId);
      } else {
        next.delete(cityId);
      }
      return next;
    });
  }

  function handleRestrict() {
    startTransition(async () => {
      const result = await updateVisibilityMode(categoryId, "restricted");
      if (!result.error) {
        router.refresh();
      }
    });
  }

  function handleAllCities() {
    startTransition(async () => {
      const result = await updateVisibilityMode(categoryId, "all");
      if (!result.error) {
        router.refresh();
      }
    });
  }

  function handleSaveVisibility() {
    startTransition(async () => {
      const result = await updateCategoryVisibility(
        categoryId,
        Array.from(checkedCities)
      );
      if (!result.error) {
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Visibilidad por Ciudad</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {currentMode === "all" ? (
          <div className="space-y-4">
            <Badge
              variant="default"
              className="bg-green-600 hover:bg-green-700"
            >
              Disponible en todas las ciudades
            </Badge>
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRestrict}
                disabled={isPending}
              >
                {isPending ? "Actualizando..." : "Restringir"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
              Visibilidad restringida
            </Badge>

            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
              {allCities.map((city) => (
                <div key={city.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`city-${city.id}`}
                    checked={checkedCities.has(city.id)}
                    onCheckedChange={(checked) =>
                      handleToggleCity(city.id, checked === true)
                    }
                    disabled={isPending}
                  />
                  <Label htmlFor={`city-${city.id}`} className="font-normal">
                    {city.name}
                  </Label>
                </div>
              ))}
            </div>

            {allCities.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No hay ciudades registradas. Crea ciudades primero.
              </p>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSaveVisibility}
                disabled={isPending}
              >
                {isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleAllCities}
                disabled={isPending}
              >
                {isPending ? "Actualizando..." : "Todas las ciudades"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
