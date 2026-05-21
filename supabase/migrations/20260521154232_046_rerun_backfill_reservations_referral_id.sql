-- Re-run of #47 backfill to close residual drift identified 2026-05-21.
--
-- Context: migration 044 backfilled all rows that matched at the time
-- it ran (2026-05-20 15:52 UTC). Between then and the merge of #52
-- (`resolveReferral` trim+lowercase fix, commit 74d3e4a), the runtime
-- still wrote `referral_raw` with original casing while leaving
-- `referral_id` NULL for any rentacar-web booking that arrived with a
-- capitalized `?user=` param. One such reservation slipped through
-- (`ea054509-c6f3-4948-a4f0-2d63212ac83e`, raw="Daniela") and violated
-- the satisfaction criterion of #47 ("zero matchable rows with NULL
-- referral_id").
--
-- This migration re-applies the exact idempotent UPDATE from 044. With
-- #52 + #55 (CHECK lower(code)=code) merged, the runtime can no longer
-- produce drift, so this is the final fixup pass. Expected rows
-- affected on first apply: 1 (the residual row above). On any
-- subsequent re-run: 0.

update public.reservations r
set referral_id = ref.id
from public.referrals ref
where r.referral_id is null
  and r.referral_raw is not null
  and lower(trim(r.referral_raw)) = ref.code;
