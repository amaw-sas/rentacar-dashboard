# Comparación: PDF Localiza 2026 vs BD `vehicle_categories`

> Excluidas por petición: **QR, P, VP, GR**.
> Fuente PDF: `docs/localiza/gamas-2026.md`.
> Fuente BD: Supabase `rentacar-dashboard` (proyecto `ilhdholjrnbycyvejsub`), tablas `vehicle_categories` + `category_models` filtradas por `rental_companies.name = 'Localiza'`.
> Snapshot: 2026-05-05.

---

## Resumen ejecutivo

| Estado | Gamas | Detalle |
|--------|-------|---------|
| ✅ Coinciden (gama presente en ambos) | 11 | C, CX, F, FL, FU, FX, G4, GC, GL, GY, LE |
| ❌ Falta en BD (presente solo en PDF) | 1 | **LU** (SUV Híbrida Libre PYP) |
| ⚠️ Solo en BD (ya no en flota PDF) | 4 | G, GX, LP, LY (las 4 ya están `inactive` en BD ✓) |
| ⚠️ Coincide la gama, pero los modelos divergen | 9 | F, FL, FX, FU, G4, GC, GL, LE, GY (parcial), CX (parcial) |
| ✅ Modelos idénticos | 3 | C, CX (1 modelo), GY (1 modelo) |

**Acciones críticas**:
1. Crear gama **LU** + 2 modelos.
2. Agregar **15+ modelos nuevos** repartidos en F, FL, FX, FU, G4, GC, GL, LE.
3. Renombrar **FL** en BD ("Compacto Mecánico Híbrido" → "Intermedio Mecánico Libre PYP" — ya no es híbrido ni compacto).
4. Diferenciar nombres BD de **GC** y **GL** (hoy ambas se llaman "Camioneta Automática"; el PDF distingue GC vs GL Libre PYP).
5. Reasignar modelos mal catalogados (ver detalle por gama).

---

## Diferencias por gama

### Gama C — Económico
| | PDF | BD |
|---|-----|----|
| Modelos | Renault Kwid, KIA Picanto, Fiat Mobi | Fiat Mobi 1.0 (default), Kia Picanto 1.0, Renault Kwid 1.0 |
| Veredicto | ✅ **Idéntico** (los 3 modelos coinciden) | |

### Gama CX — Económico Automático
| | PDF | BD |
|---|-----|----|
| Modelos | KIA Picanto Zenith | Kia Picanto Zenith (default) |
| Veredicto | ✅ **Idéntico** | |

### Gama F — Intermedio Mecánico
| | PDF | BD |
|---|-----|----|
| Modelos | KIA Soluto Emotion MT, Chevrolet Onix Turbo MT 1.0, Renault Logan | Suzuki Swift Dzire 1.2 (default), Gol Trendline 1.6, Hyundai Accent 1.6, Renault Logan 1.6 |
| Coinciden | Renault Logan ✓ | |
| Faltan en BD | KIA Soluto Emotion MT, Chevrolet Onix Turbo MT 1.0 | |
| Sobran en BD (reubicar) | Suzuki Swift Dzire 1.2 → ahora en gama **FX** del PDF; Hyundai Accent 1.6 → ahora en **FU**; Gol Trendline 1.6 (no figura en flota nueva) | |
| Veredicto | ⚠️ **Reescritura mayor del catálogo de modelos** | |

### Gama FL — Intermedio Mecánico Libre PYP
| | PDF | BD |
|---|-----|----|
| Modelos | KIA Soluto Emotion MT, Renault Logan, Chevrolet Onix Turbo MT 1.0 | Fiat Mobi (default), Kia Picanto, Renault Kwid, Suzuki S-Presso |
| Coinciden | — (ninguno) | |
| Faltan en BD | KIA Soluto Emotion MT, Renault Logan, Chevrolet Onix Turbo MT 1.0 | |
| Sobran en BD | Fiat Mobi, Kia Picanto, Renault Kwid (estos pertenecen a gama **C** según PDF), Suzuki S-Presso (no figura en flota nueva) | |
| Nombre en BD | "Gama FL Compacto Mecánico Híbrido" — ❌ inexacto: no es compacto ni híbrido en el PDF | |
| Veredicto | ⚠️ **Catálogo y nombre incorrectos — reescritura completa** | |

