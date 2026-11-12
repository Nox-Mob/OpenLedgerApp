// Resend (https://resend.com): the hosted suite's email provider. One HTTPS call per email.
import { EmailSendError, type EmailMessage, type EmailTransport } from "./types";

export function resendTransport(opts: {
  apiKey: string;
  fetch?: typeof fetch;
  endpoint?: string;
}): EmailTransport {
  const doFetch = opts.fetch ?? fetch;
  const endpoint = opts.endpoint ?? "https://api.resend.com/emails";
  return {
    kind: "resend",
    async send(message: EmailMessage) {
      const headers: Record<string, string> = {
        authorization: `Bearer ${opts.apiKey}`,
        "content-type": "application/json",
      };
      // Resend keeps idempotency keys for 24 hours: a retried send isn't delivered twice.
      if (message.idempotencyKey) headers["idempotency-key"] = message.idempotencyKey;
      let res: Response;
      try {
        res = await doFetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            from: message.from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
            ...(message.replyTo ? { reply_to: message.replyTo } : {}),
            ...(message.headers && Object.keys(message.headers).length
              ? { headers: message.headers }
              : {}),
          }),
        });
      } catch (error) {
        throw new EmailSendError(`Resend could not be reached: ${(error as Error).message}`, true);
      }
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
        name?: string;
      };
      if (res.ok) return { id: body.id ?? null };
      const detail = body.message || body.name || res.statusText || "error";
      // 429 and 5xx are worth retrying; other 4xx (bad address, unverified domain, bad key) are not.
      throw new EmailSendError(
        `Resend ${res.status}: ${detail}`,
        res.status === 429 || res.status >= 500,
      );
    },
  };
}
