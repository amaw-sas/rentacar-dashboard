import { AnalyticsTabNav } from "./tab-nav";

const tabs = [
  { label: "Demanda", href: "/analytics/demand" },
  { label: "Conversión", href: "/analytics/conversion" },
  { label: "Referidos", href: "/analytics/referrals" },
  { label: "Revenue", href: "/analytics/revenue" },
  { label: "Precios", href: "/analytics/pricing" },
];

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Analytics</h1>
      <AnalyticsTabNav tabs={tabs} />
      {children}
    </div>
  );
}
