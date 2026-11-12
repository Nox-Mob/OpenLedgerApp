// A small SMTP client for self-hosted instances (S-16). It runs in the apps' Cloudflare
// Workers over TCP sockets (`cloudflare:sockets`). Supports implicit TLS (port 465),
// STARTTLS (587) and plain (local relays), AUTH PLAIN and LOGIN, and one recipient per
// email. Port 25 is blocked by Cloudflare; use 587 or 465.
import { EmailSendError, type EmailMessage, type EmailTransport } from "./types";

export type SmtpSecurity = "starttls" | "tls" | "none";

export type SmtpConfig = {
  host: string;
  port: number;
  security: SmtpSecurity;
  username?: string | null;
  password?: string | null;
  /** The name this server gives in EHLO. */
  clientName?: string;
};

/** The parts of a Cloudflare socket the client uses (also easy to fake in tests). */
export type SmtpSocket = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  startTls(): SmtpSocket;
  close(): Promise<void> | void;
};

export type SmtpConnect = (
  address: { hostname: string; port: number },
  options: { secureTransport: "off" | "on" | "starttls"; allowHalfOpen: boolean },
) => SmtpSocket;

async function cloudflareConnect(): Promise<SmtpConnect> {
  const mod = (await import(/* @vite-ignore */ "cloudflare:sockets" as string)) as {
    connect: SmtpConnect;
  };
  return mod.connect;
}

const enc = new TextEncoder();

class Conversation {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = "";
  private decoder = new TextDecoder();

  constructor(private socket: SmtpSocket) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  /** One full reply (multi-line replies use "250-" until the last "250 "). */
  async reply(): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    for (;;) {
      let nl = this.buffer.indexOf("\n");
      while (nl === -1) {
        const { value, done } = await this.reader.read();
        if (done) throw new EmailSendError("The mail server closed the connection.", true);
        this.buffer += this.decoder.decode(value, { stream: true });
        nl = this.buffer.indexOf("\n");
      }
      const line = this.buffer.slice(0, nl).replace(/\r$/, "");
      this.buffer = this.buffer.slice(nl + 1);
      lines.push(line);
      if (/^\d{3}( |$)/.test(line)) return { code: Number(line.slice(0, 3)), lines };
      if (!/^\d{3}-/.test(line))
        throw new EmailSendError(`Unexpected reply from the mail server: ${line}`, true);
    }
  }

  async write(data: string): Promise<void> {
    await this.writer.write(enc.encode(data));
  }

  async command(cmd: string, expect: number[], label = cmd.split(" ")[0] ?? cmd) {
    await this.write(`${cmd}\r\n`);
    const r = await this.reply();
    if (!expect.includes(r.code)) {
      const text = r.lines.join(" ").slice(0, 300);
      // 4xx is temporary, 5xx permanent (RFC 5321).
      throw new EmailSendError(`${label} refused: ${text}`, r.code >= 400 && r.code < 500);
    }
    return r;
  }

  /** Hand the socket over (STARTTLS): release the stream locks first. */
  release(): SmtpSocket {
    this.reader.releaseLock();
    this.writer.releaseLock();
    return this.socket;
  }

  async close() {
    try {
      this.reader.releaseLock();
      this.writer.releaseLock();
    } catch {
      /* already released */
    }
    await this.socket.close();
  }
}

const b64 = (s: string) => {
  let bin = "";
  for (const b of enc.encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
};

const wrap = (s: string) => s.replace(/(.{76})/g, "$1\r\n");

/** RFC 2047 for non-ASCII header values. */
function headerValue(s: string): string {
  const clean = s.replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${b64(clean)}?=`;
}

/** "Name <a@b>" → "a@b" */
export function addressOf(mailbox: string): string {
  const m = /<([^>]+)>/.exec(mailbox);
  return (m ? m[1]! : mailbox).trim();
}

function mailbox(value: string): string {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (!m || !m[1]) return addressOf(value);
  const name = m[1].replace(/^"|"$/g, "");
  return /^[\x20-\x7e]*$/.test(name)
    ? `"${name.replace(/"/g, "'")}" <${m[2]}>`
    : `${headerValue(name)} <${m[2]}>`;
}

