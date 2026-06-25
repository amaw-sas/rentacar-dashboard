/**
 * Manual model-comparison harness (NOT part of the normal suite — gated behind
 * RUN_MODEL_EVAL=1). Drives the REAL system prompt + production tool schemas
 * against two models with identical, deterministic tool outputs so the only
 * variable is the model. Also fires one REAL cotizar to confirm the live path.
 *
 * Run:
 *   RUN_MODEL_EVAL=1 EVAL_MODEL="anthropic/claude-haiku-4.5" vitest run tests/manual/model-eval.test.ts
 *   RUN_MODEL_EVAL=1 EVAL_MODEL="gpt-5" vitest run tests/manual/model-eval.test.ts
 */
import fs from "node:fs";
import { describe, it } from "vitest";
import {
  generateText,
  stepCountIs,
  tool,
  convertToModelMessages,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { buildSystemPrompt } from "@/lib/chat/agent";
import { cotizarSchema, runCotizar } from "@/lib/chat/tools";
import {
  infoSedesSchema,
  tarifaMensualSchema,
  infoGamasSchema,
} from "@/lib/chat/knowledge-tools";

// Load .env.local (gateway key, etc.) into process.env. Tolerant of absence so
// collecting this file in CI (no .env.local, gate off) never throws.
try {
  for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* no .env.local — fine when the eval gate (RUN_MODEL_EVAL) is off */
}

const MODEL = process.env.EVAL_MODEL ?? "gpt-5";
const OUT = process.env.EVAL_OUT ?? "/tmp/model-eval.txt";
const write = (s: string) => fs.appendFileSync(OUT, s + "\n");
// Run any slug-form model through the Gateway; a bare id uses OpenAI directly.
const model = MODEL.includes("/") ? MODEL : openai(MODEL);
// reasoningEffort is OpenAI-specific; apply it for GPT-5 (direct or via gateway)
// to mirror production, and omit it for Anthropic.
const isOpenAI = MODEL === "gpt-5" || MODEL.startsWith("openai/");
const providerOptions = isOpenAI
  ? { openai: { reasoningEffort: "low" as const } }
  : undefined;

// Captured tool calls for the current scenario.
let calls: { name: string; args: unknown }[] = [];

// Deterministic, realistic tool outputs — identical for both models so the
// comparison isolates model behavior (decision to call + args + presentation).
function evalTools() {
  const rec = (name: string) => (args: unknown) => {
    calls.push({ name, args });
  };
  return {
    cotizar: tool({
      description: "Cotiza vehículos por ciudad y fechas con precios REALES.",
      inputSchema: cotizarSchema,
      execute: async (args) => {
        rec("cotizar")(args);
        return {
          disponibilidad: {
            sede: "Bogotá - Aeropuerto El Dorado",
            dias: 3,
            gamas: [
              { gama: "Económica", precio_total_cop: 540000 },
              { gama: "Intermedia", precio_total_cop: 690000 },
              { gama: "SUV", precio_total_cop: 1020000 },
            ],
          },
        };
      },
    }),
    info_sedes: tool({
      description: "Devuelve las sedes de una ciudad.",
      inputSchema: z.object(infoSedesSchema),
      execute: async (args) => {
        rec("info_sedes")(args);
        return {
          sedes: [
            { nombre: "El Dorado", direccion: "Cra 103 #25-XX", horario: "L-D 6:00-22:00" },
          ],
        };
      },
    }),
    tarifa_mensual: tool({
      description: "Devuelve la tarifa MENSUAL de referencia de una gama.",
      inputSchema: z.object(tarifaMensualSchema),
      execute: async (args) => {
        rec("tarifa_mensual")(args);
        return {
          gama: "Económica",
          precios_cop: { "1000km": 2600000, "2000km": 2900000, "3000km": 3200000 },
          seguro_total_cop: 480000,
        };
      },
    }),
    info_gamas: tool({
      description: "Devuelve las gamas de vehículos y atributos.",
      inputSchema: z.object(infoGamasSchema),
      execute: async (args) => {
        rec("info_gamas")(args);
        return {
          gamas: [
            { gama: "Económica", pasajeros: 5, transmision: "manual" },
            { gama: "Intermedia", pasajeros: 5, transmision: "automática" },
            { gama: "SUV", pasajeros: 7, transmision: "automática" },
          ],
        };
      },
    }),
  };
}

type Turn = { user: string; label: string };
type Scenario = { name: string; turns: Turn[]; seed?: ModelMessage[]; seedUI?: UIMessage[] };

// FAITHFUL seed: mirrors how production persists history — a prior assistant
// turn carrying the `tool-cotizar` part with its full structured output
// (output-available), which convertToModelMessages re-feeds into context every
// turn as a real tool call + tool result (not prose). This is the suspected
// trigger for the re-paste behavior.
const SEED_QUOTED_UI: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Quiero alquilar en Palmira del 1 al 5 de julio." }] },
  {
    id: "a1",
    role: "assistant",
    parts: [
      {
        type: "tool-cotizar",
        toolCallId: "call_1",
        state: "output-available",
        input: { ciudad: "palmira", fecha_recogida: "2026-07-01", fecha_devolucion: "2026-07-05" },
        output: {
          disponibilidad: {
            sede: "Palmira",
            dias: 4,
            gamas: [
              { gama: "C económico mecánico", precio_total_cop: 702784 },
              { gama: "F sedán mecánico", precio_total_cop: 778384 },
              { gama: "FX sedán automático", precio_total_cop: 889984 },
              { gama: "GC camioneta automática", precio_total_cop: 1271256 },
              { gama: "G4 camioneta mecánica 4x4", precio_total_cop: 1325256 },
              { gama: "LE camioneta automática especial", precio_total_cop: 1681656 },
            ],
          },
        },
      } as unknown as UIMessage["parts"][number],
      {
        type: "text",
        text:
          "Gama C económico mecánico\n**$702.784**\n\nGama F sedán mecánico\n**$778.384**\n\n" +
          "Valores totales por 4 días del 1 al 5 de jul en Palmira, con IVA, tasa y km ilimitado.\n\n---\n\n" +
          "REQUISITOS\n- Tarjeta de crédito.\n- Documento de identidad.\n- Licencia vigente.\n\n¿Con cuál te quedas?",
      },
    ],
  },
];

