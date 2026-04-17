"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CopyableTextProps {
  value: string | null | undefined;
  label?: string;
  className?: string;
  fallback?: string;
  maxLength?: number;
}

export function CopyableText({
  value,
  label,
  className,
  fallback = "—",
  maxLength,
}: CopyableTextProps) {
  const [copied, setCopied] = useState(false);

  if (!value) {
    return <span className="text-muted-foreground">{fallback}</span>;
  }

  const display =
    maxLength && value.length > maxLength
      ? `${value.slice(0, maxLength - 1)}…`
      : value;
  const ariaLabel = label ? `Copiar ${label}` : "Copiar";

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value!);
      setCopied(true);
      toast.success(label ? `${label} copiado` : "Copiado");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn(
        "group inline-flex items-center gap-1 rounded px-1 -mx-1 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <span className="truncate">{display}</span>
      {copied ? (
        <CheckIcon className="size-3 shrink-0 text-emerald-600" />
      ) : (
        <CopyIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      )}
    </button>
  );
}
