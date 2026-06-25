# Base de conocimiento consolidada — AlquilaTuCarro (chatbot)

> Fuente: análisis chat por chat de **363 conversaciones reales de WhatsApp** (2 cohortes, exportados 2026-06-22; sin solapamiento). Negocio: **alquiler de carros en Colombia** (alquilatucarro.com / reservatucarro.com). Operación física a cargo de **Localiza Rent a Car (Renting Colombia)**. Moneda: **COP**. Atención humana firmada como **"Valeria, asesora comercial"**.
>
> Este documento unifica y deduplica las versiones v1 (123 chats) y la ampliación (240 chats). Sirve para (a) alimentar al chatbot con hechos, políticas, respuestas y guion; y (b) mejorar la conversión corrigiendo las fugas detectadas. Cifras aproximadas por lectura directa.

---

## 1. Resumen ejecutivo

- El ~95% de las conversaciones siguen **el mismo libreto**: saludo → "¿conoces los requisitos?" → requisitos → pedir datos de cotización → cotizar con descuento "solo HOY" → intento de cierre ("¿te lo dejo apartado?").
- **El gran filtro y el gran asesino de ventas es la TARJETA DE CRÉDITO.** Es la objeción #1, con dos agravantes descubiertos: el **filtro de historial crediticio en sede** y la confusión **precio web vs precio real**.
- **Conversión: ~9% (cohorte 1) y ~12.5% (cohorte 2).** El segundo cohorte trae leads más avanzados (posventa, modificaciones, cancelaciones).
- **AlquilaTuCarro es el canal de reservas; la operación física es Localiza.** El cliente paga, firma y recoge en un local Localiza. Posventa y reclamos los maneja Localiza.
- **Fugas operativas dominantes:** latencia de respuesta de 12–23h, audios no atendidos, "consultar con la pareja" sin seguimiento, comandos internos crudos filtrados al chat y el menú automático pisando conversaciones activas.
- **Motor de cierre:** urgencia ("solo HOY"), escasez (última unidad / temporada alta), reserva sin costo y baja fricción ("solo necesito nombre, cédula y correo; no pido datos de la tarjeta").

---

## 2. Hechos del negocio

### 2.1 Modelo de operación (importante)
- **AlquilaTuCarro / ReservaTuCarro = canal comercial y de reservas.** *Chats c2: 8, 12, 32, 35, 218, 234.*
- **Localiza Rent a Car (Renting Colombia) = operador físico.** El cliente recoge, paga y firma en un local **Localiza** (letrero verde con blanco). La posventa, daños y reclamos los maneja Localiza, no AlquilaTuCarro.
- Reclamos/posventa Localiza Fontibón: **350-280-6370** · atencionalclientelocaliza@rentingcolombia.com.
- Asistencia 24h en carretera (averías): **AUTOSEGURO 604-444-2001**.
- Sistema de **referidos por asesor** (URLs `/referido/daniela/`, `/referido/diana/`).
- Canal de adquisición incluye web, catálogo WhatsApp, anuncios y **TikTok**.

### 2.2 Cobertura — sedes
Ciudades con servicio: Bogotá, Medellín, Cali, Barranquilla, Cartagena, Montería, Valledupar, Santa Marta, Bucaramanga, Floridablanca, Cúcuta, Armenia, Manizales, Pereira, Ibagué, Neiva, Villavicencio, Soledad, Palmira, Rionegro. (Se anuncian "20 sedes"; el conteo es inestable — usar esta base como verdad, no la web.)

