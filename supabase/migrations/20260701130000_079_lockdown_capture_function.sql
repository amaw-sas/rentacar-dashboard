-- Harden #215: capture_failed_notification() is a SECURITY DEFINER trigger
-- function. Because it lives in the `public` schema, PostgREST exposes it as an
-- RPC callable by anon/authenticated (Supabase linter 0028/0029). A trigger
-- function must never be invoked directly via the API; the trigger fires under the
-- owner regardless of EXECUTE grants, so revoking EXECUTE from the API roles closes
-- the exposure with no effect on the trigger.
revoke execute on function public.capture_failed_notification() from public, anon, authenticated;
