import { getRevenueStats } from "@/lib/queries/analytics";
import { RevenueCharts } from "./revenue-charts";

export default async function RevenuePage() {
  const data = await getRevenueStats();
  return <RevenueCharts data={data} />;
}
