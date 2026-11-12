// Email types shared by the templates, the transports and the sender (S-16).
import type { AppId } from "../supabase/hosted";

export type EmailCategory = "essential" | "reminders" | "digest" | "billing" | "org_activity";

/** A row claimed from public.email_outbox (public.claim_emails). */
export type OutboxRow = {
  id: string;
  org_id: string | null;
  app: string;
  template: string;
  category: EmailCategory;
  to_user_id: string | null;
  to_email: string | null;
  to_name: string | null;
  org_name: string | null;
  org_time_zone: string | null;
  data: Record<string, unknown>;
  attempts: number;
};

/** A rendered email, ready for a transport. */
export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | undefined;
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
  /** Stable per outbox row, so a retried send is not delivered twice (Resend Idempotency-Key). */
  idempotencyKey?: string;
};

export type SendResult = { id: string | null };

/** Thrown by a transport. `retry` false means retrying won't help (bad address, bad credentials). */
export class EmailSendError extends Error {
  readonly retry: boolean;
  constructor(message: string, retry: boolean) {
    super(message);
    this.name = "EmailSendError";
    this.retry = retry;
  }
}

export type EmailTransport = {
  readonly kind: "resend" | "smtp";
  send(message: EmailMessage): Promise<SendResult>;
};

/** What templates need to build links. */
export type RenderContext = {
  /** Each app's origin (hosted: the suite URLs; self-hosted: the app's own origin). */
  urls: Partial<Record<AppId, string>>;
  /** Where people change their email choices. */
  preferencesUrl: string;
  /** One-click unsubscribe for this row's category, when it can be switched off. */
  unsubscribeUrl: string | null;
};
