export const meta = {
  name: 'chat-eval-personas',
  description: 'Generate ~30 diverse, realistic, FUTURE-DATED customer personas (scripted turns) for a clean self-play eval',
  phases: [{ title: 'Generate' }],
};

const PERSONA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['personas'],
  properties: {
    personas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'brand', 'profile', 'buySignal', 'messages'],
        properties: {
          id: { type: 'string', description: 'kebab-case slug, unique' },
          brand: { type: 'string', enum: ['alquilatucarro', 'alquicarros'] },
          profile: { type: 'string', description: 'one line: who they are + goal + behavior' },
          buySignal: { type: 'boolean', description: 'true if this persona is designed to reach a clear booking attempt (gives full data + "resérvamelo")' },
          messages: { type: 'array', items: { type: 'string' }, description: 'the customer turns IN ORDER (6-12), realistic ES-CO' },
        },
      },
    },
  },
};

const CATEGORIES = [
  { key: 'ready-buyers', n: 6, desc: 'Clientes LISTOS PARA RESERVAR. Dan ciudad+fechas claras, ven la cotización, eligen una gama explícitamente, y entregan nombre completo + tipo y número de documento (CC) + correo + teléfono, y dicen algo como "resérvamelo" / "hagamos la reserva". buySignal=true. Varía ciudades (Bogotá, Medellín, Cali, Cartagena, Barranquilla, Pereira), gamas (económico, sedán, camioneta/SUV), y transmisión.' },
  { key: 'gama-undecided', n: 6, desc: 'Clientes que dudan entre gamas y se refieren a los autos de forma AMBIGUA: por deixis ("ese", "el primero", "el de la foto"), por nombre de modelo ("el Kia Picanto", "el Logan", "una Duster"), o por etiqueta ("el más económico", "el intermedio"). Algunos terminan eligiendo, otros no. Mezcla buySignal true/false. Fechas futuras de julio.' },
  { key: 'objectors', n: 5, desc: 'Clientes con OBJECIONES: precio ("está caro", "en la web vi más barato"), forma de pago ("no tengo tarjeta de crédito", "puedo pagar en efectivo?"), comparan sedes/ciudades, o "lo voy a pensar / consulto con mi esposa". Algunos se convencen y reservan (buySignal=true), otros se despiden. Fechas futuras.' },
  { key: 'info-seekers', n: 5, desc: 'Clientes exploradores que dan datos a cuentagotas y hacen preguntas sueltas (requisitos, seguro, edad mínima, kilometraje, pico y placa, si entregan en el aeropuerto, si pueden llevarlo a otra ciudad). Vagos, a veces responden con una sola palabra. Mayoría buySignal=false. Fechas futuras.' },
  { key: 'hard-cases', n: 4, desc: 'Casos DIFÍCILES (de fechas FUTURAS válidas, NO pasadas): devolución a una hora tardía (ej. 8pm) que puede caer fuera del horario de sede; piden 2 o 3 vehículos; piden una ciudad pequeña o sede específica; alquiler largo (mensual / 25 días). Mezcla buySignal. Fechas futuras de julio/agosto.' },
  { key: 'special', n: 4, desc: 'Clientes que piden HABLAR CON UN ASESOR humano explícitamente, o comparan precios entre dos sedes de la misma ciudad, o preguntan por gama exenta de pico y placa, o piden el enlace para reservar ellos mismos. Fechas futuras.' },
];

phase('Generate');
const results = await parallel(
  CATEGORIES.map((c) => () =>
    agent(
      [
        'Genera ' + c.n + ' personas de cliente para evaluar un chatbot de ALQUILER DE CARROS en Colombia (marcas: alquilatucarro y alquicarros). Cada persona es un guion: la SECUENCIA de mensajes que el cliente escribiría, en orden.',
        'HOY es viernes 27 de junio de 2026. TODAS las fechas que mencionen los clientes deben ser FUTURAS (del 1 de julio en adelante; usa fechas concretas como "del 10 al 14 de julio" o relativas como "el próximo fin de semana", "en 8 días"). NUNCA uses fechas de junio ni pasadas — el proveedor las rechaza.',
        'Español colombiano natural, como WhatsApp real: informal, a veces con typos leves, mensajes cortos. El PRIMER mensaje suele ser el saludo/pedido; luego el cliente va dando ciudad, fechas, horas, reacciona a la cotización, elige (o no) una gama, etc. NO escribas la parte del bot, SOLO los mensajes del cliente.',
        'Categoría a generar: ' + c.desc,
        'Para buySignal=true: el guion DEBE incluir, hacia el final, nombre completo + documento (CC y número) + correo + teléfono, y una frase de cierre ("resérvamelo", "hagamos la reserva"). Distribuye marcas entre alquilatucarro y alquicarros.',
        'Devuelve { personas: [...] } con 6-12 mensajes por persona.',
      ].join('\n'),
      { label: 'gen:' + c.key, phase: 'Generate', schema: PERSONA_SCHEMA },
    ),
  ),
);

const personas = results.filter(Boolean).flatMap((r) => r.personas || []);
return { personas, count: personas.length };
