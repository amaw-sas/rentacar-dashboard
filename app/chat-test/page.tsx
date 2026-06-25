"use client";

// Standalone chat test page (preview only). Talks to this deployment's
// /api/chat so the team can exercise the bot manually. Not part of the
// product — remove before merging the chat fix to production.

import { useRef, useState } from "react";

type Part = { type: "text"; text: string };
type FallbackLinks = { web: string; whatsapp: string };
type QuoteTablePart = {
  sede: string;
  dias: number;
  filas: Array<{
    categoria: string;
    descripcion: string;
    precioTotal: number;
    horasExtra: number;
    precioHoraExtra: number;
  }>;
};
type GamaCardsPart = {
  gama: string;
  descripcion?: string;
  modelos: Array<{ nombre: string; imagen: string }>;
};
type Msg = {
  role: "user" | "assistant";
  parts: Part[];
  // Booking-failure fallback (web deep-link + WhatsApp) the bot returns as a
  // tool output. The production widget renders these as buttons; mirror it here.
  links?: FallbackLinks;
  // Hybrid orchestrator (Etapa 2): the quote table is emitted as a `data-quoteTable`
  // part by code (not the LLM), so the page renders the prices deterministically.
  quoteTable?: QuoteTablePart;
  // Hybrid orchestrator (Etapa 4): vehicle model cards (photo + name) by gama,
  // emitted as a `data-gamaCards` part by code.
  gamaCards?: GamaCardsPart;
};

const COP = new Intl.NumberFormat("es-CO");

const BRANDS = ["alquilatucarro", "alquilame", "alquicarros"];

