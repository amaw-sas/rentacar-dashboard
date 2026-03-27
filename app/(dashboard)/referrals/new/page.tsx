import { ReferralForm } from "@/components/forms/referral-form";

export default function NewReferralPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Nuevo Referido</h1>
      <ReferralForm />
    </div>
  );
}
