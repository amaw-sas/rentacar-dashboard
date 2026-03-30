import { CityForm } from "@/components/forms/city-form";

export default function NewCityPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Nueva Ciudad</h1>
      <CityForm />
    </div>
  );
}