export default function ChatTestPage() {
  const [brand, setBrand] = useState(BRANDS[0]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const convId = useRef<string | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);

  function scrollDown() {
    requestAnimationFrame(() => {
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "user", parts: [{ type: "text", text }] }];
    // Placeholder assistant message we stream into.
    next.push({ role: "assistant", parts: [{ type: "text", text: "" }] });
    setMessages(next);
    setBusy(true);
    scrollDown();

    const assistantIdx = next.length - 1;
    const history = next.slice(0, assistantIdx); // exclude the empty placeholder

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand, conversationId: convId.current, messages: history }),
      });
      const cid = res.headers.get("x-conversation-id");
      if (cid) convId.current = cid;

      if (!res.body) throw new Error("sin respuesta");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let acc = "";
      let links: FallbackLinks | undefined;
      let quoteTable: QuoteTablePart | undefined;
      let gamaCards: GamaCardsPart | undefined;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const p = line.slice(5).trim();
          if (!p || p === "[DONE]") continue;
          let e: {
            type?: string;
            delta?: string;
            text?: string;
            output?: Record<string, unknown>;
            data?: unknown;
          };
          try {
            e = JSON.parse(p);
          } catch {
            continue;
          }
          // Booking-failure fallback links arrive as a tool output part.
          const out = e.output;
          if (out && typeof out.completar_en_web === "string") {
            links = {
              web: out.completar_en_web,
              whatsapp:
                typeof out.whatsapp_asesor === "string" ? out.whatsapp_asesor : "",
            };
          }
          // Orchestrator quote table (code-emitted data part).
          if (e.type === "data-quoteTable" && e.data) {
            quoteTable = e.data as QuoteTablePart;
          }
          // Orchestrator vehicle cards (code-emitted data part).
          if (e.type === "data-gamaCards" && e.data) {
            gamaCards = e.data as GamaCardsPart;
          }
          // Orchestrator fallback buttons (code-emitted data part). Same shape the
          // page already renders, so reuse the FallbackLinks state.
          if (e.type === "data-buttons" && e.data) {
            const b = e.data as { web?: string; whatsapp?: string };
            // Either button may come alone (e.g. hablar_asesor → whatsapp only).
            if (typeof b.web === "string" || typeof b.whatsapp === "string") {
              links = {
                web: typeof b.web === "string" ? b.web : "",
                whatsapp: typeof b.whatsapp === "string" ? b.whatsapp : "",
              };
            }
          }
          if (e.type === "text-delta") {
            acc += e.delta ?? e.text ?? "";
          }
          if (e.type === "text-delta" || links || quoteTable || gamaCards) {
            setMessages((cur) => {
              const copy = [...cur];
              copy[assistantIdx] = {
                role: "assistant",
                parts: [{ type: "text", text: acc }],
                links,
                quoteTable,
                gamaCards,
              };
              return copy;
            });
            scrollDown();
          }
        }
      }
      if (!acc) {
        setMessages((cur) => {
          const copy = [...cur];
          copy[assistantIdx] = {
            role: "assistant",
            parts: [{ type: "text", text: "(sin texto en la respuesta)" }],
          };
          return copy;
        });
      }
    } catch (err) {
      setMessages((cur) => {
        const copy = [...cur];
        copy[assistantIdx] = {
          role: "assistant",
          parts: [{ type: "text", text: `⚠️ Error: ${String(err)}` }],
        };
        return copy;
      });
    } finally {
      setBusy(false);
      scrollDown();
    }
  }

  function reset() {
    setMessages([]);
    convId.current = undefined;
  }

  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: 16,
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 18 }}>Chat de prueba</strong>
        <span style={{ fontSize: 12, color: "#888" }}>(preview — no es producción)</span>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 13 }}>
          Marca:{" "}
          <select value={brand} onChange={(e) => { setBrand(e.target.value); reset(); }}>
            {BRANDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <button onClick={reset} style={{ fontSize: 13 }}>
          Nueva conversación
        </button>
      </div>

      <div
        ref={scroller}
        style={{
          flex: 1,
          overflowY: "auto",
          border: "1px solid #e2e2e2",
          borderRadius: 8,
          padding: 12,
          background: "#fafafa",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {messages.length === 0 && (
          <p style={{ color: "#999", textAlign: "center", marginTop: 24 }}>
            Escribe abajo para empezar (ej: &quot;hola&quot;).
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              background: m.role === "user" ? "#2563eb" : "#fff",
              color: m.role === "user" ? "#fff" : "#111",
              border: m.role === "user" ? "none" : "1px solid #e2e2e2",
              borderRadius: 12,
              padding: "8px 12px",
              whiteSpace: "pre-wrap",
              fontSize: 14,
              lineHeight: 1.45,
            }}
          >
            {m.parts.map((p) => p.text).join("") || (m.role === "assistant" && busy ? "…" : "")}
            {m.quoteTable && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                {m.quoteTable.filas.map((f) => (
                  <div
                    key={f.categoria}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "6px 10px",
                      border: "1px solid #e2e2e2",
                      borderRadius: 8,
                      background: "#fff",
                    }}
                  >
                    <span>
                      Gama {f.categoria}{" "}
                      <span style={{ color: "#666" }}>{f.descripcion}</span>
                    </span>
                    <strong>${COP.format(f.precioTotal)}</strong>
                  </div>
                ))}
                <span style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                  Total con IVA, tasas, seguro básico y km ilimitado · {m.quoteTable.dias}{" "}
                  día(s).
                </span>
              </div>
            )}
            {m.gamaCards && (
              <div style={{ marginTop: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  Modelos de la Gama {m.gamaCards.gama}
                  {m.gamaCards.descripcion ? ` · ${m.gamaCards.descripcion}` : ""}
                </span>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    marginTop: 8,
                  }}
                >
                  {m.gamaCards.modelos.map((mod, mi) => (
                    <div
                      key={mi}
                      style={{
                        width: 120,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 4,
                        padding: 8,
                        border: "1px solid #e2e2e2",
                        borderRadius: 8,
                        background: "#fff",
                      }}
                    >
                      {mod.imagen ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={mod.imagen}
                          alt={mod.nombre}
                          loading="lazy"
                          style={{
                            width: "100%",
                            height: 80,
                            objectFit: "contain",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: 80,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#bbb",
                            fontSize: 12,
                          }}
                        >
                          (sin foto)
                        </div>
                      )}
                      <span
                        style={{
                          fontSize: 12,
                          textAlign: "center",
                          lineHeight: 1.3,
                        }}
                      >
                        {mod.nombre}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {m.links && (
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {m.links.web && (
                  <a
                    href={m.links.web}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      background: "#2563eb",
                      color: "#fff",
                      padding: "8px 12px",
                      borderRadius: 8,
                      fontSize: 13,
                      textDecoration: "none",
                    }}
                  >
                    Terminar mi reserva en la web
                  </a>
                )}
                {m.links.whatsapp && (
                  <a
                    href={m.links.whatsapp}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      background: "#16a34a",
                      color: "#fff",
                      padding: "8px 12px",
                      borderRadius: 8,
                      fontSize: 13,
                      textDecoration: "none",
                    }}
                  >
                    Escribir a un asesor
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        style={{ display: "flex", gap: 8, marginTop: 8 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe un mensaje…"
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #ccc",
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          style={{
            padding: "10px 18px",
            borderRadius: 8,
            border: "none",
            background: busy ? "#9ca3af" : "#2563eb",
            color: "#fff",
            fontSize: 14,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "…" : "Enviar"}
        </button>
      </form>
    </div>
  );
}
