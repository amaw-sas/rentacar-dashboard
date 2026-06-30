"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { setChatBrandEnabled } from "@/lib/actions/chat-brand-settings";

// Brand display names (mirrors lib/chat/orchestrator/blocks.ts BRAND_NAMES; inlined to
// keep server-only chat code out of this client bundle).
const BRAND_LABELS: Record<string, string> = {
  alquilatucarro: "AlquilaTuCarro",
  alquilame: "Alquílame",
  alquicarros: "AlquiCarros",
};

interface ChatBrandTogglesProps {
  initial: Record<string, boolean>;
}

// Per-brand chat on/off switch. Each row upserts chat_brand_settings via a server action
// (no deploy). Enforcement is gated by CHAT_BRAND_SWITCH; until launch this records intent
// and the toggles read true state. Optimistic update + revert on error. Mirrors the
// knowledge editor's useTransition + toast pattern.
export function ChatBrandToggles({ initial }: ChatBrandTogglesProps) {
  const [state, setState] = useState(initial);
  const [pending, startTransition] = useTransition();

  function toggle(brand: string, next: boolean) {
    const prev = state[brand] ?? false;
    setState((s) => ({ ...s, [brand]: next }));
    startTransition(async () => {
      const res = await setChatBrandEnabled(brand, next);
      if (res.error) {
        setState((s) => ({ ...s, [brand]: prev }));
        toast.error(res.error);
        return;
      }
      const label = BRAND_LABELS[brand] ?? brand;
      toast.success(
        next ? `Chat activado para ${label}` : `Chat pausado para ${label}`,
      );
    });
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="text-lg font-medium">Estado del chat por marca</h2>
        <p className="text-sm text-muted-foreground">
          Enciende o apaga el chat por marca. Apagado, el widget no atiende en esa
          marca. El cambio aplica de inmediato, sin desplegar.
        </p>
      </div>
      <ul className="divide-y">
        {Object.keys(initial).map((brand) => (
          <li key={brand} className="flex items-center justify-between py-2">
            <span className="text-sm font-medium">
              {BRAND_LABELS[brand] ?? brand}
            </span>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <span>{state[brand] ? "Activo" : "Inactivo"}</span>
              <Checkbox
                checked={state[brand] ?? false}
                disabled={pending}
                onCheckedChange={(c) => toggle(brand, c === true)}
              />
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
