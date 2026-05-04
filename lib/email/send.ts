import { getResendClient } from "./client";
import { createAdminClient } from "@/lib/supabase/admin";
import { logNotification } from "@/lib/actions/notification-logs";

export function deriveReplyTo<T extends string | null | undefined>(
  senderEmail: T
): T {
  if (senderEmail === null || senderEmail === undefined) {
    return senderEmail;
  }
  const atIndex = senderEmail.indexOf("@");
  if (atIndex === -1) {
    return senderEmail;
  }
  const local = senderEmail.slice(0, atIndex);
  const host = senderEmail.slice(atIndex + 1);
  const stripped = host.replace(/^mail\./i, "");
  return `${local}@${stripped}` as T;
}

interface SendEmailOptions {
  franchise: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  bcc?: string;
  reservationId?: string;
  notificationType?: string;
}

interface ResendApiError {
  name: string;
  message: string;
  statusCode?: number;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 8000;
const SEND_TIMEOUT_MS = 10000;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableApiError(error: ResendApiError): boolean {
  if (error.name === "rate_limit_exceeded") return true;
  if (
    error.name === "application_error" &&
    typeof error.statusCode === "number" &&
    error.statusCode >= 500
  ) {
    return true;
  }
  return false;
}

async function sendWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const {
    franchise,
    to,
    subject,
    html,
    text,
    bcc,
    reservationId,
    notificationType,
  } = options;

  const supabase = createAdminClient();
  const { data: franchiseData, error: franchiseError } = await supabase
    .from("franchises")
    .select("sender_email, sender_name, reply_to_email")
    .eq("code", franchise)
    .single();

  if (franchiseError || !franchiseData) {
    console.error(
      `[email] Failed to fetch franchise "${franchise}":`,
      franchiseError?.message
    );
    throw new Error(`Franchise "${franchise}" not found`);
  }

  const client = getResendClient(franchise);
  const replyToAddress =
    franchiseData.reply_to_email ?? deriveReplyTo(franchiseData.sender_email);

  const payload = {
    from: `"${franchiseData.sender_name}" <${franchiseData.sender_email}>`,
    to: [to],
    replyTo: replyToAddress,
    subject,
    html,
    ...(text ? { text } : {}),
    ...(bcc ? { bcc: [bcc] } : {}),
    headers: {
      "List-Unsubscribe": `<mailto:${replyToAddress}?subject=Unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };

  let lastApiError: ResendApiError | undefined;
  let lastException: unknown;
  let nullResponseSeen = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await sendWithTimeout(
        client.emails.send(payload),
        SEND_TIMEOUT_MS,
        "Resend send"
      );

      if (response.error) {
        lastApiError = response.error as ResendApiError;
        lastException = undefined;
        nullResponseSeen = false;

        if (isRetryableApiError(lastApiError) && attempt < MAX_RETRIES) {
          console.log(
            `[email] Retryable Resend error (${lastApiError.name}), retrying "${subject}" in ${
              RETRY_DELAY_MS / 1000
            }s (attempt ${attempt}/${MAX_RETRIES})`
          );
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        break;
      }

      if (!response.data) {
        nullResponseSeen = true;
        lastApiError = undefined;
        lastException = undefined;
        break;
      }

      console.log(
        `[email] Sent "${subject}" to ${to} (franchise: ${franchise}, resend_id: ${response.data.id})`
      );

      if (reservationId && notificationType) {
        logNotification({
          reservation_id: reservationId,
          channel: "email",
          notification_type: notificationType,
          recipient: to,
          subject,
          html_content: html,
          status: "sent",
        }).catch((err) => console.error("[notification-log] Log failed:", err));
      }

      return;
    } catch (err) {
      lastException = err;
      lastApiError = undefined;
      nullResponseSeen = false;

      if (attempt < MAX_RETRIES) {
        console.log(
          `[email] Send threw, retrying "${subject}" in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_RETRIES}):`,
          err instanceof Error ? err.message : err
        );
        await sleep(RETRY_DELAY_MS);
        continue;
      }
    }
  }

  let errorMessage: string;
  let toThrow: Error;

  if (lastApiError) {
    errorMessage = `Resend ${lastApiError.name}: ${lastApiError.message}`;
    toThrow = new Error(errorMessage);
  } else if (lastException) {
    toThrow =
      lastException instanceof Error
        ? lastException
        : new Error(String(lastException));
    errorMessage = toThrow.message;
  } else if (nullResponseSeen) {
    errorMessage = "Resend SDK returned no data and no error";
    toThrow = new Error(errorMessage);
  } else {
    errorMessage = "Unknown send failure";
    toThrow = new Error(errorMessage);
  }

  console.error(
    `[email] Failed to send "${subject}" to ${to} (franchise: ${franchise}): ${errorMessage}`
  );

  if (reservationId && notificationType) {
    logNotification({
      reservation_id: reservationId,
      channel: "email",
      notification_type: notificationType,
      recipient: to,
      subject,
      status: "failed",
      error_message: errorMessage,
    }).catch((err) => console.error("[notification-log] Log failed:", err));
  }

  throw toThrow;
}
