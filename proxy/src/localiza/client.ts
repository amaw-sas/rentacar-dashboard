import { parseStringPromise } from "xml2js";

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

export async function callLocalizaAPI(
  soapAction: string,
  xmlBody: string,
): Promise<Record<string, unknown>> {
  const config = getConfig();
  const basicAuth = Buffer.from(
    `${config.username}:${config.password}`,
  ).toString("base64");

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: soapAction,
      Authorization: `Basic ${basicAuth}`,
    },
    body: xmlBody,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Localiza API error ${response.status}: ${text}`);
  }

  const xml = await response.text();
  const parsed = await parseStringPromise(xml, {
    explicitArray: false,
    ignoreAttrs: false,
    tagNameProcessors: [stripNamespace],
  });

  return parsed;
}
