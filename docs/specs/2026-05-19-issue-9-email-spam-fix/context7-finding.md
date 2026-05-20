# Context7 Finding — Resend SDK attachments shape

**Date**: 2026-05-19
**Library**: `/websites/resend`
**Query**: TypeScript interface for `CreateEmailOptions` Attachment type

## Verdict

The Resend Node.js SDK accepts **two distinct field names** depending on the source of the image bytes:

| Pattern | Source | Field for CID id |
|---|---|---|
| Remote path | `path: 'https://...'` | `contentId: 'xxx'` |
| Inline content | `content: Buffer` | `cid: 'xxx'` |

Both produce `<img src="cid:xxx">` matching the inline image in the rendered email.

## Evidence

Source URL: `https://resend.com/docs/dashboard/emails/attachments` (path + contentId)
Source URL: `https://resend.com/docs/examples` Express + Bun + Nuxt examples (content + cid)

### Canonical example for our case (content as Buffer)

```typescript
// From https://resend.com/docs/examples (Express)
const imageContent = fs.readFileSync(imageUrl); // returns Buffer
await resend.emails.send({
  from: "Acme <onboarding@resend.dev>",
  to: [to],
  subject: subject,
  html: html,
  attachments: [
    {
      filename: "image.png",
      content: imageContent,   // Buffer
      cid: imageCid,            // NOT contentId
    },
  ],
});
```

Also available: optional `contentType: string` field (e.g., `"image/png"`).

## Implication for our implementation

Our `fetchLogoAttachment` returns a `Buffer` (server-side fetch from Vercel Blob). We must therefore use the **`cid`** field, not `contentId`. The HTML reference remains `<img src="cid:franchise-logo">`.

### Updated SendAttachment shape

```ts
interface SendAttachment {
  filename: string;
  content: Buffer;
  cid: string;            // was contentId in pre-Context7 spec
  contentType?: string;   // optional, e.g. "image/png"
}
```

## Impact on holdout scenarios

The scenarios file (`email-spam-fix.scenarios.md`) was authored before this verification with the placeholder field `contentId`. The user-observable behavior is **unchanged** (an inline CID image in the email) — only the literal SDK field name shifts. This is the exact risk the spec's Step 1 was designed to catch ("Verificar via Context7 al implementar").

The scenarios file requires amendment (field-name correction in SCEN-01 and SCEN-07). The amend is structural, not semantic: it does not weaken the contract or change any user-observable assertion. The Buffer payload still reaches the SDK; the email still renders an inline CID image; SCEN-M5 (cross-client rendering) is the ultimate observable for users and is unchanged.
