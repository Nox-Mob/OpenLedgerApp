// Small crypto helpers for email (Web Crypto: Workers, Node 22 and browsers alike).
// - Unsubscribe links are signed (HMAC-SHA-256), so nobody can unsubscribe someone else.
// - A self-hosted instance's SMTP password is encrypted (AES-GCM) before it's stored.
// Both keys are derived (HKDF) from one server secret, the Supabase service role key,
// which the sender has anyway. Rotating that key invalidates old links and means the
// SMTP password has to be entered again; nothing else depends on it.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(secret: string, info: string, usage: "sign" | "encrypt"): Promise<CryptoKey> {
  if (!secret) throw new Error("The server secret is missing.");
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, [
    "deriveKey",
  ]);
  const params = {
    name: "HKDF",
    hash: "SHA-256",
    salt: enc.encode("openapphub-email"),
    info: enc.encode(info),
  };
  return usage === "sign"
    ? crypto.subtle.deriveKey(params, base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, [
        "sign",
        "verify",
      ])
    : crypto.subtle.deriveKey(params, base, { name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);
}

/** Signature for an unsubscribe link: user + category. */
export async function signUnsubscribe(
  secret: string,
  userId: string,
  category: string,
): Promise<string> {
  const key = await derive(secret, "unsubscribe", "sign");
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${userId}:${category}`));
  return b64url(new Uint8Array(sig));
}

export async function verifyUnsubscribe(
  secret: string,
  userId: string,
  category: string,
  signature: string,
): Promise<boolean> {
  try {
    const key = await derive(secret, "unsubscribe", "sign");
    return await crypto.subtle.verify(
      "HMAC",
      key,
      fromB64url(signature) as BufferSource,
      enc.encode(`${userId}:${category}`),
    );
  } catch {
    return false;
  }
}

/** "v1.<iv>.<ciphertext>" */
export async function encryptSecret(secret: string, plaintext: string): Promise<string> {
  const key = await derive(secret, "smtp-password", "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

/** Null when it can't be decrypted (the server secret changed): ask for the password again. */
export async function decryptSecret(
  secret: string,
  stored: string | null | undefined,
): Promise<string | null> {
  if (!stored) return null;
  const [v, iv, ct] = stored.split(".");
  if (v !== "v1" || !iv || !ct) return null;
  try {
    const key = await derive(secret, "smtp-password", "encrypt");
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(iv) as BufferSource },
      key,
      fromB64url(ct) as BufferSource,
    );
    return dec.decode(pt);
  } catch {
    return null;
  }
}
