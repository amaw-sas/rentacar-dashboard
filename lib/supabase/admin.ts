import { createClient } from "@supabase/supabase-js";

/**
 * Admin Supabase client that bypasses RLS using the service role key.
 * ONLY use in server-side code that is already authenticated (e.g., API routes
 * with x-api-key validation, cron jobs).
 *
 * NEVER expose this to client code.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL",
    );
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
