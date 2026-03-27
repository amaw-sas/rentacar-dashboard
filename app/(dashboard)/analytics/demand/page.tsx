import { getDemandStats } from "@/lib/queries/analytics";
import { DemandCharts } from "./demand-charts";

export default async function DemandPage() {
  const data = await getDemandStats();
  return <DemandCharts data={data} />;
}