// A realistic already-shown quote + requisitos, mirroring a real conversation,
// so we can test how the model handles a tangential follow-up when a big quote
// block is already in history.
const SEED_QUOTED: ModelMessage[] = [
  { role: "user", content: "Quiero alquilar en Palmira del 1 al 5 de julio." },
  {
    role: "assistant",
    content:
      "Gama C económico mecánico\n**$702.784**\n\n" +
      "Gama F sedán mecánico\n**$778.384**\n\n" +
      "Gama FX sedán automático\n**$889.984**\n\n" +
      "Valores totales por 4 días del 1 al 5 de jul en Palmira, con IVA, tasa administrativa y km ilimitado.\n\n---\n\n" +
      "REQUISITOS\n- Tarjeta de crédito para el pago en la sede.\n- Documento de identidad (físico).\n- Licencia vigente (solo física).\n- Realizar una reserva previa por este medio.\n\n¿Con cuál te quedas?",
  },
  // Contamination: a prior turn where the bot ALREADY re-pasted the full list +
  // requisitos for a tangential ask. Tests self-reinforcement on the next turn.
  { role: "user", content: "tienes uno más económico" },
  {
    role: "assistant",
    content:
      "Estas son las opciones en Palmira del 1 al 5 de jul (4 días):\n\n" +
      "Gama C económico mecánico\n**$702.784**\n\n" +
      "Gama F sedán mecánico\n**$778.384**\n\n" +
      "Gama FX sedán automático\n**$889.984**\n\n---\n\n" +
      "REQUISITOS\n- Tarjeta de crédito para el pago en la sede.\n- Documento de identidad (físico).\n- Licencia vigente (solo física).\n- Realizar una reserva previa por este medio.\n\n¿Te sirve la gama C o te muestro más?",
  },
];

const SCENARIOS: Scenario[] = [
  {
    name: "Preguntas tangenciales con cotización YA mostrada (¿re-pega cotización+requisitos?)",
    seedUI: SEED_QUOTED_UI,
    turns: [
      { user: "¿tienes una foto del carro?", label: "T1 tangencial (foto) → SOLO foto, NO re-pegar cotización/requisitos" },
      { user: "¿y es a gasolina o diésel? ¿cómo lo entregan?", label: "T2 tangencial (combustible) → SOLO eso, NO re-pegar" },
    ],
  },
];

async function runScenario(s: Scenario) {
  const system = await buildSystemPrompt("alquilatucarro");
  const messages: ModelMessage[] = s.seedUI
    ? await convertToModelMessages(s.seedUI)
    : s.seed
      ? [...s.seed]
      : [];
  const out: string[] = [`\n### ${s.name}`];
  for (const turn of s.turns) {
    calls = [];
    messages.push({ role: "user", content: turn.user });
    const t0 = Date.now();
    const r = await generateText({
      model,
      system,
      messages,
      tools: evalTools(),
      stopWhen: stepCountIs(6),
      ...(providerOptions ? { providerOptions } : {}),
    });
    messages.push(...r.response.messages);
    const toolStr = calls.length
      ? calls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(", ")
      : "—";
    out.push(`\n[${turn.label}] CLIENTE: ${turn.user}`);
    out.push(`  tools: ${toolStr}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    out.push(`  BOT: ${r.text.replace(/\n/g, "\n       ")}`);
  }
  return out.join("\n");
}

describe.runIf(process.env.RUN_MODEL_EVAL === "1")("model eval", () => {
  it("REAL cotizar (confirma el camino vivo de Localiza)", async () => {
    const t0 = Date.now();
    const r = await runCotizar({
      ciudad: "bogota",
      fecha_recogida: "2026-07-10",
      fecha_devolucion: "2026-07-13",
    });
    write(
      `\n=== REAL cotizar (${((Date.now() - t0) / 1000).toFixed(1)}s) ok=${r.ok} ===\n` +
        (r.ok ? JSON.stringify(r.data).slice(0, 600) : r.message),
    );
  }, 60_000);

  it(`drives scenarios on ${MODEL}`, async () => {
    write(`\n========== MODELO: ${MODEL} ==========`);
    for (const s of SCENARIOS) write(await runScenario(s));
  }, 180_000);
});
