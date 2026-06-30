import { notFound } from "next/navigation";

import { ChatTestClient } from "./chat-test-client";

// Manual chat test harness — preview/local only. 404 in production so the public
// site never exposes it (the real customer-facing widget lives in rentacar-web).
// VERCEL_ENV is "production" only on prod deployments; "preview" on preview builds
// and undefined locally, so both of those keep serving the page.
export default function ChatTestPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return <ChatTestClient />;
}