/** The message as MIME: multipart/alternative with plain text and HTML, both base64. */
export function buildMime(
  message: EmailMessage,
  opts: { now?: Date; messageId?: string } = {},
): string {
  const boundary = `oah-${crypto.randomUUID()}`;
  const domain = addressOf(message.from).split("@")[1] ?? "localhost";
  const headers: Array<[string, string]> = [
    ["From", mailbox(message.from)],
    ["To", mailbox(message.to)],
    ["Subject", headerValue(message.subject)],
    ["Date", (opts.now ?? new Date()).toUTCString().replace("GMT", "+0000")],
    ["Message-ID", opts.messageId ?? `<${crypto.randomUUID()}@${domain}>`],
    ["MIME-Version", "1.0"],
  ];
  if (message.replyTo) headers.push(["Reply-To", mailbox(message.replyTo)]);
  for (const [k, v] of Object.entries(message.headers ?? {})) {
    if (/^[A-Za-z0-9-]+$/.test(k)) headers.push([k, headerValue(v)]);
  }
  headers.push(["Content-Type", `multipart/alternative; boundary="${boundary}"`]);
  return [
    ...headers.map(([k, v]) => `${k}: ${v}`),
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(message.text)),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(message.html)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export function smtpTransport(
  config: SmtpConfig,
  opts: { connect?: SmtpConnect } = {},
): EmailTransport {
  return {
    kind: "smtp",
    async send(message: EmailMessage) {
      const connect = opts.connect ?? (await cloudflareConnect());
      const secureTransport =
        config.security === "tls" ? "on" : config.security === "starttls" ? "starttls" : "off";
      let socket: SmtpSocket;
      try {
        socket = connect(
          { hostname: config.host, port: config.port },
          { secureTransport, allowHalfOpen: false },
        );
      } catch (error) {
        throw new EmailSendError(
          `Could not connect to ${config.host}:${config.port}: ${(error as Error).message}`,
          true,
        );
      }
      let c = new Conversation(socket);
      const name = config.clientName ?? "openapphub.local";
      try {
        const greeting = await c.reply();
        if (greeting.code !== 220)
          throw new EmailSendError(`The mail server said: ${greeting.lines.join(" ")}`, true);
        let ehlo = await c.command(`EHLO ${name}`, [250]);
        if (config.security === "starttls") {
          if (!ehlo.lines.some((l) => /^250[ -]STARTTLS/i.test(l)))
            throw new EmailSendError(
              "The mail server doesn't offer STARTTLS. Choose TLS or no encryption.",
              false,
            );
          await c.command("STARTTLS", [220]);
          c = new Conversation(c.release().startTls());
          ehlo = await c.command(`EHLO ${name}`, [250]);
        }
        if (config.username) {
          const auth = ehlo.lines.find((l) => /^250[ -]AUTH/i.test(l)) ?? "";
          if (/\bPLAIN\b/i.test(auth) || !/\bLOGIN\b/i.test(auth)) {
            await c.command(
              `AUTH PLAIN ${b64(`\0${config.username}\0${config.password ?? ""}`)}`,
              [235],
              "Sign-in",
            );
          } else {
            await c.command("AUTH LOGIN", [334], "Sign-in");
            await c.command(b64(config.username), [334], "Sign-in");
            await c.command(b64(config.password ?? ""), [235], "Sign-in");
          }
        }
        await c.command(`MAIL FROM:<${addressOf(message.from)}>`, [250], "Sender");
        await c.command(`RCPT TO:<${addressOf(message.to)}>`, [250, 251], "Recipient");
        await c.command("DATA", [354]);
        // Dot-stuffing: a line starting with "." gets another one (RFC 5321 §4.5.2).
        const body = buildMime(message).replace(/\r\n\./g, "\r\n..");
        await c.write(`${body}\r\n.\r\n`);
        const done = await c.reply();
        if (done.code !== 250) {
          throw new EmailSendError(
            `Message refused: ${done.lines.join(" ")}`,
            done.code >= 400 && done.code < 500,
          );
        }
        const id = /queued as\s+(\S+)/i.exec(done.lines.join(" "))?.[1] ?? null;
        try {
          await c.command("QUIT", [221]);
        } catch {
          /* the message is accepted; a rude QUIT doesn't matter */
        }
        return { id };
      } catch (error) {
        if (error instanceof EmailSendError) throw error;
        throw new EmailSendError(`Mail server error: ${(error as Error).message}`, true);
      } finally {
        await c.close().catch(() => undefined);
      }
    },
  };
}
