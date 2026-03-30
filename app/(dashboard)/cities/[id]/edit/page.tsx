import { notFound } from "next/navigation";
import { getCity } from "@/lib/queries/cities";
import { CityForm } from "@/components/forms/city-form";

export default async function EditCityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let city;
  try {
    city = await getCity(id);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Editar Ciudad</h1>
      <CityForm defaultValues={city} id={id} />
    </div>
  );
}
