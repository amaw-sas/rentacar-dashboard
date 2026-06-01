import { describe, it, expect } from "vitest";
import { inlineLogoForPreview } from "@/lib/email/preview";
import { LOGO_CONTENT_ID } from "@/lib/email/constants";

const CID_REF = `cid:${LOGO_CONTENT_ID}`;
const LOGO_URL = "https://blob.example/logo.png";

// HTML mirroring a stored notification: preload link + header img + footer img,
// all referencing the inline logo via cid:. The preload <link> is real —
// @react-email/components render() auto-injects it for the Img src, so the
// stored html_content carries 3 cid: references, not 2 (verified against a
// delivered email via Resend get-email).
const HTML_WITH_LOGO = `<!DOCTYPE html><html><head>
<link rel="preload" as="image" href="${CID_REF}"/></head><body>
<img alt="Franquicia" src="${CID_REF}" width="180" style="width:180px"/>
<p>contenido</p>
<img alt="Franquicia" src="${CID_REF}" width="120" style="width:120px;opacity:0.7"/>
</body></html>`;

// HTML where the logo failed at send time -> text fallback, no cid: anywhere.
const HTML_TEXT_FALLBACK = `<!DOCTYPE html><html><body>
<p style="color:#030678">Alquila tu Carro</p><p>contenido</p></body></html>`;

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("inlineLogoForPreview", () => {
  // SCEN-001
  it("rewrites every cid:franchise-logo reference to the https logo url", () => {
    const out = inlineLogoForPreview(HTML_WITH_LOGO, LOGO_URL);
    expect(out).not.toContain(CID_REF);
    expect(count(out, LOGO_URL)).toBe(3); // preload + header + footer
  });

  // SCEN-002
  it("leaves text-fallback html (no cid) byte-for-byte unchanged", () => {
    const out = inlineLogoForPreview(HTML_TEXT_FALLBACK, LOGO_URL);
    expect(out).toBe(HTML_TEXT_FALLBACK);
  });

  // SCEN-003
  it("degrades to a transparent pixel (no broken image) when logoUrl is empty", () => {
    const out = inlineLogoForPreview(HTML_WITH_LOGO, "");
    expect(out).not.toContain(CID_REF);
    expect(out).toContain("data:image/gif;base64");
    expect(out).not.toContain('src=""');
  });

  it("degrades to a transparent pixel when logoUrl is whitespace-only", () => {
    const out = inlineLogoForPreview(HTML_WITH_LOGO, "   ");
    expect(out).not.toContain(CID_REF);
    expect(out).toContain("data:image/gif;base64");
    expect(out).not.toContain('src=" "');
  });

  it("degrades to a transparent pixel when logoUrl is null/undefined", () => {
    const outNull = inlineLogoForPreview(HTML_WITH_LOGO, null);
    const outUndef = inlineLogoForPreview(HTML_WITH_LOGO, undefined);
    expect(outNull).not.toContain(CID_REF);
    expect(outUndef).not.toContain(CID_REF);
    expect(outNull).toContain("data:image/gif;base64");
    expect(outUndef).toContain("data:image/gif;base64");
  });

  // SCEN-004
  it("is idempotent — re-applying with the same url does not change the result", () => {
    const once = inlineLogoForPreview(HTML_WITH_LOGO, LOGO_URL);
    const twice = inlineLogoForPreview(once, LOGO_URL);
    expect(twice).toBe(once);
  });
});
