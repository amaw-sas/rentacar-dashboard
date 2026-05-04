-- Update sender_email and reply_to_email for alquilame to point to the
-- verified Resend subdomain (mail.alquilame.co). Reply-To routes to the
-- external Gmail (alquilamecol@gmail.com) where operations are actually
-- handled. Same pattern as alquicarros (036): apex inbox is not used
-- operationally, so reply_to_email overrides deriveReplyTo() fallback.
UPDATE franchises
SET sender_email = 'info@mail.alquilame.co',
    reply_to_email = 'alquilamecol@gmail.com',
    updated_at = NOW()
WHERE code = 'alquilame';
