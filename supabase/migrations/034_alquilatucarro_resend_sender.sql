-- Update sender_email for alquilatucarro to point to the verified Resend
-- subdomain (mail.alquilatucarro.com). The apex (alquilatucarro.com) is
-- not a verified Resend domain; only mail.alquilatucarro.com is. Reply-To
-- continues to land on the apex inbox via deriveReplyTo() in lib/email/send.ts.
UPDATE franchises
SET sender_email = 'info@mail.alquilatucarro.com',
    updated_at = NOW()
WHERE code = 'alquilatucarro';
