import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PricingPage() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Prediccion de precios</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Este modulo utiliza los datos de{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              search_logs.available_categories
            </code>{" "}
            para construir un historial de precios por categoria, ubicacion y
            fecha.
          </p>
          <p className="text-sm text-muted-foreground">
            Con suficiente volumen de busquedas, se podran identificar patrones
            estacionales, variaciones por ubicacion y tendencias de precios que
            permitan anticipar tarifas futuras.
          </p>
          <div className="flex h-64 items-center justify-center rounded-lg border border-dashed">
            <p className="text-sm text-muted-foreground">
              Graficos de tendencia de precios — proximamente
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
