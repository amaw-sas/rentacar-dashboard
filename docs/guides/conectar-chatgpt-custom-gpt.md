# Conectar ChatGPT a la API con un GPT personalizado (Actions)

Esta guía explica cómo darle a ChatGPT acceso real a la API de rentacar: sedes,
disponibilidad, precios y creación de reservas. El resultado es un asistente que
cotiza con datos reales y puede armar una reserva, en lugar de un ChatGPT que
solo adivina o manda al cliente a la página.

## Por qué hace falta

ChatGPT por sí solo no puede entrar a tu sistema: no tiene cómo consultar carros
ni precios. ChatGPT permite crear un **GPT personalizado** y darle **Actions**
(acciones): permiso para llamar a una API externa. Esta guía conecta esas Actions
a tu API mediante su documento OpenAPI.

La conexión respeta la regla de las dos puertas:

- **Consultar es libre.** Buscar sedes, requisitos y disponibilidad no pide clave.
- **Reservar pide clave.** Crear una reserva real usa una clave secreta en el
  header `x-api-key`.

## Lo que necesitas

- Una cuenta de **ChatGPT Plus** (los GPT personalizados son una función de pago).
- El **dominio de la API de la marca** que vas a conectar. Cada marca tiene el suyo:
  - `https://api.alquilame.co`
  - `https://api.alquicarros.com`
  - `https://api.alquilatucarro.com`
- La **clave de reservas** (`RESERVATION_API_KEY`), solo si quieres que el
  asistente cree reservas. Para cotizar no se necesita.

> Usa un dominio por marca. El GPT que conectes a `api.alquilame.co` trabaja con
> los datos de Alquílame; el de `api.alquicarros.com`, con los de Alquicarros.

## Paso a paso

### 1. Crea el GPT personalizado

1. Entra a ChatGPT y abre **Explore GPTs → Create** (o ve directo a
   `https://chatgpt.com/gpts/editor`).
2. Pasa a la pestaña **Configure**. Ahí defines nombre, descripción e
   instrucciones del asistente.

### 2. Importa la API como Action

1. En **Configure**, baja hasta **Actions** y pulsa **Create new action**.
2. En **Authentication**, déjalo de momento en **None** (lo ajustamos en el paso 3).
3. En el editor de schema, pulsa **Import from URL** y pega la URL del OpenAPI de
   la marca:

   ```
   https://api.alquilame.co/api/openapi
   ```

   (Cámbiala por el dominio de la marca que estés conectando.)

4. ChatGPT carga el documento y muestra las acciones disponibles, ya con nombres
   claros:

   | Acción | Qué hace | ¿Pide clave? |
   |---|---|---|
   | `getLocations` | Lista las sedes con su **código** | No |
   | `getRequirements` | Requisitos de alquiler (documentos, edad, etc.) | No |
   | `checkAvailability` | Disponibilidad y precios para fechas y sede | No |
   | `createReservation` | Crea la reserva real | **Sí** |

   No debe aparecer ningún error de schema. Si aparece, revisa que la URL sea la
   del OpenAPI (`/api/openapi`) y no la del sitio.

### 3. Configura la clave (solo para reservar)

Si quieres que el asistente solo cotice, **sáltate este paso**: con autenticación
en None ya puede usar `getLocations`, `getRequirements` y `checkAvailability`.

Si quieres que también cree reservas:

1. En **Authentication**, elige **API Key**.
2. **Auth Type:** Custom.
3. **Custom Header Name:** `x-api-key`.
4. **API Key:** pega el valor de `RESERVATION_API_KEY`.
5. Guarda.

A partir de ahí, ChatGPT manda esa clave en cada llamada. Las consultas igual
funcionan; la clave solo es obligatoria para `createReservation`.

### 4. Dale instrucciones al asistente

En el campo **Instructions** (pestaña Configure), pega algo como esto. Es clave
para que el asistente use los **códigos** de sede y no los nombres de ciudad:

```
Eres un asistente de alquiler de carros. Para cotizar:
1. Primero llama a getLocations para obtener el código de la sede que pide el
   cliente (por ejemplo, "Cali Aeropuerto" -> AAKAL). Nunca uses el nombre de la
   ciudad como código.
2. Llama a checkAvailability con ese código y las fechas para obtener gamas y
   precios reales en pesos colombianos.
3. Muestra las opciones con su precio y pregunta cuál reservar.
4. Solo si el cliente confirma, llama a createReservation con los datos del
   cliente. Antes, consulta getRequirements para saber qué documentos pedirle.
Responde siempre en español y con precios en COP.
```

### 5. Prueba

En el panel de **Preview** (a la derecha), escribe una consulta real y mira que
el asistente llame a las acciones. ChatGPT te pedirá confirmar la primera llamada
a cada dominio: acéptala.

## Ejemplo de conversación

> **Cliente:** Quiero un carro en Cali del 1 al 5 de julio.
>
> **El GPT (por detrás):**
> 1. `getLocations` → encuentra que Cali Aeropuerto es el código `AAKAL`.
> 2. `checkAvailability` con `AAKAL` y esas fechas → recibe las gamas con precio.
>
> **El GPT responde:** Para Cali Aeropuerto, del 1 al 5 de julio tengo gama
> económica, SUV y van, con su precio por día. ¿Cuál te reservo?
>
> **Cliente:** La económica.
>
> **El GPT:** Llama a `createReservation` (usando la clave) y confirma la reserva.

## Errores comunes

- **"ChatGPT dice que no puede consultar nada."** Es ChatGPT normal, sin la
  Action conectada. Sigue esta guía para conectarla.
- **"Pide clave para cotizar."** No es cierto: cotizar es libre. Si el asistente
  lo cree, refuerza en las Instructions que `checkAvailability` no necesita clave.
- **"Usa el nombre de la ciudad y falla."** La API trabaja con **códigos** (como
  `AAKAL`), no con nombres. El paso 4 lo corrige: obliga a pasar primero por
  `getLocations`.
- **"Error al importar el schema."** Verifica que pegaste la URL del OpenAPI
  (`https://api.<marca>/api/openapi`), no la del sitio web de la marca.

## Relación con la conexión MCP

Esta guía es la vía Actions/OpenAPI. La otra vía es el **conector MCP**
([conectar-chatgpt-mcp.md](./conectar-chatgpt-mcp.md)), que sirve tanto a ChatGPT
como a Claude y otros clientes con soporte MCP. Diferencia clave: ahí la conexión
es anónima (sin clave) y el precio viaja firmado en la cotización; aquí, las
Actions cotizan libres y la reserva pide `x-api-key`. Elige una según el cliente.
