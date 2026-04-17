import { notFound } from "next/navigation";
import { getReservationForLibro } from "@/lib/queries/reservations";
import { Libro } from "./libro";

export const dynamic = "force-dynamic";

export default async function LibroPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getReservationForLibro(id).catch(() => null);
  if (!data?.reservation) notFound();
  return (
    <Libro
      reservation={data.reservation}
      category={data.category}
      models={data.models}
    />
  );
}
