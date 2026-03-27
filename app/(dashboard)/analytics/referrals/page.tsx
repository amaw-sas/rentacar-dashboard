import { getReferralPerformance } from "@/lib/queries/analytics";
import { ReferralCharts } from "./referral-charts";

export default async function ReferralsPage() {
  const data = await getReferralPerformance();
  return <ReferralCharts data={data} />;
}
