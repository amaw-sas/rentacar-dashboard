import { getFranchises } from "@/lib/queries/franchises";
import {
  getCitiesRentalPeriodCounts,
  getCitiesDailySeries,
} from "@/lib/queries/analytics";
import { bogotaTodayYMD } from "@/lib/date/bogota";
import { franchiseColor } from "@/lib/franchises/colors";
import { franchiseShortLabel } from "@/lib/franchises/short-label";
import { CitiesReport } from "./cities-report";

export default async function CitiesAnalyticsPage() {
  const franchises = await getFranchises();
  const active = (franchises ?? []).filter((f) => f.status === "active");
  const codes = active.map((f) => f.code);
  const [data, daily] = await Promise.all([
    getCitiesRentalPeriodCounts(codes),
    getCitiesDailySeries(codes, 7),
  ]);

  // Index matches the dashboard chart's franchise order so the tag colors line
  // up with the trend lines there too.
  const franchiseRefs = active.map((f, i) => ({
    code: f.code,
    label: f.display_name,
    short: franchiseShortLabel(f.display_name),
    color: franchiseColor(f.code, i),
  }));

  return (
    <CitiesReport
      data={data}
      daily={daily}
      todayYMD={bogotaTodayYMD()}
      franchises={franchiseRefs}
    />
  );
}
