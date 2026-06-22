import { getFranchises } from "@/lib/queries/franchises";
import { getCitiesRentalPeriodCounts } from "@/lib/queries/analytics";
import { franchiseColor } from "@/lib/franchises/colors";
import { franchiseShortLabel } from "@/lib/franchises/short-label";
import { CitiesReport } from "./cities-report";

export default async function CitiesAnalyticsPage() {
  const franchises = await getFranchises();
  const active = (franchises ?? []).filter((f) => f.status === "active");
  const codes = active.map((f) => f.code);
  const data = await getCitiesRentalPeriodCounts(codes);

  // Index matches the dashboard chart's franchise order so the tag colors line
  // up with the trend lines there too.
  const franchiseRefs = active.map((f, i) => ({
    code: f.code,
    label: f.display_name,
    short: franchiseShortLabel(f.display_name),
    color: franchiseColor(f.code, i),
  }));

  return <CitiesReport data={data} franchises={franchiseRefs} />;
}
