import { getAttributionBreakdown } from "@/lib/queries/analytics";
import { AttributionCharts } from "./attribution-charts";

export default async function AttributionPage() {
  const data = await getAttributionBreakdown();
  return <AttributionCharts data={data} />;
}
