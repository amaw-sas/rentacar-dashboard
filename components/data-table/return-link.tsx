"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

type ReturnLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
};

/**
 * Drop-in replacement for next/link's <Link> on "Editar"/"Nuevo" links.
 *
 * On a plain left-click it reads the live address bar (window.location, which
 * mirrors the filter state written via replaceState) and navigates to
 * `${href}?from=<encoded current URL>` so the form can return the operator to
 * the filtered listing after a successful save. A modified click
 * (cmd/ctrl/shift or non-primary button) is left untouched, so the plain
 * <Link href> opens a new tab without a `from` (graceful fallback).
 *
 * Props and ref forward to the inner <Link> via `{...props}`, so it keeps
 * working under Radix `<Button asChild>` (Slot) — no forwardRef needed in React 19.
 *
 * `href` must be a query-less path (every edit/new route is, e.g.
 * `/reservations/<id>/edit`); the `?from=` is appended directly, so a pre-existing
 * query on `href` would collide.
 */
export function ReturnLink({ href, onClick, ...props }: ReturnLinkProps) {
  const router = useRouter();
  return (
    <Link
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        const from = window.location.pathname + window.location.search;
        router.push(`${href}?from=${encodeURIComponent(from)}`);
      }}
      {...props}
    />
  );
}
