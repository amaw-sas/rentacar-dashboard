// Context7-verified shape (2026-05-19, /websites/resend):
// Resend Node.js SDK accepts attachments with EITHER `path: URL` + `contentId`,
// OR `content: Buffer` + `cid`. We fetch server-side to control SSRF surface,
// so we use the `content + cid` pattern. See
// docs/specs/2026-05-19-issue-9-email-spam-fix/context7-finding.md

const FETCH_TIMEOUT_MS = 5000;
const MAX_LOGO_BYTES = 100_000;
const ALLOWED_PREFIXES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// Exact match OR dot-boundary suffix. Plain endsWith would let
// `evil-alquilatucarro.com` slip through.
const ALLOWED_HOSTS = [
  "public.blob.vercel-storage.com",
  "alquilatucarro.com",
  "alquilame.com",
  "alquicarros.com",
];

export interface LogoAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOSTS.some(
    (h) => hostname === h || hostname.endsWith("." + h)
  );
}

export async function fetchLogoAttachment(
  logoUrl: string | null | undefined
): Promise<LogoAttachment | null> {
  if (!logoUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(logoUrl);
  } catch {
    console.warn(`[email] logo url unparseable: ${logoUrl}`);
    return null;
  }
  if (parsed.protocol !== "https:") {
    console.warn(`[email] logo non-https rejected: ${logoUrl}`);
    return null;
  }
  if (!isAllowedHost(parsed.hostname)) {
    console.warn(`[email] logo host not allowed: ${parsed.hostname}`);
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(logoUrl, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[email] logo fetch ${res.status}: ${logoUrl}`);
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!ALLOWED_PREFIXES.some((p) => contentType.startsWith(p))) {
      console.warn(
        `[email] logo content-type "${contentType}" rejected: ${logoUrl}`
      );
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_LOGO_BYTES) {
      console.warn(
        `[email] logo too large (${buf.byteLength} bytes > ${MAX_LOGO_BYTES}): ${logoUrl}`
      );
      return null;
    }
    const ext = contentType.split("/")[1].split(";")[0].trim();
    return { filename: `logo.${ext}`, content: buf, contentType };
  } catch (err) {
    console.warn(`[email] logo fetch failed: ${logoUrl}`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
