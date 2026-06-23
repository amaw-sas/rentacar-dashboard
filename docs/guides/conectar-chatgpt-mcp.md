# Conectar ChatGPT a las reservas con un conector MCP

Esta guía conecta ChatGPT directo a las reservas de rentacar mediante un
**conector MCP**: el asistente busca disponibilidad real y crea la solicitud de
reserva, sin que el cliente salga de la conversación. No pide ninguna clave: el
cliente solo pega una URL.

Es la vía para clientes que usan ChatGPT. Para el flujo equivalente con un GPT
personalizado y Actions, ve a [conectar-chatgpt-custom-gpt.md](./conectar-chatgpt-custom-gpt.md);
el conector MCP también funciona con Claude y otros clientes que hablan MCP.

## Por qué sin clave

Quitamos la autenticación a propósito (decisión de directiva, issue #172). Pedirle
al cliente final que gestione una clave OAuth para reservar un carro estorba más de
lo que protege: quien ya está dentro de ChatGPT es una persona, no un bot. La
seguridad va por otro lado, invisible para el cliente:

- El **precio va firmado.** Cada cotización lleva una firma que expira a los 30
  minutos. Nadie puede inventar un precio ni reusar uno viejo.
- **Vercel Firewall** limita el ritmo de llamadas por IP.
- Toda reserva entra en estado **`nueva`**, a la espera de que el operador la
  revise. Nada se confirma solo.

## Lo que necesitas

- **ChatGPT** con conectores habilitados (Settings → Connectors; en algunos planes
  está bajo el modo desarrollador).
- La **URL del conector**:

  ```
  https://api.alquilatucarro.com/api/mcp/mcp
  ```

  Un solo endpoint sirve a todas las marcas: la franquicia se elige al crear la
  reserva, no por la URL.

## Paso a paso

### 1. Agrega el conector

1. En ChatGPT, entra a **Settings → Connectors** y pulsa **Add / Create**.
2. Pega la URL del conector.
3. En autenticación, elige **Sin autenticación** (*No authentication*).
4. Confirma. ChatGPT se conecta y descubre las dos herramientas.

### 2. Revisa las herramientas

El conector expone dos:

| Herramienta | Qué hace | ¿Reserva? |
|---|---|---|
| `buscar_disponibilidad` | Gamas y precios reales en COP para una ciudad y unas fechas | No, solo consulta |
| `crear_solicitud_reserva` | Crea la solicitud real a partir de una cotización y los datos del cliente | Sí |

`buscar_disponibilidad` solo lee; `crear_solicitud_reserva` reserva, pero la
solicitud queda en `nueva` hasta que el operador la confirme.

### 3. Cómo encadenan las dos

El flujo es siempre el mismo, y el asistente lo respeta solo:

1. `buscar_disponibilidad` devuelve, por gama, el precio y un **`quote`** (un
   código opaco con el precio firmado).
2. El cliente elige una gama.
3. `crear_solicitud_reserva` recibe ese `quote` tal cual más los datos del cliente
   (nombre, documento, correo, teléfono, franquicia) y crea la solicitud.

El `quote` es lo que ata el precio a la reserva. Por eso no se edita ni se arma a
mano: sale de la búsqueda y se reenvía igual.

## Ejemplo de conversación

> **Cliente:** Necesito un carro en Bogotá del 1 al 5 de julio.
>
> **ChatGPT (por detrás):** llama a `buscar_disponibilidad` con `ciudad: bogota` y
> esas fechas → recibe las gamas con precio y un `quote` por cada una.
>
> **ChatGPT responde:** Para Bogotá, del 1 al 5 de julio tengo gama económica, SUV
> y van, cada una con su precio en pesos. ¿Cuál te reservo?
>
> **Cliente:** La económica. Soy Juan Pérez, CC 123456789, juan@correo.com,
> 300 123 4567.
>
> **ChatGPT:** llama a `crear_solicitud_reserva` con el `quote` de la económica y
> esos datos → confirma el número de solicitud y avisa que queda pendiente de
> revisión.

## Errores comunes

- **"El conector no conecta."** Revisa que la URL termine en `/api/mcp/mcp` y que
  elegiste **Sin autenticación**. Si tu ChatGPT no muestra conectores, actívalos en
  Settings (o el modo desarrollador, según el plan).
- **"Dice que la cotización es inválida o expiró."** El `quote` dura 30 minutos.
  Si pasó más tiempo, pídele al asistente que vuelva a buscar disponibilidad; sale
  un `quote` nuevo.
- **"No encuentra la ciudad."** El asistente responde con las ciudades disponibles.
  Escribe una de esas (por ejemplo, `bogota`, `medellin`, `cali`).
- **"La reserva no aparece confirmada."** Es lo normal: entra como `nueva` y la
  confirma el operador. El número de solicitud sí es real desde el primer momento.
