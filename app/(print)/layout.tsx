export default function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="bg-white text-neutral-900 min-h-screen">{children}</div>;
}
