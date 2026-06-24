"use client";

// Standalone chat test page (preview only). Talks to this deployment's
// /api/chat so the team can exercise the bot manually. Not part of the
// product — remove before merging the chat fix to production.

import { useRef, useState } from "react";

type Part = { type: "text"; text: string };
type Msg = { role: "user" | "assistant"; parts: Part[] };

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
          let e: { type?: string; delta?: string; text?: string };
          try {
            e = JSON.parse(p);
          } catch {
            continue;
          }
          if (e.type === "text-delta") {
            acc += e.delta ?? e.text ?? "";
            setMessages((cur) => {
              const copy = [...cur];
              copy[assistantIdx] = { role: "assistant", parts: [{ type: "text", text: acc }] };
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
