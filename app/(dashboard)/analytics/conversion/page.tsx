import { getConversionStats } from "@/lib/queries/analytics";
import { ConversionCharts } from "./conversion-charts";

export default async function ConversionPage() {
  const data = await getConversionStats();
  return <ConversionCharts data={data} />;
}
