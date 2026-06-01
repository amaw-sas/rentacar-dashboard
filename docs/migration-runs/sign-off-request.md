# Solicitud de firma — migración de reservas legacy a producción (#23)

Documento para que Producto apruebe la migración. Listo para reenviar tal cual.

---

## Qué se aprueba

Migrar el histórico de reservas del sistema legacy a producción, aceptando que un **4.03 % no migra**.

## Los números

Validados en un dry-run completo sobre una copia del esquema de producción (2026-05-29; reporte en `dry-run-2026-05-29.md`):

- 12,967 reservas en legacy → **12,445 migran (95.97 %)**.
- **522 no migran (4.03 %):**
  - 354 sin ubicación de recogida resoluble en legacy.
  - 47 sin ubicación de devolución.
  - 121 de clientes basura (cédulas placeholder, ya descartados en la migración de customers #19).

## Por qué ese 4.03 % es seguro de perder

- **97 % es histórico 2024–2025** — alquileres ya consumidos, sin operación viva detrás.
- El 3 % restante son **15 reservas de 2026, verificadas una por una**: todas de prueba o de operador (cédulas tipo "123456", emails internos, nombres "prueba1" a "prueba8"). **Cero clientes reales y activos.**

La verificación caso por caso de esas 15 está en `dry-run-2026-05-29.md`, sección "Perfil temporal de los rechazos".

## Riesgo de la operación

Bajo. La corrida es reversible (rollback por marcador, borra solo lo que inserta), idempotente (re-correrla no duplica), dura ~30 segundos y se ejecuta en una ventana de tráfico bajo. Los customers ya están en producción desde #19, así que esta migración solo toca reservas.

## Firma

Producto: __________________________   Fecha: __________

Acepto el 4.03 % de pérdida descrito arriba y autorizo la migración de reservas a producción.
