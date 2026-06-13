import { parseStringPromise } from "xml2js";
import { LocalizaTimeoutError } from "./errors";

const DEFAULT_LOCALIZA_TIMEOUT_MS = 25_000;

interface LocalizaConfig {
  endpoint: string;
  username: string;
  password: string;
  token: string;
  requestorId: string;
}

export function getConfig(): LocalizaConfig {
  const endpoint = process.env.LOCALIZA_ENDPOINT;
  const username = process.env.LOCALIZA_USERNAME;
  const password = process.env.LOCALIZA_PASSWORD;
  const token = process.env.LOCALIZA_TOKEN;
  const requestorId = process.env.LOCALIZA_REQUESTOR_ID;

  if (!endpoint || !username || !password || !token || !requestorId) {
    throw new Error("Missing Localiza credentials in environment variables");
  }

  return { endpoint, username, password, token, requestorId };
}

function stripNamespace(name: string): string {
  const idx = name.indexOf(":");
  return idx >= 0 ? name.substring(idx + 1) : name;
}

// True for the DOMException kinds fetch/body-read raise when the AbortSignal
// fires: controller.abort() → "AbortError"; AbortSignal.timeout() → "TimeoutError".
function isAbortError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

// Resolve the deadline from env, defending against a present-but-invalid value:
// Number("") === 0 and Number("garbage") === NaN, and AbortSignal.timeout(NaN)
// throws a synchronous RangeError. An empty/garbage env var must degrade to the
// default, never crash every request.
function resolveTimeoutMs(): number {
  const parsed = Number(process.env.LOCALIZA_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_LOCALIZA_TIMEOUT_MS;
}

export async function callLocalizaAPI(
  soapAction: string,
  xmlBody: string,
  opts?: { signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  const config = getConfig();
  const basicAuth = Buffer.from(
    `${config.username}:${config.password}`,
  ).toString("base64");

  // Bound the WHOLE network operation — connection, body streaming, and the
  // error-body read. AbortSignal.timeout stays armed across response.text(), so
  // a slow Localiza that flushes headers fast then stalls the body aborts during
  // the body read, not the fetch(). The try/catch must therefore wrap every
  // await on the response, or that abort escapes as a generic 502 instead of the
  // 504 the dashboard reconciles on (issue #99). The signal is injectable so
  // tests drive aborts via controller.abort() (AbortSignal.timeout is a host
  // timer, immune to fake timers).
  const timeoutMs = resolveTimeoutMs();
  const signal = opts?.signal ?? AbortSignal.timeout(timeoutMs);

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: soapAction,
        Authorization: `Basic ${basicAuth}`,
      },
      body: xmlBody,
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Localiza API error ${response.status}: ${text}`);
    }

    const xml = await response.text();
    return await parseStringPromise(xml, {
      explicitArray: false,
      ignoreAttrs: false,
      tagNameProcessors: [stripNamespace],
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new LocalizaTimeoutError(`Localiza request exceeded ${timeoutMs}ms`);
    }
    throw error;
  }
}
