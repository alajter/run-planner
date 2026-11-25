// The one-person login: a passphrase from the environment, then a signed cookie (HMAC, Web Crypto,
// so the middleware can check it at the edge).
export const COOKIE = "rp_session";
const DAYS = 60;

async function key(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");

export async function sign(): Promise<{ value: string; maxAge: number }> {
  const exp = String(Date.now() + DAYS * 86_400_000);
  const sig = hex(await crypto.subtle.sign("HMAC", await key(), new TextEncoder().encode(exp)));
  return { value: `${exp}.${sig}`, maxAge: DAYS * 86_400 };
}

export async function valid(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const bytes = new Uint8Array(sig.match(/../g)?.map(h => parseInt(h, 16)) ?? []);
  return crypto.subtle.verify("HMAC", await key(), bytes, new TextEncoder().encode(exp));
}

/** Constant-time passphrase check. */
export function passphraseOk(given: string): boolean {
  const want = process.env.APP_PASSPHRASE ?? "";
  if (want.length < 12) return false;
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(want);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
