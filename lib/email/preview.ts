import { LOGO_CONTENT_ID } from "./constants";

const CID_REF = `cid:${LOGO_CONTENT_ID}`;

// 1x1 transparent GIF. Stands in for the logo when a franchise has no logo_url,
// so the preview shows nothing rather than a broken-image icon.
const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * Make a stored notification email renderable inside a browser `<iframe>` preview.
 *
 * Notification emails embed the franchise logo as an inline attachment referenced
 * via `cid:franchise-logo`. A `cid:` URI only resolves inside an email MIME
 * message, so in a browser it renders as a broken image. This rewrites those
 * references to the franchise's https logo URL — or a transparent pixel when no
 * logo is configured, to avoid a broken-image icon.
 *
 * The delivered email is untouched: this only transforms the HTML for preview.
 * Uses split/join (not replaceAll) so `$` in the URL is treated literally.
 */
export function inlineLogoForPreview(
  html: string,
  logoUrl: string | null | undefined
): string {
  if (!html.includes(CID_REF)) return html; // text-fallback emails carry no cid:
  // trim() so a blank/whitespace-only logo_url falls back to the pixel instead
  // of producing src=" " (which a browser renders as a broken image).
  const url = logoUrl?.trim();
  return html.split(CID_REF).join(url || TRANSPARENT_PIXEL);
}
