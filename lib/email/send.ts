import { createTransporter } from "./client";
import { createClient } from "@/lib/supabase/server";

interface SendEmailOptions {
  franchise: string;
  to: string;
  subject: string;
  html: string;
  bcc?: string;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 8000;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const { franchise, to, subject, html, bcc } = options;

  const supabase = await createClient();
  const { data: franchiseData, error: franchiseError } = await supabase
    .from("franchises")
    .select("sender_email, sender_name")
    .eq("code", franchise)
    .single();

  if (franchiseError || !franchiseData) {
    console.error(
      `[email] Failed to fetch franchise "${franchise}":`,
      franchiseError?.message
    );
    throw new Error(`Franchise "${franchise}" not found`);
  }

  const transporter = createTransporter(franchise);

  const mailOptions = {
    from: `"${franchiseData.sender_name}" <${franchiseData.sender_email}>`,
    to,
    subject,
    html,
    ...(bcc && { bcc }),
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(
        `[email] Sent "${subject}" to ${to} (franchise: ${franchise}, messageId: ${info.messageId})`
      );
      return;
    } catch (error) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("Too many emails") ||
          error.message.includes("550"));

      if (isRateLimit && attempt < MAX_RETRIES) {
        console.log(
          `[email] Rate limited, retrying "${subject}" in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_RETRIES})`
        );
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      console.error(
        `[email] Failed to send "${subject}" to ${to} (franchise: ${franchise}, attempt ${attempt}):`,
        error
      );
      throw error;
    }
  }
}
