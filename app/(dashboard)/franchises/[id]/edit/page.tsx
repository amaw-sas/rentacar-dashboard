import { notFound } from "next/navigation";
import { getFranchise } from "@/lib/queries/franchises";
import { FranchiseForm } from "@/components/forms/franchise-form";

export default async function EditFranchisePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let franchise;
  try {
    franchise = await getFranchise(id);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Editar Franquicia</h1>
      <FranchiseForm defaultValues={franchise} id={id} />
    </div>
  );
}
