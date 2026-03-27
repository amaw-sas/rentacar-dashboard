import { notFound } from "next/navigation";
import { getRentalCompany } from "@/lib/queries/rental-companies";
import { RentalCompanyForm } from "@/components/forms/rental-company-form";

export default async function EditRentalCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let rentalCompany;
  try {
    rentalCompany = await getRentalCompany(id);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Editar Rentadora</h1>
      <RentalCompanyForm defaultValues={rentalCompany} id={id} />
    </div>
  );
}