### Gama FX — Intermedio Automático
| | PDF | BD |
|---|-----|----|
| Modelos | Chevrolet Onix Turbo AT 1.0, KIA Soluto Emotion AT, Suzuki Baleno, Suzuki Swift Dzire GL, Renault Logan AT | Hyundai Accent 1.6 AT (default), Kia Rio 1.4, Logan Dynamique 1.6 AT, Suzuki Dzire 1.2 AT |
| Coinciden (aprox.) | Renault Logan AT ✓, Suzuki Swift Dzire ✓ | |
| Faltan en BD | Chevrolet Onix Turbo AT 1.0, KIA Soluto Emotion AT, Suzuki Baleno | |
| Sobran en BD | Hyundai Accent 1.6 AT → ahora pertenece a **FU**; Kia Rio 1.4 (no figura en flota nueva) | |
| Veredicto | ⚠️ **Actualizar catálogo** | |

### Gama FU — Intermedio Automático Libre PYP
| | PDF | BD |
|---|-----|----|
| Modelos | Chevrolet Onix Turbo MT 1.0, Hyundai Accent Advance, Suzuki Baleno, KIA Soluto Emotion AT | Hyundai Accent 1.6 AT (default), Kia Rio 1.4, Logan Dynamique 1.6 AT, Suzuki Dzire 1.2 AT |
| Coinciden | Hyundai Accent ✓ | |
| Faltan en BD | Chevrolet Onix Turbo MT 1.0, Suzuki Baleno, KIA Soluto Emotion AT | |
| Sobran en BD | Kia Rio 1.4, Logan AT, Suzuki Dzire AT (estos están en **FX** según PDF; o no figuran) | |
| Veredicto | ⚠️ **Reasignar modelos** | |

### Gama G4 — SUV Mecánica 4x4
| | PDF | BD |
|---|-----|----|
| Modelos | Renault Duster 1.3 Turbo (2024-2025), Suzuki Jimny (desde abril 2026) | Renault Duster Dynamique 2.0 (default), Suzuki Vitara 1.6 |
| Coinciden | Renault Duster (con cilindrada distinta: PDF 1.3 Turbo vs BD 2.0) | |
| Faltan en BD | Suzuki Jimny | |
| Sobran en BD | Suzuki Vitara 1.6 (en PDF aparece en **GC** y **GL**, no en G4) | |
| Veredicto | ⚠️ **Actualizar Duster, agregar Jimny, mover Vitara** | |

### Gama GC — SUV Compacto Automático
| | PDF | BD |
|---|-----|----|
| Modelos | Chevrolet Tracker Turbo, Nissan Kicks Play, Hyundai Kona, Seat Arona, Opel Crossland, Fiat Pulse, Fiat Pulse Impetus, Suzuki Vitara | Hyundai Creta 1.6 (default), Arona 1.6 AT, Fiat Pulse 1.0, Suzuki Vitara 1.6 |
| Coinciden | Seat Arona ✓, Fiat Pulse ✓, Suzuki Vitara ✓ | |
| Faltan en BD | Chevrolet Tracker Turbo, Nissan Kicks Play, Hyundai Kona, Opel Crossland, Fiat Pulse Impetus (5 modelos) | |
| Sobran en BD | Hyundai Creta 1.6 (no figura en flota nueva) | |
| Veredicto | ⚠️ **Catálogo desactualizado — agregar 5, retirar 1** | |

### Gama GL — SUV Compacto Automático Libre PYP
| | PDF | BD |
|---|-----|----|
| Modelos | Hyundai Kona, Chevrolet Tracker Turbo, Suzuki Vitara, Seat Arona, Fiat Pulse Impetus | Renault Duster 1.3 (default), Suzuki Vitara 1.6 |
| Coinciden | Suzuki Vitara ✓ | |
| Faltan en BD | Hyundai Kona, Chevrolet Tracker Turbo, Seat Arona, Fiat Pulse Impetus | |
| Sobran en BD | Renault Duster 1.3 (en PDF está en **G4**, no en GL) | |
| Veredicto | ⚠️ **Reescritura del catálogo** | |

### Gama GY — SUV Híbrido (7 pasajeros)
| | PDF | BD |
|---|-----|----|
| Modelos | Hyundai Santa Fé AT 1.6 | Hyundai Santa Fe 1.6 (default) |
| Veredicto | ✅ **Idéntico** (typo: BD "Fe" sin tilde — sin impacto funcional) | |

