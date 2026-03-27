import { RentalCompanyForm } from "@/components/forms/rental-company-form";

export default function NewRentalCompanyPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Nueva Rentadora</h1>
      <RentalCompanyForm />
    </div>
  );
}
