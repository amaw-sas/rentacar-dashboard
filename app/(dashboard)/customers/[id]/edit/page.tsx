import { notFound } from "next/navigation";
import { getCustomer } from "@/lib/queries/customers";
import { CustomerForm } from "@/components/forms/customer-form";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let customer;
  try {
    customer = await getCustomer(id);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Editar Cliente</h1>
      <CustomerForm defaultValues={customer} id={id} />
    </div>
  );
}
