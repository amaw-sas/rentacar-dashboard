import { createTransporter } from "./client";
import { createClient } from "@/lib/supabase/server";

interface SendEmailOptions {
  franchise: string;
  to: string;
  subject: string;
  html: string;
  bcc?: string;
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

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(
      `[email] Sent "${subject}" to ${to} (franchise: ${franchise}, messageId: ${info.messageId})`
    );
  } catch (error) {
    console.error(
      `[email] Failed to send "${subject}" to ${to} (franchise: ${franchise}):`,
      error
    );
    throw error;
  }
}
