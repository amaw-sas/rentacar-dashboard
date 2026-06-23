import { createClient } from "@/lib/supabase/server";
import type { ChatToolName } from "@/lib/chat/tool-events";

// Chat tool health for the dashboard alert (Inc. 4 "Escudo"). Reads
// chat_tool_events over a trailing window via the authenticated server client
// (071 grants authenticated SELECT) and computes a per-tool failure rate. When
// the rate spikes (with enough volume to be meaningful) the conversations page
// shows a visible banner. Fails OPEN to "all clear" so a stats hiccup or a missing
// migration never breaks the page (mirrors getConversationMetrics).

const HEALTH_WINDOW_HOURS = 24;
const DEFAULT_MIN_VOLUME = 10;
const DEFAULT_THRESHOLD = 0.3;

const TOOLS: ChatToolName[] = ["cotizar", "crear_reserva"];

export interface ToolHealth {
  tool: ChatToolName;
  total: number;
  failed: number;
  failRate: number;
  alert: boolean;
}

export interface ChatHealthConfig {
  /** Fraction of failures (0–1) at/above which a tool is alerting. */
  threshold: number;
  /** Minimum attempts before we trust the rate (avoid alarming on 1 event). */
  minVolume: number;
}

function readConfig(): ChatHealthConfig {
  const t = Number(process.env.CHAT_HEALTH_FAIL_THRESHOLD);
  return {
    threshold: t > 0 && t <= 1 ? t : DEFAULT_THRESHOLD,
    minVolume: DEFAULT_MIN_VOLUME,
  };
}

/**
 * Pure health computation: per-tool fail rate + alert flag. A tool alerts only
 * when it has at least `minVolume` attempts AND its fail rate meets the threshold.
 */
export function computeToolHealth(
  aggregates: Array<{ tool: ChatToolName; total: number; failed: number }>,
  config: ChatHealthConfig,
): ToolHealth[] {
  return aggregates.map(({ tool, total, failed }) => {
    const failRate = total > 0 ? failed / total : 0;
    return {
      tool,
      total,
      failed,
      failRate,
      alert: total >= config.minVolume && failRate >= config.threshold,
    };
  });
}

/** Fold raw {tool, ok} rows into per-tool {total, failed}, one entry per known tool. */
export function aggregateToolEvents(
  rows: Array<{ tool: string; ok: boolean }>,
): Array<{ tool: ChatToolName; total: number; failed: number }> {
  return TOOLS.map((tool) => {
    const forTool = rows.filter((r) => r.tool === tool);
    return {
      tool,
      total: forTool.length,
      failed: forTool.filter((r) => !r.ok).length,
    };
  });
}

/** Per-tool health over the trailing window. Returns only the alerting tools. */
export async function getChatToolHealth(): Promise<ToolHealth[]> {
  try {
    const supabase = await createClient();
    const sinceISO = new Date(
      Date.now() - HEALTH_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await supabase
      .from("chat_tool_events")
      .select("tool, ok")
      .gte("created_at", sinceISO)
      .limit(10000);
    if (error) throw error;

    const health = computeToolHealth(
      aggregateToolEvents((data ?? []) as Array<{ tool: string; ok: boolean }>),
      readConfig(),
    );
    return health.filter((h) => h.alert);
  } catch (e) {
    console.warn(
      "getChatToolHealth failed:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}