### Gama LE — SUV Especial
| | PDF | BD |
|---|-----|----|
| Modelos | Nissan Qashqai, KIA Sportage Desire, Citroën C5 Aircross Unique, Hyundai Tucson, Ford Escape Titanium | Renault Koleos 2.5 (default), Hyundai Tucson 2.0, Kia Sportage 2.0 AT, Nissan Qashqai 2.0 |
| Coinciden | Nissan Qashqai ✓, Hyundai Tucson ✓, Kia Sportage ✓ | |
| Faltan en BD | Citroën C5 Aircross Unique, Ford Escape Titanium | |
| Sobran en BD | Renault Koleos 2.5 (no figura en flota nueva) — además es el `is_default` actual | |
| Veredicto | ⚠️ **Agregar 2, reasignar default** | |

### Gama LU — SUV Híbrida Libre PYP ❌ NUEVA
| | PDF | BD |
|---|-----|----|
| Modelos | Suzuki Grand Vitara Híbrido Mhev, Renault Arkana E-Tech Hybrid | — gama no existe |
| Veredicto | ❌ **Crear gama + ambos modelos** | |

---

## Categorías solo en BD (no en PDF nueva flota)

Todas ya están `inactive` en la BD — coherente, pero documentar para auditoría:

| Code | Nombre BD | Estado | Modelos asignados |
|------|-----------|--------|-------------------|
| G    | Camioneta Mecánica           | inactive | Seat Arona 1.0 (Arona ahora va en GC/GL) |
| GX   | Camioneta Automática 4x2     | inactive | Suzuki Vitara 1.5 |
| LP   | Sedán Automático Híbrido     | inactive | Toyota Corolla Híbrido |
| LY   | Sedán Automático Eléctrico   | inactive | Renault Zoe |

> Si el modelo Excel de Localiza ya no usa estos códigos, se pueden mantener `inactive` (no eliminar) para preservar la integridad referencial con reservas históricas.

---

## Inconsistencias de naming en BD

| Code | Nombre BD actual | Nombre sugerido (PDF) |
|------|------------------|----------------------|
| FL   | Gama FL Compacto Mecánico Híbrido | Gama FL Intermedio Mecánico Libre PYP |
| FU   | Gama FU Sedán Automático          | Gama FU Intermedio Automático Libre PYP |
| GC   | Gama GC Camioneta Automática      | Gama GC SUV Compacto Automático |
| GL   | Gama GL Camioneta Automática      | Gama GL SUV Compacto Automático Libre PYP |
| LE   | Gama LE Camioneta Automática Especial | Gama LE SUV Especial |
| GY   | Gama GY SUV Automática 7 puestos  | Gama GY SUV Híbrido 7 puestos |

---

## Punch list (acción concreta)

1. **Crear gama LU** en `vehicle_categories` (transmission=automatic, passenger_count=5).
2. **Insertar 2 modelos LU**: Suzuki Grand Vitara Híbrido Mhev (default), Renault Arkana E-Tech Hybrid.
3. **Renombrar FL, FU, GC, GL, LE, GY** según tabla de inconsistencias.
4. **Actualizar `category_models`**:
   - F: agregar Soluto MT + Onix MT; retirar Swift Dzire MT, Gol Trendline, Accent MT.
   - FL: agregar Soluto MT, Logan, Onix MT; retirar Mobi/Picanto/Kwid/S-Presso.
   - FX: agregar Onix AT, Soluto AT, Baleno; retirar Accent AT, Rio.
   - FU: agregar Onix MT, Baleno, Soluto AT; retirar Rio, Logan AT, Dzire AT.
   - G4: agregar Jimny; cambiar Duster 2.0 → Duster 1.3 Turbo; retirar Vitara.
   - GC: agregar Tracker Turbo, Kicks Play, Kona, Crossland, Pulse Impetus; retirar Creta.
   - GL: agregar Kona, Tracker Turbo, Arona, Pulse Impetus; retirar Duster.
   - LE: agregar C5 Aircross, Escape Titanium; retirar Koleos; reasignar `is_default`.
5. **Validar reservas históricas**: antes de marcar `status='inactive'` cualquier modelo, verificar que no haya `reservations` apuntándolo (hard delete prohibido por el `on delete cascade` desde categoría).
