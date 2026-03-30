import { FranchiseForm } from "@/components/forms/franchise-form";

export default function NewFranchisePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Nueva Franquicia</h1>
      <FranchiseForm />
    </div>
  );
}
