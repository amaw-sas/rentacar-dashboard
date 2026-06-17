# Revisión de migración de horarios — ola D2 (#96)

Validar cada fila contra el horario operativo real ANTES de aplicar. Festivos no
mencionados en el texto quedan como `hol` ausente (= cerrado), salvo corrección del
operador (columna `corregida`).

| code | name | display original | schedule original | parsed | corregida |
| --- | --- | --- | --- | --- | --- |
| AABAN | Barranquilla Aeropuerto | Todos los días 07:00-20:00 | `{"display":"Todos los días 07:00-20:00"}` | `{"mon":["07:00-20:00"],"tue":["07:00-20:00"],"wed":["07:00-20:00"],"thu":["07:00-20:00"],"fri":["07:00-20:00"],"sat":["07:00-20:00"],"sun":["07:00-20:00"],"hol":["07:00-20:00"],"display":"Todos los días 07:00-20:00"}` | sí |
| AABCR | Bucaramanga Aeropuerto | Todos los días 06:30-18:30 | `{"display":"Todos los días 06:30-18:30"}` | `{"mon":["06:30-18:30"],"tue":["06:30-18:30"],"wed":["06:30-18:30"],"thu":["06:30-18:30"],"fri":["06:30-18:30"],"sat":["06:30-18:30"],"sun":["06:30-18:30"],"hol":["06:30-18:30"],"display":"Todos los días 06:30-18:30"}` | sí |
| AABOT | Bogotá Aeropuerto | Lun-Dom 24 horas \| Festivos 06:00-21:00 | `{"display":"Lun-Dom 24 horas \| Festivos 06:00-21:00"}` | `{"mon":["00:00-24:00"],"tue":["00:00-24:00"],"wed":["00:00-24:00"],"thu":["00:00-24:00"],"fri":["00:00-24:00"],"sat":["00:00-24:00"],"sun":["00:00-24:00"],"hol":["06:00-21:00"],"display":"Lun-Dom 24 horas \| Festivos 06:00-21:00"}` | — |
| AACTG | Cartagena Aeropuerto | Todos los días 06:30-20:00 | `{"display":"Todos los días 06:30-20:00"}` | `{"mon":["06:30-20:00"],"tue":["06:30-20:00"],"wed":["06:30-20:00"],"thu":["06:30-20:00"],"fri":["06:30-20:00"],"sat":["06:30-20:00"],"sun":["06:30-20:00"],"hol":["06:30-20:00"],"display":"Todos los días 06:30-20:00"}` | sí |
| AACUC | Cúcuta Aeropuerto | Lun-Vie 07:00-18:00 \| Sáb, Dom y fest 08:00-15:00 | `{"display":"Lun-Vie 07:00-18:00 \| Sáb, Dom y fest 08:00-15:00"}` | `{"mon":["07:00-18:00"],"tue":["07:00-18:00"],"wed":["07:00-18:00"],"thu":["07:00-18:00"],"fri":["07:00-18:00"],"sat":["08:00-15:00"],"sun":["08:00-15:00"],"hol":["08:00-15:00"],"display":"Lun-Vie 07:00-18:00 \| Sáb, Dom y fest 08:00-15:00"}` | — |
| AAKAL | Cali Aeropuerto | Lun-Sáb 06:00-21:00 \| Dom y fest 08:00-16:00 | `{"display":"Lun-Sáb 06:00-21:00 \| Dom y fest 08:00-16:00"}` | `{"mon":["06:00-21:00"],"tue":["06:00-21:00"],"wed":["06:00-21:00"],"thu":["06:00-21:00"],"fri":["06:00-21:00"],"sat":["06:00-21:00"],"sun":["08:00-16:00"],"hol":["08:00-16:00"],"display":"Lun-Sáb 06:00-21:00 \| Dom y fest 08:00-16:00"}` | — |
| AAMDL | Medellín Aeropuerto José María Córdoba | _(vacío)_ | `{}` | `{}` | — |
| AAMTR | Montería Aeropuerto | Lun-Vie 07:00-19:00 \| Sáb, Dom y fest 08:00-16:00 | `{"display":"Lun-Vie 07:00-19:00 \| Sáb, Dom y fest 08:00-16:00"}` | `{"mon":["07:00-19:00"],"tue":["07:00-19:00"],"wed":["07:00-19:00"],"thu":["07:00-19:00"],"fri":["07:00-19:00"],"sat":["08:00-16:00"],"sun":["08:00-16:00"],"hol":["08:00-16:00"],"display":"Lun-Vie 07:00-19:00 \| Sáb, Dom y fest 08:00-16:00"}` | — |
| AANVA | Neiva Aeropuerto | Lun-Vie 06:30-20:00 \| Sáb, Dom y fest 08:00-15:00 | `{"display":"Lun-Vie 06:30-20:00 \| Sáb, Dom y fest 08:00-15:00"}` | `{"mon":["06:30-20:00"],"tue":["06:30-20:00"],"wed":["06:30-20:00"],"thu":["06:30-20:00"],"fri":["06:30-20:00"],"sat":["08:00-15:00"],"sun":["08:00-15:00"],"hol":["08:00-15:00"],"display":"Lun-Vie 06:30-20:00 \| Sáb, Dom y fest 08:00-15:00"}` | — |
| AAPEI | Pereira Aeropuerto | Lun-Vie 06:30-19:30 \| Sáb, Dom y fest 08:00-15:00 | `{"display":"Lun-Vie 06:30-19:30 \| Sáb, Dom y fest 08:00-15:00"}` | `{"mon":["06:30-19:30"],"tue":["06:30-19:30"],"wed":["06:30-19:30"],"thu":["06:30-19:30"],"fri":["06:30-19:30"],"sat":["08:00-15:00"],"sun":["08:00-15:00"],"hol":["08:00-15:00"],"display":"Lun-Vie 06:30-19:30 \| Sáb, Dom y fest 08:00-15:00"}` | — |
| AARME | Armenia Aeropuerto | Lun-Vie 06:00-19:00 \| Sáb, Dom y fest 08:00-16:00 | `{"display":"Lun-Vie 06:00-19:00 \| Sáb, Dom y fest 08:00-16:00"}` | `{"mon":["06:00-19:00"],"tue":["06:00-19:00"],"wed":["06:00-19:00"],"thu":["06:00-19:00"],"fri":["06:00-19:00"],"sat":["08:00-16:00"],"sun":["08:00-16:00"],"hol":["08:00-16:00"],"display":"Lun-Vie 06:00-19:00 \| Sáb, Dom y fest 08:00-16:00"}` | — |
| AASMR | Santa Marta Aeropuerto | Todos los días 07:00-21:00 | `{"display":"Todos los días 07:00-21:00"}` | `{"mon":["07:00-21:00"],"tue":["07:00-21:00"],"wed":["07:00-21:00"],"thu":["07:00-21:00"],"fri":["07:00-21:00"],"sat":["07:00-21:00"],"sun":["07:00-21:00"],"hol":["07:00-21:00"],"display":"Todos los días 07:00-21:00"}` | sí |
| AAVAL | Valledupar Aeropuerto | Lun-Vie 07:00-18:00 \| Sáb, Dom y fest 08:00-15:00 | `{"display":"Lun-Vie 07:00-18:00 \| Sáb, Dom y fest 08:00-15:00"}` | `{"mon":["07:00-18:00"],"tue":["07:00-18:00"],"wed":["07:00-18:00"],"thu":["07:00-18:00"],"fri":["07:00-18:00"],"sat":["08:00-15:00"],"sun":["08:00-15:00"],"hol":["08:00-15:00"],"display":"Lun-Vie 07:00-18:00 \| Sáb, Dom y fest 08:00-15:00"}` | — |
| ACBAN | Barranquilla Norte | Lun-Vie 08:00-16:00 \| Sáb, Dom y fest 08:00-13:00 | `{"display":"Lun-Vie 08:00-16:00 \| Sáb, Dom y fest 08:00-13:00"}` | `{"mon":["08:00-16:00"],"tue":["08:00-16:00"],"wed":["08:00-16:00"],"thu":["08:00-16:00"],"fri":["08:00-16:00"],"sat":["08:00-13:00"],"sun":["08:00-13:00"],"hol":["08:00-13:00"],"display":"Lun-Vie 08:00-16:00 \| Sáb, Dom y fest 08:00-13:00"}` | — |
| ACBCR | Floridablanca | Lun-Vie 08:00-15:00 \| Sáb, Dom y fest 08:00-13:00 | `{"display":"Lun-Vie 08:00-15:00 \| Sáb, Dom y fest 08:00-13:00"}` | `{"mon":["08:00-15:00"],"tue":["08:00-15:00"],"wed":["08:00-15:00"],"thu":["08:00-15:00"],"fri":["08:00-15:00"],"sat":["08:00-13:00"],"sun":["08:00-13:00"],"hol":["08:00-13:00"],"display":"Lun-Vie 08:00-15:00 \| Sáb, Dom y fest 08:00-13:00"}` | — |
| ACBED | Bogotá Fontibón | _(vacío)_ | `{}` | `{}` | — |
| ACBEX | Bogotá Almacén Éxito del Country | Todos los días 06:30-20:00 | `{"display":"Todos los días 06:30-20:00"}` | `{"mon":["06:30-20:00"],"tue":["06:30-20:00"],"wed":["06:30-20:00"],"thu":["06:30-20:00"],"fri":["06:30-20:00"],"sat":["06:30-20:00"],"sun":["06:30-20:00"],"hol":["06:30-20:00"],"display":"Todos los días 06:30-20:00"}` | sí |
| ACBNN | Bogotá Centro Nuestro | Todos los días 06:30-18:00 | `{"display":"Todos los días 06:30-18:00"}` | `{"mon":["06:30-18:00"],"tue":["06:30-18:00"],"wed":["06:30-18:00"],"thu":["06:30-18:00"],"fri":["06:30-18:00"],"sat":["06:30-18:00"],"sun":["06:30-18:00"],"hol":["06:30-18:00"],"display":"Todos los días 06:30-18:00"}` | sí |
| ACBOJ | Bogotá Almacen Yumbo Calle 170 | Lun-Vie 08:00-16:00 \| Sáb 08:00-13:00 | `{"display":"Lun-Vie 08:00-16:00 \| Sáb 08:00-13:00"}` | `{"mon":["08:00-16:00"],"tue":["08:00-16:00"],"wed":["08:00-16:00"],"thu":["08:00-16:00"],"fri":["08:00-16:00"],"sat":["08:00-13:00"],"sun":["08:00-13:00"],"hol":["08:00-13:00"],"display":"Lun-Vie 08:00-16:00 \| Sáb 08:00-13:00"}` | sí |
| ACBSD | Soledad Aeropuerto | Lun-Dom 06:30-20:00 | `{"display":"Lun-Dom 06:30-20:00"}` | `{"mon":["06:30-20:00"],"tue":["06:30-20:00"],"wed":["06:30-20:00"],"thu":["06:30-20:00"],"fri":["06:30-20:00"],"sat":["06:30-20:00"],"sun":["06:30-20:00"],"hol":["06:30-20:00"],"display":"Lun-Dom 06:30-20:00"}` | sí |
| ACIBG | Ibagué | Lun-Vie 08:00-16:00 \| Sáb, Dom y fest 08:00-13:00 | `{"display":"Lun-Vie 08:00-16:00 \| Sáb, Dom y fest 08:00-13:00"}` | `{"mon":["08:00-16:00"],"tue":["08:00-16:00"],"wed":["08:00-16:00"],"thu":["08:00-16:00"],"fri":["08:00-16:00"],"sat":["08:00-13:00"],"sun":["08:00-13:00"],"hol":["08:00-13:00"],"display":"Lun-Vie 08:00-16:00 \| Sáb, Dom y fest 08:00-13:00"}` | — |
| ACKAL | Cali Sur Camino Real | Lun-Vie 08:00-17:00 \| Sáb 08:00-14:00 \| Dom y fest Cerrado | `{"display":"Lun-Vie 08:00-17:00 \| Sáb 08:00-14:00 \| Dom y fest Cerrado"}` | `{"mon":["08:00-17:00"],"tue":["08:00-17:00"],"wed":["08:00-17:00"],"thu":["08:00-17:00"],"fri":["08:00-17:00"],"sat":["08:00-14:00"],"sun":[],"hol":[],"display":"Lun-Vie 08:00-17:00 \| Sáb 08:00-14:00 \| Dom y fest Cerrado"}` | — |
| ACKJC | Cali Norte Chipichape | Lun-Vie 08:00-17:00 \| Sáb 08:00-14:00 \| Dom y fest 08:00-14:00 | `{"display":"Lun-Vie 08:00-17:00 \| Sáb 08:00-14:00 \| Dom y fest 08:00-14:00"}` | `{"mon":["08:00-17:00"],"tue":["08:00-17:00"],"wed":["08:00-17:00"],"thu":["08:00-17:00"],"fri":["08:00-17:00"],"sat":["08:00-14:00"],"sun":["08:00-14:00"],"hol":["08:00-14:00"],"display":"Lun-Vie 08:00-17:00 \| Sáb 08:00-14:00 \| Dom y fest 08:00-14:00"}` | — |
| ACKPA | Palmira | Lun-Vie 06:00-20:00 \| Sáb, Dom y fest 08:00-15:00 | `{"display":"Lun-Vie 06:00-20:00 \| Sáb, Dom y fest 08:00-15:00"}` | `{"mon":["06:00-20:00"],"tue":["06:00-20:00"],"wed":["06:00-20:00"],"thu":["06:00-20:00"],"fri":["06:00-20:00"],"sat":["08:00-15:00"],"sun":["08:00-15:00"],"hol":["08:00-15:00"],"display":"Lun-Vie 06:00-20:00 \| Sáb, Dom y fest 08:00-15:00"}` | — |
| ACMCL | Medellín Centro Éxito Colombia | Lun-Vie 08:00-15:00 \| Sáb 08:00-13:00 \| Dom y fest Cerrado | `{"display":"Lun-Vie 08:00-15:00 \| Sáb 08:00-13:00 \| Dom y fest Cerrado"}` | `{"mon":["08:00-15:00"],"tue":["08:00-15:00"],"wed":["08:00-15:00"],"thu":["08:00-15:00"],"fri":["08:00-15:00"],"sat":["08:00-13:00"],"sun":[],"hol":[],"display":"Lun-Vie 08:00-15:00 \| Sáb 08:00-13:00 \| Dom y fest Cerrado"}` | — |
| ACMDL | Medellín Poblado | _(vacío)_ | `{}` | `{}` | — |
| ACMJM | Rionegro | Todos los días 06:00-23:00 | `{"display":"Todos los días 06:00-23:00"}` | `{"mon":["06:00-23:00"],"tue":["06:00-23:00"],"wed":["06:00-23:00"],"thu":["06:00-23:00"],"fri":["06:00-23:00"],"sat":["06:00-23:00"],"sun":["06:00-23:00"],"hol":["06:00-23:00"],"display":"Todos los días 06:00-23:00"}` | sí |
| ACMNN | Medellín El Poblado | _(vacío)_ | `{}` | `{}` | — |
| ACMNZ | Manizales | Lun-Vie 08:00-16:00 \| Sáb, Dom y fest 08:00-13:00 | `{"display":"Lun-Vie 08:00-16:00 \| Sáb, Dom y fest 08:00-13:00"}` | `{"mon":["08:00-16:00"],"tue":["08:00-16:00"],"wed":["08:00-16:00"],"thu":["08:00-16:00"],"fri":["08:00-16:00"],"sat":["08:00-13:00"],"sun":["08:00-13:00"],"hol":["08:00-13:00"],"display":"Lun-Vie 08:00-16:00 \| Sáb, Dom y fest 08:00-13:00"}` | — |
| ACMTR | Montería Ciudad | Lun-Vie 08:00-15:00 \| Sáb, Dom y fest 08:00-13:00 | `{"display":"Lun-Vie 08:00-15:00 \| Sáb, Dom y fest 08:00-13:00"}` | `{"mon":["08:00-15:00"],"tue":["08:00-15:00"],"wed":["08:00-15:00"],"thu":["08:00-15:00"],"fri":["08:00-15:00"],"sat":["08:00-13:00"],"sun":["08:00-13:00"],"hol":["08:00-13:00"],"display":"Lun-Vie 08:00-15:00 \| Sáb, Dom y fest 08:00-13:00"}` | — |
| ACSMR | Santa Marta Barrio El prado | Lun-Vie 08:00-16:00 \| Sáb 08:00-13:00 | `{"display":"Lun-Vie 08:00-16:00 \| Sáb 08:00-13:00"}` | `{"mon":["08:00-16:00"],"tue":["08:00-16:00"],"wed":["08:00-16:00"],"thu":["08:00-16:00"],"fri":["08:00-16:00"],"sat":["08:00-13:00"],"sun":["08:00-13:00"],"hol":["08:00-13:00"],"display":"Lun-Vie 08:00-16:00 \| Sáb 08:00-13:00"}` | sí |
| ACVLL | Villavicencio | Lun-Vie 08:00-16:00 \| Sáb, Dom y fest 08:00-13:00 | `{"display":"Lun-Vie 08:00-16:00 \| Sáb, Dom y fest 08:00-13:00"}` | `{"mon":["08:00-16:00"],"tue":["08:00-16:00"],"wed":["08:00-16:00"],"thu":["08:00-16:00"],"fri":["08:00-16:00"],"sat":["08:00-13:00"],"sun":["08:00-13:00"],"hol":["08:00-13:00"],"display":"Lun-Vie 08:00-16:00 \| Sáb, Dom y fest 08:00-13:00"}` | — |

