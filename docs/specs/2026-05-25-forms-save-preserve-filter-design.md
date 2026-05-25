# Design — Preservar filtros del listado al guardar (return-URL)

- **Fecha:** 2026-05-25
- **Origen:** reporte de operador — al editar una reserva desde un listado filtrado y **Guardar**, el filtro desaparece.
- **Relacionado:** #33 (Cancel/Volver vía `router.back()`), #27/#28/#40/#41 (estado de filtros en URL)
- **Estado:** aprobado para spec → planning

## Problema

Un operador filtra `/reservations`, abre una reserva con **Editar**, cambia un campo y pulsa **Guardar**. Vuelve al listado **sin el filtro**.

Causa raíz (verificada en código): el éxito de guardado de los 8 forms hace `router.push("/<listado>")` — ruta pelada, sin query string. El filtro vive en los searchParams de la URL del listado (escrito vía `window.history.replaceState` en los hooks de URL-state), así que la navegación a la ruta pelada lo descarta.

El fix previo (#33, commit `e7e9b45`) cubrió **solo** Cancelar/Volver (cambió esos handlers a `router.back()`). El post-submit quedó **deliberadamente** en `router.push("/<listado>")`: su SCEN-002 documenta que querían aterrizar siempre en el listado, no en la página de detalle. Esa decisión sigue siendo correcta — lo que falta es conservar el filtro al hacerlo.

## Decisión

**Return-URL en query param.** Al navegar a editar/crear desde un listado, capturar la URL filtrada y pasarla como `?from=<encoded>`. El form, en el éxito de guardado, hace `router.push(safeReturnTo(from, "/<listado>"))`.

Honra las tres intenciones a la vez:
- **Aterrizar siempre en el listado** (intención de #33) — el destino es el listado, no la detalle.
- **Conservar el filtro** (necesidad del operador) — el query string viaja en `from`.
- **Datos frescos** (intención de #33) — `push` a la ruta revalidada por el `revalidatePath` existente refetchea el RSC.

Alternativas descartadas:

- **`router.back()` en guardado (espejo de Cancel):** revierte la decisión consciente de #33 — `back()` aterriza en la página de detalle cuando el edit se abrió desde detalle, y arriesga datos stale en back-nav. Reintroduce exactamente lo que #33 evitó.
- **Breadcrumb en `sessionStorage`:** más liviano (~11 sitios) pero usa estado global implícito per-tab; menos debuggable y menos testeable que un valor explícito en la URL. Descartado por el usuario a favor del enfoque stateless.

Alcance confirmado con el usuario: **los 8 forms** (no solo reservas).

## Diseño

### Componentes nuevos (2)

**1. `lib/navigation/return-to.ts`** — función pura con guard anti open-redirect:

```ts
export function safeReturnTo(
  from: string | null | undefined,
  fallback: string,
): string {
  if (!from) return fallback;
  if (!from.startsWith("/") || from.startsWith("//") || from.includes("\\")) {
    return fallback;
  }
  if (from.split("?")[0] !== fallback) return fallback; // solo el listado propio
  return from;
}
```

El guard `path === fallback` restringe el destino al listado de esa entidad (con cualquier query). El `from` viene de la URL → es atacante-controlable; `router.push` a una URL absoluta navega fuera del sitio, así que el guard es necesario (no opcional): rechaza protocol-relative (`//evil`), absolutas (`https://…`), backslash y rutas a otra sección.

**2. `components/data-table/return-link.tsx`** — client component, drop-in de `<Link>`:

```tsx
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

type ReturnLinkProps = Omit<ComponentProps<typeof Link>, "href"> & { href: string };

export function ReturnLink({ href, onClick, ...props }: ReturnLinkProps) {
  const router = useRouter();
  return (
    <Link
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // new-tab intacto
        e.preventDefault();
        const from = window.location.pathname + window.location.search;
        router.push(`${href}?from=${encodeURIComponent(from)}`);
      }}
      {...props}
    />
  );
}
```

Captura la URL filtrada **en el click** leyendo `window.location` (la barra real, que refleja el `replaceState`), no en render — evita suscribir cada fila a `useSearchParams` y el re-render por keystroke. Click modificado (cmd/ctrl/shift/medio) cae al `<Link href>` plano → abre el edit en pestaña nueva sin `from` (degradación aceptable: el form caerá al fallback).

`href` se tipa como `string` (todos los call sites pasan literales) → sin cast. En React 19 el `ref` que inyecta Radix Slot (`<Button asChild>`) fluye por `{...props}` hasta el `<Link>` interno sin `forwardRef` — mismo tipado que el `<Button asChild><Link>` actual.

### Cambios (24 archivos)

- **8 `columns.tsx`** (Editar de fila): `<Link>` → `<ReturnLink>`.
- **8 `page.tsx`** de listado (botón Nuevo): `<Link>` → `<ReturnLink>`.
- **8 forms** (`components/forms/*-form.tsx`): en el éxito de guardado, leer `from` y reemplazar `router.push("/<listado>")` por:
  ```ts
  const from = new URLSearchParams(window.location.search).get("from");
  router.push(safeReturnTo(from, "/<listado>"));
  ```
  El fallback es la ruta de listado que cada form ya tiene hardcodeada.

  **Por qué `window.location.search` y no `useSearchParams()`:** el handler de guardado es un event handler cliente — lee la URL una sola vez, en el click. `useSearchParams()` es un hook que, en build de producción, **exige envolver el componente en `<Suspense>`** o el build falla (`Missing Suspense boundary`) — rompería el gate de CI (`pnpm build`) en las 5 páginas `new` estáticas (`customers/new`, `referrals/new`, `cities/new`, `rental-companies/new`, `franchises/new`). Leer `window.location` evita el hook, el Suspense, el bailout de render estático y **no requiere tocar ninguna de las 16 páginas edit/new**. (Validado contra docs Next.js 16 en el spec-review.)

### Data flow

1. `/reservations?status=nueva&page=2` (filtro en URL vía `replaceState`) → click Editar → `ReturnLink` hace `router.push("/reservations/<id>/edit?from=%2Freservations%3Fstatus%3Dnueva%26page%3D2")`.
2. El form de edición, al guardar, lee `from` = `/reservations?status=nueva&page=2` desde `window.location.search`.
3. Guardar OK → server action revalida `/reservations` → form hace `router.push(safeReturnTo(from, "/reservations"))` → navega a `/reservations?status=nueva&page=2` → RSC fresco (revalidado) + filtro aplicado vía `useSearchParams`.
4. **Cancelar** sigue con `router.back()` (sin cambios desde #33); el `from` en la URL no lo afecta.

### Invariantes preservados

- **Cancelar/Volver:** intactos — `router.back()` pop-ea la entrada de edit a la URL filtrada anterior, igual que #33. El query `from` no interviene.
- **Aterrizar en el listado:** se mantiene la intención de #33 — el destino siempre es la ruta de listado (nunca la detalle).
- **Datos frescos:** `push` a la ruta revalidada por `revalidatePath` existente refetchea el RSC (sin cambios en server actions).
- **Sin `from` (deep-link / pestaña nueva):** `safeReturnTo` devuelve el fallback → comportamiento idéntico al actual (`/<listado>` pelado).
- **Round-trip de filtros (#40/#41):** sin cambios — los hooks de URL-state y `replaceState` no se tocan.

### Boundaries

Sin cambios en: server actions (`lib/actions/`), queries, schemas Zod, DB/migraciones, hooks de URL-state. El cambio vive en la capa de navegación cliente (links + redirect post-submit de los forms) más una utilidad pura.

## Fuera de alcance

- **Editar desde página de detalle** (`listado → detalle → editar → guardar`): los 5 links Editar de las páginas `[id]/page.tsx` quedan sin `from` → guardar aterriza en listado pelado = **comportamiento actual** (la detalle no porta filtro). Propagar `from` por la cadena detalle es valor marginal a mayor costo; diferido. El bug reportado (`listado → editar → guardar`) queda 100% resuelto.
- Persistencia del filtro entre sesiones / bookmarking del estado de edición.

## Testing

- **Unit (vitest, `tests/unit/navigation/return-to.test.ts`):** `safeReturnTo` — (a) `from` válido del listado propio se devuelve tal cual; (b) `null`/`undefined`/`""` → fallback; (c) protocol-relative `//evil.com` → fallback; (d) absoluta `https://evil.com` → fallback; (e) backslash → fallback; (f) `from` a otra ruta (`/customers` cuando fallback es `/reservations`) → fallback; (g) `from` = exactamente el fallback (sin query) → se devuelve.
- **Runtime (`/agent-browser` + `/dogfood`):** en al menos reservas + un segundo entidad — (1) filtrar listado, Editar fila, cambiar campo, Guardar → URL final conserva el filtro y el registro editado es visible; (2) filtrar listado, Nuevo, crear, Guardar → vuelve al listado filtrado con el registro nuevo; (3) Cancelar conserva el filtro (no-regresión); (4) abrir `/<entity>/<id>/edit` directo (sin `from`) y Guardar → cae al listado pelado sin crash; cero errores de consola / requests fallidos.

## Observable scenarios

1. **Given** `/reservations?status=nueva&page=2` cargado, **when** el operador hace Editar en una fila, cambia un campo y pulsa Guardar con éxito, **then** el navegador queda en `/reservations?status=nueva&page=2` con filtro+sort+page intactos y el registro editado visible.
2. **Given** `/customers?q=lopez` cargado, **when** el operador pulsa Nuevo, completa el form y guarda con éxito, **then** vuelve a `/customers?q=lopez` con el registro nuevo visible.
3. **Given** el form de edición abierto desde un listado filtrado, **when** el operador pulsa Cancelar, **then** `router.back()` lo devuelve al listado filtrado (sin regresión respecto a #33).
4. **Given** el operador abre `/reservations/<id>/edit` directo (sin `from`), **when** guarda con éxito, **then** aterriza en `/reservations` pelado sin error (comportamiento actual preservado).
5. **Given** una URL de edit con `from` hostil (`//evil.com`, `https://evil.com`, o `/customers`), **when** el form guarda con éxito, **then** `safeReturnTo` lo rechaza y navega al listado propio (`/reservations`) — nunca fuera del sitio ni a otra sección.
6. **Given** los 8 forms (reservas, clientes, referidos, ciudades, sucursales, rentadoras, categorías, franquicias), **when** se ejercita el flujo editar/crear desde listado filtrado → guardar, **then** el comportamiento de preservación de filtro es idéntico en todos.
7. **Given** el operador hace cmd/ctrl/shift/medio-click en Editar, **when** se abre en pestaña nueva, **then** `ReturnLink` no hace `preventDefault` y se abre el edit plano sin `from` (la pestaña actual y su filtro quedan intactos).

---
*Evidencia: lectura de código (forms, columns, listing pages, hooks de URL-state) + `git show e7e9b45` (#33). Sin cambios de código aplicados en esta fase.*
