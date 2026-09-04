export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
}
export interface SendEmailResult {
  status: "SENT" | "FAILED";
  error?: string;
}

/**
 * Simulated transport — this sandboxed demo has no SMTP/API credentials configured anywhere
 * (confirmed: no mail library in package.json, no SMTP_* / RESEND_* env vars). Rather than skip
 * "Email" delivery entirely, this logs the fully-rendered email and always resolves SENT, so the
 * rest of the pipeline (rule -> recipient -> template -> persisted Notification with emailStatus)
 * is real and testable end to end. Swap this one function for a real provider call (Resend,
 * Nodemailer+SMTP, etc.) when real credentials exist — nothing else in the notification system
 * needs to change.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  console.log(`[simulated email] to=${input.to} subject="${input.subject}"\n${input.body}`);
  return { status: "SENT" };
}
