import Link from "next/link";
import { notFound } from "next/navigation";
import { getCity } from "@/lib/queries/cities";
import { getVisibleCategoriesForCity } from "@/lib/queries/category-city-visibility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function CityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let city;
  try {
    city = await getCity(id);
  } catch {
    notFound();
  }

  const visibleCategories = await getVisibleCategoriesForCity(id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{city.name}</h1>
        <Button asChild>
          <Link href={`/cities/${id}/edit`}>Editar</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Informacion General</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground">Nombre</p>
            <p className="font-medium">{city.name}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Slug</p>
            <p className="font-medium">{city.slug}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Estado</p>
            <Badge
              variant={city.status === "active" ? "default" : "secondary"}
            >
              {city.status === "active" ? "Activa" : "Inactiva"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Categorias disponibles</CardTitle>
        </CardHeader>
        <CardContent>
          {visibleCategories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay categorias disponibles en esta ciudad.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full caption-bottom text-sm">
                <thead className="border-b border-border bg-muted/50">
                  <tr>
                    <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                      Categoria
                    </th>
                    <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                      Codigo
                    </th>
                    <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                      Rentadora
                    </th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {visibleCategories.map((cat) => (
                    <tr
                      key={cat.id}
                      className="border-b border-border transition-colors hover:bg-muted/50"
                    >
                      <td className="px-3 py-2 align-middle">
                        <Link
                          href={`/categories/${cat.id}`}
                          className="font-medium hover:underline"
                        >
                          {cat.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 align-middle">{cat.code}</td>
                      <td className="px-3 py-2 align-middle">
                        {cat.rental_companies?.name ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
