/**
 * Content-ID under which the franchise logo is embedded as an inline attachment
 * in notification emails. The email HTML references it as `cid:${LOGO_CONTENT_ID}`
 * and `lib/email/notifications.ts` sets it as the attachment's `contentId`.
 *
 * Shared between the send path and the dashboard preview so the two never drift:
 * the preview (`lib/email/preview.ts`) rewrites this same `cid:` reference into a
 * browser-renderable URL.
 */
export const LOGO_CONTENT_ID = "franchise-logo";