## Correcciones aplicadas (override del operador)

- AABAN (Barranquilla Aeropuerto): override `{"hol":["07:00-20:00"]}`.
- AABCR (Bucaramanga Aeropuerto): override `{"hol":["06:30-18:30"]}`.
- AACTG (Cartagena Aeropuerto): override `{"hol":["06:30-20:00"]}`.
- AASMR (Santa Marta Aeropuerto): override `{"hol":["07:00-21:00"]}`.
- ACBEX (Bogotá Almacén Éxito del Country): override `{"hol":["06:30-20:00"]}`.
- ACBNN (Bogotá Centro Nuestro): override `{"hol":["06:30-18:00"]}`.
- ACBOJ (Bogotá Almacen Yumbo Calle 170): override `{"sun":["08:00-13:00"],"hol":["08:00-13:00"]}`.
- ACBSD (Soledad Aeropuerto): override `{"hol":["06:30-20:00"]}`.
- ACMJM (Rionegro): override `{"hol":["06:00-23:00"]}`.
- ACSMR (Santa Marta Barrio El prado): override `{"sun":["08:00-13:00"],"hol":["08:00-13:00"]}`.

## Filas que requieren atención

- AAMDL (Medellín Aeropuerto José María Córdoba): quedó `{}` — sin horario.
- ACBED (Bogotá Fontibón): quedó `{}` — sin horario.
- ACMDL (Medellín Poblado): quedó `{}` — sin horario.
- ACMNN (Medellín El Poblado): quedó `{}` — sin horario.

**Total**: 32 filas · 28 con cambios · 4 sin cambio · 10 corregidas.