**Puntos por ciudad (confirmados):**
- **Bogotá:** Aeropuerto (24/7), Fontibón (24h, a 5 min del aeropuerto), Calle 134 / Éxito del Country (hasta 9pm), Jumbo Calle 170 (Cll 170 #64-47), Centro Nuestro (8am–4pm).
- **Cali:** Norte (Chipichape, sin domingos/festivos), Sur (Camino Real, hasta 4pm), Aeropuerto (findes 8am–4pm).
- **Medellín:** El Poblado (L–S 7am–4pm, D/festivos 8am–3pm), Centro Éxito Colombia; Rionegro como alternativa con horario extendido.
- **Santa Marta:** Aeropuerto, Barrio El Prado (L–V 8–15h, S/D/festivos 8–12h).
- **Montería:** C.C. Buenavista (Cra 6), Aeropuerto.
- **Bucaramanga:** Aeropuerto, Floridablanca (cerca puente Provenza; findes/festivos hasta 1pm).
- **Cartagena:** solo Aeropuerto (6:30am–9pm).
- **Cúcuta:** solo Aeropuerto.
- **Ibagué:** C.C. Plazas del Bosque (entre semana hasta 12pm; NO hay sede en aeropuerto).
- **Manizales:** Mall Plaza (8am–1pm findes/festivos).
- **Neiva:** L–V 6:30–20h, S/D/festivos 8–15h.
- **Villavicencio:** Llano Centro (findes hasta 1pm).

**Correcciones de mapa:**
- **Tunja: CERRADA definitivamente** (alternativa Bogotá/Villavicencio).
- **Sin sede:** Pasto, Mocoa/Putumayo, Mosquera, Tuluá, Ocaña, Bello, San Gil → derivar a la ciudad con sede más cercana.

### 2.3 Requisitos (texto canónico — reutilizar literal)
```
**NUESTROS REQUISITOS**
- Tarjeta de crédito para el pago en la sede (Visa, MasterCard o American Express).
- Documento de Identidad (físico)
- Licencia Vigente (solo física)
- Realizar una reserva previa por este medio.
```

### 2.4 Políticas clave
| Tema | Política |
|---|---|
| **Medio de pago** | SOLO tarjeta de crédito (Visa/MasterCard/Amex), 100% crédito, a nombre del titular y franquiciada. NO efectivo, débito, débito internacional, prepagada, Nequi, Daviplata, cuenta corriente/ahorros. |
| **Tarjeta virtual** | SÍ se acepta (ej. Nu) si es 100% crédito y franquiciada. En sede el cliente abre la app del banco para mostrar número, vencimiento y franquicia → se diligencia un **voucher de garantía**. (Nequi NO: es precargada.) |
| **Cupo de la tarjeta** | Debe cubrir el valor total del alquiler (+ adicionales si los toma). No se verifica el cupo (es confidencial), no se bloquea/congela, no es depósito. La tarjeta se usa solo para el pago y se devuelve. |
| **Pago parcial** | No se puede pagar una parte con TC y otra en efectivo. |
| **Titular de la TC** | No necesita licencia ni conducir; solo estar presente en sede. Sin comisión por pagar con TC. |
| **Depósito** | NO se solicita. Solo se cobra el valor del alquiler. |
| **Pago** | En sede, el día de recogida, junto con la firma del contrato. NO se reciben pagos anticipados. |
| **Filtro crediticio** | La empresa valida historial crediticio EN SEDE al recoger. ⚠️ Dato interno: NO se menciona en el chat (es una pared para el cliente); el aviso se envía DESPUÉS de crear la reserva, por este medio y por correo. |
| **Reserva** | Sin costo. Se aparta solo con: nombre completo, documento, teléfono, correo. NO se piden datos de la tarjeta. Mínimo 1 hora hábil de anticipación. Intransferible. |
| **Cancelación** | Sin costo, el mismo día, por código de reserva. |
| **Modificar reserva** | Re-cotiza al descuento del día actual (puede subir el precio). |
| **Edad mínima** | 18 años con cédula de ciudadanía física. |
| **Licencia extranjera** | Permitida; presentarse con pasaporte. Si es extranjero, el pasaporte debe estar **sellado** con la entrada a Colombia. |
| **Titular ≠ conductor** | Permitido. Reserva a nombre del titular de la tarjeta. Ambos presentes en sede. Conductor adicional: **+$12.000/día** (seguro del conductor). |
| **Mínimo / máximo** | Mínimo 1 día = 24 h exactas. Máximo 30 días (renovable mes a mes). No se alquila por horas. |
| **Cobro por tiempo** | Cada 24 h exactas (mismo valor sin importar a qué hora del día se entregue). Horas extra 1–3 h se cobran como horas; a partir de 4 h, día completo. Regla 48h: si la sede cierra antes, se puede devolver al día siguiente dentro de las 48h sin cobro extra. |
| **Extender alquiler** | 1 día extra: sin gestión, se cobra al entregar (mismo valor/día). Más de 1 día: trámite en agencia. Se puede hacer ya teniendo el carro. |
| **Gasolina** | Se entrega con tanque lleno; se retorna lleno. |
| **Híbridos** | SÍ hay gamas híbridas (FL, LU), pero NO en todas las sedes. No hay diésel ni eléctricos. Si ya hay ciudad y fechas, verifica disponibilidad real con `cotizar` antes de confirmar; usa `info_gamas` para atributos. |
| **Kilometraje** | Ilimitado **solo en alquiler por días**. Por mes es LIMITADO (1000 o 2000 km). |
| **Lavada** | NO incluida. Opcional: $20.000 al recoger / $30.000 al retornar (o lavarlo por su cuenta). Mascotas: lavada completa obligatoria $150.000–$225.000. |
| **Silla para bebé** | $12.000/día. |
| **GPS / seguros completos / peajes** | Adicionales aparte. Peajes los paga el cliente. |
| **Incluido en el precio** | IVA + Tasa Administrativa + seguro básico + km ilimitado (por días). ⚠️ El precio de la **web NO incluye impuestos** y algunos precios del catálogo son por mes. |
| **Salir de la ciudad / a otro depto.** | Permitido sin costo extra. NO se puede sacar el vehículo del país. |
| **One-way (entregar en otra sede/ciudad)** | Permitido, con **recargo** (puede encarecer bastante). |
| **Domicilio** | NO hay servicio a domicilio. Recogida y entrega solo en sede. |
| **Modelo específico** | NO se garantiza. Se alquila **por gamas, no por modelos**. Modelo, año y color se asignan en sede según disponibilidad y terminación de placa. Gama alta: 2023 en adelante. |
| **Pico y placa** | Vehículos de placas amarillas particulares; se entregan sin pico y placa pero NO exentos. En sede un asesor ayuda a escoger la terminación de placa según el trayecto. En Bogotá se cambia el vehículo para rentas diarias (no mensuales). |
| **Tipo de cliente** | Solo **persona natural** (no empresas/B2B). No se alquila para trabajar en apps (Uber/Didi). No se reciben vehículos de terceros para rentar. |
| **NO manejan** | Toyota; vans, minivans, buses, busetas, motos, pickups/platón, camionetas con estacas, blindados, eléctricos, deportivos, convertibles, antiguos, de carga. |

### 2.5 Catálogo por gamas
| Gama | Tipo | Modelos | Tarifa base/día* |
|---|---|---|---|
| **C** | Económico mecánico | Renault Kwid, Fiat Mobi, Kia Picanto | $249.000 |
| **CX** | Económico automático | Kia Picanto Zenith | $249.000 |
| **F** | Intermedio mecánico (sedán) | Renault Logan, Kia Soluto, Chevrolet Onix Turbo | $279.000 |
| **FX / FU** | Intermedio automático | Renault Logan, Kia Soluto Emotion, Chevrolet Onix Turbo, Suzuki Swift Dzire GL, Suzuki Baleno | $329.000 |
| **GC** | SUV automática | Opel Crossland, Hyundai Kona, Nissan Kicks Play, Suzuki Vitara, Chevrolet Tracker Turbo, Fiat Pulse/Impetus, Hyundai Creta 1.5, Kia Sonet | $599.000 |
| **G4** | Camioneta mecánica | Renault Duster Turbo/Iconic, Suzuki Jimny, Suzuki Vitara | — |
| **LE** | SUV alta automática | Nissan Qashqai, Kia Sportage, Citroën C5 Aircross, Hyundai Tucson, Ford Escape Titanium | — |
| **GY** | 7 pasajeros | Hyundai Santa Fe 1.6 (2026) | — |

\* Tarifa "lista" antes del descuento dinámico. No existe gama "B" (tras C sigue F).
**Descuento "HOY":** dinámico, rango real visto **28%–54%**, escala con la cantidad de días.
**7 puestos (GY):** sujeto a disponibilidad, solicitar con ≥7 días de anticipación. Solo en Barranquilla, Bogotá, Cali, Cartagena, Medellín, Rionegro. (Armenia, Pereira, Bucaramanga, Manizales → solo 5 puestos.)
**Catálogo WhatsApp:** `https://wa.me/c/573016729250` — ⚠️ sus precios son por 30 días.

### 2.6 Seguros
| Seguro | Estado | Detalle |
|---|---|---|
| **Básico** | Incluido | Deducible de **$3.570.000 COP**: el cliente asume hasta ese monto por daños y el seguro cubre el excedente. Daño menor a $3.570.000 → lo paga el cliente completo; daño mayor → el cliente paga $3.570.000 y el seguro cubre el resto. |
| **Todo riesgo / total** | Opcional, en sede, con sobrecosto | Ej.: +~$348.000 sobre el básico en un caso. |
| **Conductor adicional** | Opcional, +$12.000/día | Cuando titular ≠ conductor; ambos presentes en sede. |

### 2.7 Alquiler por MES vs por DÍAS
| | Por días | Por mes (máx 30 días) |
|---|---|---|
| Kilometraje | Ilimitado | LIMITADO: 1000 km o 2000 km |
| Anticipación | Mín. 1 hora hábil | Mín. 7 días |
| Entrega | Tanque lleno | Prelavado |
| Precio catálogo web | — | Es por 30 días (prorrateado) |

Tarifas mensuales de referencia: Gama C $4.149.000 (1000km)/$4.635.000 (2000km); Gama F $4.935.000/$5.423.000; FX $4.676.000/$5.124.000; GC SUV $6.017.000/$6.670.000.

### 2.8 Vans y logística de aeropuerto
- El aeropuerto es para quien **llega en vuelo** y se traslada en van; si ya estás en la ciudad te derivan a la sede urbana.
- **Bogotá El Dorado:** Módulo Rent a Car, Piso 1, frente a Puerta 7; van cada 15 min de 6am–10pm; después llamar 350-280-6370. Van incluida/gratis.
- **Rionegro (José María Córdoba):** traslado en van a la sede; **no se reciben devoluciones** en ese punto, solo recogida. Tel 317-512-0545.
- **Tolerancia de 1 hora** en recogida si el vuelo se retrasa (pedir aerolínea + número de vuelo).

---

## 3. Estructura de la conversación (libreto)

```
1. Trigger del cliente
   - Saludo simple ("Hola", "Buenas") o
   - Mensaje prellenado web: "Hola, vi su página de alquiler de carros en [CIUDAD] y quiero saber los requisitos"
   - Mensaje desde TikTok / catálogo / anuncio

2. (Bot WhatsApp Business) MENSAJE AUTOMÁTICO con 5 opciones:
   reservar / cotizar / recoger vehículo / dudas / retornar

3. SALUDO de marca:
   "Hola buen día, soy Valeria, asesora comercial de alquilatu carro.
    Es un placer atenderl@, ¿en qué puedo ayudarte el día de hoy?"

4. PREGUNTA-GANCHO de calificación:
   "¿Ya conoces los requisitos de alquiler?"   ← filtra tarjeta de crédito desde el inicio

5. ENVÍA REQUISITOS (bloque §2.3)

6. PIDE DATOS PARA COTIZAR:
   Ciudad de recogida: / Fecha y hora de recogida: / Fecha y hora de devolución:
   Gama a cotizar (Mecánico o automático): / Correo electrónico:

7. COTIZACIÓN formateada:
   *Consulta de alquiler de carro*
   📍 Lugar: [sede]   📅 Recogida / 📅 Devolución   🗓 [N] días
   *HOY con el [X]% de descuento,* valor Total: $ [monto]
   [bloque de gama con modelos] + disclaimer de tarifa dinámica

8. INTENTO DE CIERRE:
   "Incluye IVA y Tasas Administrativas.
    ¿Te lo dejo apartado? Solo necesito tu nombre completo, cédula y correo."
   (+ link de reserva)

9. CAPTURA de datos del titular: Nombre / Documento / Teléfono / Correo

10. CONFIRMACIÓN: "su reserva ya fue aprobada... información enviada a teléfono y correo
    (incluye nombre del local Localiza, dirección y mapa)."

11. DESPEDIDA: "Muchas gracias por confiar en nosotros. Estamos para servirte."
```

**Notas de flujo:**
- Si el cliente da varios datos de golpe → **no volver a pedirlos**.
- Si dan solo "días" sin fechas → pedir fechas exactas.
- Si la hora pedida está fuera del horario de la sede → ofrecer hora/sede más cercana (aeropuerto/Fontibón 24h en Bogotá).
- Tras cotizar suele venir una ronda de preguntas de detalle (depósito, lavada, pico y placa, gasolina, sede) → resolver y volver a cerrar.
- **En la confirmación, SIEMPRE entregar nombre del local (Localiza), dirección y mapa** (evita que el cliente llegue y no encuentre la sede).

---

## 4. Preguntas frecuentes (Q&A canónico)

**Pago y dinero**
- **¿Puedo pagar en efectivo / débito / Nequi / transferencia / Addi / prepagada?** → "Lo sentimos, el único medio de pago es tarjeta de crédito (Visa, MasterCard o Amex). Es requisito indispensable."
- **¿Sirve mi tarjeta de crédito virtual (Nu, etc.)?** → "Sí, siempre que sea 100% de crédito y franquiciada. En la sede abres la app de tu banco para mostrar los datos. (Nequi no aplica: es precargada.)"
- **¿Se deja depósito / congelan cupo?** → "No solicitamos depósito ni congelamos cupo. La tarjeta solo se usa para el pago y se devuelve. Solo debe tener cupo por el valor del alquiler."
- **¿Cuánto cupo necesito?** → "El valor total del alquiler (más adicionales si los tomas). No verificamos tu cupo; eso lo revisas en tu app, es confidencial."
- **¿El pago es anticipado o en la sede?** → "En la sede, el día que recoges el vehículo, junto con la firma del contrato. No recibimos pagos anticipados."
- **¿Por qué el precio de la web es más barato?** → "El valor de la web no incluye impuestos (IVA y tasa administrativa), y algunos precios del catálogo son por mes. El valor real con todo incluido te lo confirmo por aquí."
- **¿Hay comisión por pagar con TC?** → "No."

**Tarjeta y conductor**
- **¿La tarjeta debe ser de quien conduce?** → "No. La reserva va a nombre del titular de la tarjeta. Si conduce otra persona, ambos presentes en sede y se cobra +$12.000/día por el seguro del conductor adicional. El titular no necesita licencia ni conducir, solo estar presente."
- **¿Puede ser la tarjeta de un familiar/amigo?** → "Sí, siempre que el titular esté presente al tomar el servicio."

**Requisitos y elegibilidad**
- **¿Cuáles son los requisitos?** → (bloque §2.3)
- **¿Desde qué edad?** → "Desde los 18 años, con cédula de ciudadanía física."
- **¿Sirve licencia/pasaporte extranjero?** → "Licencia extranjera vigente + pasaporte. Si eres extranjero, el pasaporte debe estar sellado con tu entrada a Colombia."
- **¿Alquilan para empresa?** → "Por ahora el alquiler es únicamente para persona natural."

**Vehículos**
- **¿Puedo escoger el modelo/color/año?** → "Reservamos por gamas, no por modelos. El modelo, año y color se asignan en la sede el día de recogida, según disponibilidad y terminación de placa (gama alta: 2023 en adelante)."
- **¿Tienen Toyota / Fortuner / pickup / van?** → "No manejamos Toyota, vans ni pickups. 7 puestos sí (gama GY, sujeto a disponibilidad, solicitar con 7 días) solo en Barranquilla, Bogotá, Cali, Cartagena, Medellín y Rionegro. Te comparto catálogo: wa.me/c/573016729250."

**Operación**
- **¿Dónde están ubicados?** → lista de sedes (§2.2) y pedir ciudad para el punto exacto.
- **¿Me lo llevan a domicilio?** → "No, la recogida y devolución son directamente en sede."
- **¿Mínimo de alquiler?** → "Mínimo 1 día (24 horas). No alquilamos por horas. Máximo 30 días, renovable mes a mes."
- **¿Cobran por horas extra?** → "El cobro es cada 24 h exactas. De 1 a 3 h extra se cobran como horas; a partir de 4 h, día completo."
- **¿Puedo extender?** → "1 día extra: sin gestión, se cobra al entregar. Más de 1 día: trámite en agencia. El día extra vale igual que tu tarifa."
- **¿Incluye gasolina?** → "Se entrega con tanque lleno y debe retornarse lleno."
- **¿La lavada está incluida?** → "No. Opcional: $20.000 al recoger o $30.000 al retornar. Con mascotas aplica lavada completa $150.000–$225.000."
- **¿Puedo viajar a otras ciudades / salir de la ciudad?** → "Sí, por todo el territorio nacional sin costo extra. No puedes sacar el vehículo del país."
- **¿Puedo recoger y entregar en sedes/ciudades distintas?** → "Sí, con un costo adicional según el trayecto."
- **¿Puedo viajar con mascotas?** → "Sí. Ten en cuenta que aplica lavada completa al retornar ($150.000–$225.000)."
- **¿La tarjeta queda en garantía?** → "No, solo se usa para el pago y se devuelve de inmediato."
- **¿Cómo funciona el pico y placa?** → (respuesta larga §6).
- **¿Qué cubre el seguro?** → "El alquiler ya incluye seguro básico, con un deducible de $3.570.000: tú asumes hasta ese monto por daños y el seguro cubre el excedente (si el daño es menor a $3.570.000 lo pagas tú; si es mayor, pagas $3.570.000 y el seguro cubre el resto). El seguro total es opcional, se toma en sede con costo adicional y reduce ese deducible."
- **¿Cómo hago la reserva?** → "Solo necesito nombre completo, documento, teléfono y correo. No pido datos de la tarjeta."
- **¿Cuál es el más espacioso de la gama?** → (excepción a "por gamas": el Kwid tiene un poco más de espacio; o sugerir subir a gama F).

---

## 5. Psicología de venta y estrategias

1. **Calificación temprana con "los requisitos"** — es un filtro de tarjeta de crédito disfrazado de cortesía.
2. **Urgencia + escasez (motor del cierre):** "HOY con el X% de descuento" + "tarifas dinámicas, el único valor que se sostiene es con reserva confirmada". Reforzar con **escasez de inventario real** ("queda una unidad", "se agotan en temporada alta").
3. **Anclaje de precio:** mostrar la tarifa "lista" alta y luego el día con descuento.
4. **El descuento escala con los días** → empuja estadías largas.
5. **Cierre de baja fricción:** "solo necesito nombre, cédula y correo; no pido datos de la tarjeta".
6. **Reserva sin costo** como reductor de riesgo.
7. **"La dirección se libera al confirmar la reserva"** → gancho de cierre ("en 2 minutos la tienes con la dirección en mano").
8. **Cierre con bullets de valor + recomendación personal:** "gratis y cancelable / bloqueas el precio / el descuento solo se garantiza con reserva. Mi recomendación: resérvalo hoy."
9. **Usar el descuento dinámico para empujar la gama que conviene** ("hoy la media está más económica").
10. **Recuperación ante objeción de tarjeta:** ofrecer titular familiar/amigo, o invitar al cliente a gestionar **por sus propios medios** una tarjeta de crédito (incluida una TC virtual). NO dar contactos ni teléfonos de asesores (táctica estrella, ver §7).
11. **Recuperación ante vehículo no disponible:** ofrecer catálogo y gama alterna.
12. **Cotizar dos gamas (mecánico + automático)** para dar opción y subir ticket.
13. **Drop-off como upsell** (recargo por devolución en otra sede).
14. **Recortar días para ajustar al cupo** de la tarjeta en vez de perder la venta.
15. **Captura de referidos** en viajes grupales.
16. **Seguimiento reactivador:** "¿Todo bien por ahí? Sigo atenta si deseas cotizar ☺️" / "Hola 👋 ¿pudiste revisar la cotización? ¿Te gustaría avanzar?"
17. **Calidez y cercanía:** trato por nombre, "señor/señora", emojis moderados, despedidas "feliz y bendecido día".

---

## 6. Catálogo de objeciones y manejo (scripts)

| Objeción | Frecuencia | Manejo recomendado |
|---|---|---|
| **No tengo tarjeta de crédito** (efectivo/débito/Nequi/prepagada/débito internacional) | Altísima (la #1) | "El único medio es tarjeta de crédito, pero puede ser la de un familiar/amigo presente al recoger." Si no, sugerir que el cliente gestione por sus propios medios una tarjeta de crédito (incluida una TC virtual el mismo día). NO dar contactos ni teléfonos de asesores (§7). No insistir +2 veces. |
| **"No me gustan las tarjetas de crédito"** (rechazo por preferencia) | Media | Igual que arriba; enfatizar la opción del titular acompañante o la TC virtual rápida. |
| **"El precio en la web es más barato"** (la más recurrente del cohorte 2) | Alta | "El de la web no incluye impuestos y algunos precios son por mes. El total real con descuento te queda en $[Y]." No discutir; reconducir al valor con descuento. |
| **Cupo insuficiente** | Media | Recortar días para ajustar al cupo disponible. |
| **"Déjame consultar con mi esposo/a"** | Alta; casi nunca regresan solos | "Claro ☺️ ¿te aparto el precio con descuento mientras confirmas? La reserva no tiene costo y así no pierdes la tarifa." + follow-up en pocas horas. |
| **Precio: "¿algo más barato?"** | Media | Ofrecer gama económica (C/CX); recordar que a más días, mayor descuento. No bajar de la más económica. |
| **Desconfianza / comparación con competencia** | Media | No descalificar al competidor: "Nuestro total es $[X], todo incluido (IVA, seguro, km ilimitado)." |
| **"Quiero ir en persona a reservar"** | Baja | "La reserva es solo por este medio y sin costo; la sede es solo para el trámite y pago. La dirección se libera al confirmar." |
| **Carro económico muy pequeño** | Baja | Upsell a gama F (más espacio). |
| **Pico y placa (Bogotá)** | Media | Respuesta canónica (abajo). |
| **Vehículo no disponible** (Toyota, van, 7 puestos fuera de cobertura) | Media | Ofrecer alternativa + catálogo; si imposible, despedir cordial. |
| **Empresa / B2B** | Baja | Hoy se rechaza; capturar el lead para canal corporativo futuro en vez de cerrar la puerta. |
| **Filtro crediticio en sede** | Baja pero crítica | NO mencionarlo en el chat: es una pared para el cliente. El aviso (validación de historial en sede) se envía DESPUÉS de crear la reserva, por este medio y por correo. |
| **Fuera de cobertura** | Baja | Indicar sede más cercana; si no hay, despedir cordial. |
| **Manda audio** | Media | "Disculpa, no contamos con audio, pero con gusto te asesoro por escrito 😊." (⚠️ ver §8.) |

**Respuesta canónica pico y placa (Bogotá):**
> "Nuestros vehículos son de placas amarillas particulares. Se entregan sin pico y placa, pero no están exentos. En Bogotá, para rentas diarias (no mensuales), en la agencia se hace el cambio de vehículo según la terminación de placa que se ajuste a tu recorrido. Pico y placa en Bogotá: lun–vie 6am–9pm; días pares circulan placas terminadas en 6,7,8,9,0; días impares en 1,2,3,4,5. No aplica fines de semana ni festivos."

---

## 7. Táctica estrella: recuperar el lead sin tarjeta

Ante "no tengo tarjeta de crédito" (la objeción #1), la mejor jugada observada NO es despedirse:
1. Ofrecer **titular familiar/amigo** presente al recoger (vía recomendada), o
2. **Invitar al cliente a gestionar por sus propios medios una tarjeta de crédito** (incluida una TC virtual el mismo día, 100% online). ⚠️ El chat NO entrega contactos, teléfonos ni nombres de asesores bancarios: esa averiguación la hace el cliente por su cuenta.

> Guion sugerido: "El único medio es tarjeta de crédito, pero hay dos caminos: (a) usar la de un familiar o amigo que te acompañe a recoger, o (b) si prefieres, puedes sacar tú mismo una tarjeta de crédito —incluso una virtual el mismo día, 100% online— por tus propios medios. ¿Cuál te sirve?"

---

## 8. Fugas de leads — qué debe corregir el bot

Ordenadas por impacto:

1. **Latencia de respuesta (12–23h, día y noche).** Mensajes nocturnos o de fin de semana contestados al día/lunes siguiente; el lead ya cotizó en otro lado. → **Bot 24/7 instantáneo = mejora #1.**
2. **Filtro crediticio en sede.** La validación de historial ocurre en sede. → El bot NO lo menciona durante la conversación (evita la pared); el aviso se envía tras crear la reserva, por este medio y por correo.
3. **Reserva confirmada sin dirección clara.** El cliente llega y no encuentra "AlquilaTuCarro" (el local es Localiza). → Entregar nombre del local, dirección y mapa en la confirmación.
4. **Audios no atendidos.** Varios leads con prisa se pierden. → Transcripción de audio o respuesta inmediata que reencauce.
5. **Filtro de tarjeta tardío.** → Mencionar la alternativa (titular familiar/amigo o TC virtual) en el primer contacto sobre pago.
6. **"Consultar con la pareja" sin red de seguimiento.** → Follow-up automático (+2h y +1 día) ofreciendo apartar el precio sin costo.
7. **Cotización → silencio.** → Tras cotizar, cerrar siempre con CTA y reactivar si no hay respuesta.
8. **Comandos/macros internos filtrados al cliente** (`/sa`, `/fr`, `/req`, `/da`, `/ss`). → Bug de UX a eliminar.
9. **Menú "MENSAJE AUTOMÁTICO" re-disparado a mitad de conversación**, pisando preguntas activas. → Suprimir en conversaciones avanzadas.
10. **Errores de fecha/mes y copy-paste mecánico** (mecánico↔automático, mes equivocado). → El bot calcula sin error.
11. **Preguntas clave ignoradas = lead perdido** (convenios, año del modelo, Uber, "¿cobran si recojo más temprano?"). → Responder toda pregunta.
12. **Rigidez "pago el mismo día"** y **sin canal de voz** pierden ventas puntuales.
13. **Posventa "no es nuestra área"** (se deriva a Localiza). → Punto ciego de control de experiencia.
14. **Información inconsistente** (web prometía aeropuerto Ibagué inexistente; conteo de sedes variable). → Usar esta base como fuente única de verdad.

---

## 9. Términos del contrato / posventa

- **Asistencia 24h averías:** AUTOSEGURO 604-444-2001.
- **Reclamos/posventa:** Localiza Fontibón 350-280-6370 · atencionalclientelocaliza@rentingcolombia.com.
- **Prohibido:** usar el vehículo en apps (Uber/Didi); sacar el vehículo del país.
- **Cargos por suciedad:** lavado+aspirado $150.000; +tapicería $225.000; cargos extra por mascotas, olor a cigarrillo/alcohol, barro.
- **Cancelación:** sin costo, mismo día, por código de reserva.
- **Modificación:** puede cambiar el descuento al del día actual.
- **Descuento y reserva:** intransferibles.

---

## 10. Segmentos / casos atípicos

- **Extranjeros (alto valor):** mexicanos, venezolanos, **ecuatorianos (+593, segmento creciente)**. Reglas: licencia extranjera + pasaporte **sellado**; TC virtual aceptada (ventaja vs Avis/Budget).
- **Cliente recurrente / comparador serial:** alto mantenimiento pero alta conversión (recompra, múltiples cotizaciones).
- **Viajes largos / ticket alto:** 11–26 días, totales $2M–$7M. Segmento rentable.
- **Reservas a futuro lejano** (2–6 meses): se cotizan advirtiendo tarifa dinámica.
- **Grupos grandes (9+ personas):** solución = 2 vehículos con 2 titulares distintos.
- **Leads mal-dirigidos** que se reconvierten (buscaban otra cosa).
- **Canal TikTok** genera leads.

---

## 11. Frases de marca (voz del bot)

- Apertura: *"Hola buen día, soy [Asistente] de AlquilaTuCarro. Es un placer atenderte, ¿en qué puedo ayudarte hoy?"*
- Gancho: *"¿Ya conoces los requisitos de alquiler?"*
- Disclaimer de precio: *"Recuerda que la reserva no tiene ningún costo adicional; nuestras tarifas son dinámicas y pueden cambiar en cualquier momento. El único valor que se sostiene es el indicado con reserva confirmada."*
- Cierre: *"¿Te lo dejo apartado? Solo necesito tu nombre completo, cédula y correo."*
- CTA: *"¿List@ para asegurar tu reserva y bloquear el precio con descuento?"*
- Escasez: *"¿Quieres que te conserve este valor antes de que cambie o se agote existencia?"*
- Confirmación: *"Tu reserva fue aprobada. Toda la información llegó a tu WhatsApp y correo (incluye el local Localiza, la dirección y el mapa)."*
- Despedida: *"Muchas gracias por confiar en nosotros. Estamos para servirte. ¡Feliz y bendecido día!"*
- No disponible: *"Esperamos poder prestar nuestro servicio en próximas ocasiones, muchas gracias por preferirnos."*

---

## 12. Métricas

| | Cohorte 1 | Cohorte 2 | Total |
|---|---|---|---|
| Chats analizados | 123 | 240 | 363 |
| Reservas aprobadas | ~11 | ~30 | ~41 |
| Conversión | ~9% | ~12.5% | ~11% |

Objeción dominante en ambos: **tarjeta de crédito**, con dos agravantes (historial crediticio en sede + confusión precio web vs real).

---

*Fuente: 363 conversaciones reales (cohortes 2026-06-22). Documento consolidado y deduplicado a partir de v1 (123 chats) + ampliación (240 chats). Cifras aproximadas por lectura directa; ajustar al crecer el corpus.*
