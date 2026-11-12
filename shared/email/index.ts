// Suite email (S-16). Server-only parts: deliver.ts, unsubscribe.ts.
export * from "./types";
export { renderEmail, hasTemplate, TEMPLATE_NAMES } from "./templates";
export { resendTransport } from "./resend";
export {
  smtpTransport,
  buildMime,
  type SmtpConfig,
  type SmtpSecurity,
  type SmtpConnect,
  type SmtpSocket,
} from "./smtp";
export { signUnsubscribe, verifyUnsubscribe, encryptSecret, decryptSecret } from "./secret";
