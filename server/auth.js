import crypto from "node:crypto";

// Every install gets its own signed token. Nothing secret ships in the
// extension: the signing secret lives only on the server, so a copied zip
// cannot mint tokens offline, and abuse can be limited or revoked per install.
const TOKEN_VERSION = "v1";

function signingSecret() {
  const explicit = process.env.INSTALL_SECRET?.trim();
  if (explicit) return explicit;
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (!openai) return null;
  return crypto.createHmac("sha256", "aurasolve-install-secret").update(openai).digest("hex");
}

function sign(id, secret) {
  return crypto.createHmac("sha256", secret).update(`${TOKEN_VERSION}.${id}`).digest("base64url");
}

export function issueToken() {
  const secret = signingSecret();
  if (!secret) throw new Error("Server signing secret is not configured.");
  const id = crypto.randomBytes(18).toString("base64url");
  return {installId: id, token: `${TOKEN_VERSION}.${id}.${sign(id, secret)}`};
}

export function verifyToken(token) {
  const secret = signingSecret();
  if (!secret || typeof token !== "string" || token.length > 200) return null;
  const [version, id, signature] = token.split(".");
  if (version !== TOKEN_VERSION || !id || !signature) return null;
  const expected = Buffer.from(sign(id, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  if (revoked().has(id)) return null;
  return id;
}

function revoked() {
  return new Set(String(process.env.REVOKED_INSTALLS || "").split(",").map(value => value.trim()).filter(Boolean));
}

export function bearer(req) {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

// Browsers attach Origin to cross-site requests. Websites are refused, so a
// page cannot borrow a visitor's token. Set EXTENSION_IDS to pin the store id.
export function originAllowed(origin) {
  if (!origin || origin === "null") return true;
  const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  if (!match) return false;
  const pinned = String(process.env.EXTENSION_IDS || "").split(",").map(value => value.trim()).filter(Boolean);
  return !pinned.length || pinned.includes(match[1]);
}

export function createLimiter(limit, windowMs) {
  const buckets = new Map();
  return key => {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now > bucket.reset) {
      bucket = {count: 0, reset: now + windowMs};
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (buckets.size > 50_000) for (const [name, value] of buckets) if (now > value.reset) buckets.delete(name);
    return bucket.count <= limit;
  };
}
