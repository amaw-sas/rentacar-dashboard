import { notFound } from "next/navigation";
import { getReferral } from "@/lib/queries/referrals";
import { ReferralForm } from "@/components/forms/referral-form";

export default async function EditReferralPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let referral;
  try {
    referral = await getReferral(id);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Editar Referido</h1>
      <ReferralForm defaultValues={referral} id={id} />
    </div>
  );
}
