import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchLogoAttachment } from "@/lib/email/fetch-logo";

const VALID_BLOB_URL =
  "https://9grznib0czdjtk77.public.blob.vercel-storage.com/rentacar/logo.png";
const APEX_LOGO_URL = "https://alquilatucarro.com/assets/email/logo.png";

function mockResponse(opts: {
  status?: number;
  contentType?: string;
  bodyBytes?: number;
}): Response {
  const status = opts.status ?? 200;
  const ct = opts.contentType ?? "image/png";
  const size = opts.bodyBytes ?? 100;
  const buf = new Uint8Array(size);
  return new Response(buf, {
    status,
    headers: { "content-type": ct },
  });
}

describe("fetchLogoAttachment", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it("SCEN-01: valid Vercel Blob PNG returns LogoAttachment with Buffer", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse({ contentType: "image/png", bodyBytes: 5000 })
    );
    const result = await fetchLogoAttachment(VALID_BLOB_URL);
    expect(result).not.toBeNull();
    expect(result!.filename).toBe("logo.png");
    expect(Buffer.isBuffer(result!.content)).toBe(true);
    expect(result!.content.byteLength).toBe(5000);
    expect(result!.contentType).toBe("image/png");
  });

  it("SCEN-02: HTTP 404 returns null + console.warn with status", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 404 })
    );
    const result = await fetchLogoAttachment(VALID_BLOB_URL);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("logo fetch 404")
    );
  });

  it("SCEN-03: SSRF — host outside allowlist short-circuits before fetch", async () => {
    const result = await fetchLogoAttachment(
      "https://169.254.169.254/latest/meta-data/"
    );
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("logo host not allowed: 169.254.169.254")
    );
  });

  it("SCEN-04: timeout (>5s) aborts fetch and returns null", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    fetchSpy.mockImplementationOnce(
      (_url: RequestInfo | URL, opts?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          capturedSignal = opts?.signal ?? undefined;
          if (capturedSignal) {
            capturedSignal.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }
        })
    );

    const promise = fetchLogoAttachment(VALID_BLOB_URL);
    await vi.advanceTimersByTimeAsync(5001);
    const result = await promise;

    expect(result).toBeNull();
    expect(capturedSignal?.aborted).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("logo fetch failed"),
      expect.anything()
    );
  });

  it("SCEN-05: null logo_url returns null silently (no fetch, no warn)", async () => {
    const result = await fetchLogoAttachment(null);
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("SCEN-05b: undefined logo_url returns null silently", async () => {
    const result = await fetchLogoAttachment(undefined);
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("SCEN-06: non-image content-type returns null + console.warn", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse({ contentType: "text/html", bodyBytes: 100 })
    );
    const result = await fetchLogoAttachment(VALID_BLOB_URL);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('content-type "text/html" rejected')
    );
  });

  it("SCEN-08: apex franchise domain is accepted by allowlist", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse({ contentType: "image/png", bodyBytes: 3000 })
    );
    const result = await fetchLogoAttachment(APEX_LOGO_URL);
    expect(result).not.toBeNull();
    expect(result!.contentType).toBe("image/png");
    expect(fetchSpy).toHaveBeenCalledWith(APEX_LOGO_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("SCEN-09: suffix-bypass attempt (evil-alquilatucarro.com) is rejected", async () => {
    const result = await fetchLogoAttachment(
      "https://evil-alquilatucarro.com/logo.png"
    );
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("logo host not allowed: evil-alquilatucarro.com")
    );
  });

  it("SCEN-10: oversize body (>100 KB) returns null + console.warn", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse({ contentType: "image/png", bodyBytes: 150_000 })
    );
    const result = await fetchLogoAttachment(VALID_BLOB_URL);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("logo size out of range (150000 bytes")
    );
  });

  // Issue #9 pre-merge review additions
  it("SCEN-11: zero-byte body returns null + console.warn (silent-failure guard)", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse({ contentType: "image/png", bodyBytes: 0 })
    );
    const result = await fetchLogoAttachment(VALID_BLOB_URL);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("logo size out of range (0 bytes")
    );
  });

  it("SCEN-12: 3xx redirect response is rejected (SSRF defense)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/" },
      })
    );
    const result = await fetchLogoAttachment(VALID_BLOB_URL);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("logo fetch redirect 302")
    );
  });

  it("passes redirect: 'manual' to fetch so undici does not follow", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockResponse({ contentType: "image/png", bodyBytes: 5000 })
    );
    await fetchLogoAttachment(VALID_BLOB_URL);
    expect(fetchSpy).toHaveBeenCalledWith(
      VALID_BLOB_URL,
      expect.objectContaining({ redirect: "manual" })
    );
  });

  it("non-https URL is rejected (defense-in-depth)", async () => {
    const result = await fetchLogoAttachment(
      "http://public.blob.vercel-storage.com/logo.png"
    );
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("logo non-https rejected")
    );
  });

  it("unparseable URL is rejected", async () => {
    const result = await fetchLogoAttachment("not a url");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("logo url unparseable")
    );
  });
});
