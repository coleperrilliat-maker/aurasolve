import crypto from "node:crypto";

// Stripe is the only store for accounts: one customer per email, the
// subscription on that customer, and the free-solve count in its metadata.
// Nothing about payments is kept on this server, so redeploys lose nothing.

export const PLANS = {
  weekly: {lookup: "aurasolve_weekly", amount: 899, interval: "week", introCoupon: "aurasolve_first_week", introOff: 800,
    title: "Weekly", price: "Try for only $0.99", then: "Renews for $8.99 a week"},
  monthly: {lookup: "aurasolve_monthly", amount: 999, interval: "month", introCoupon: "aurasolve_first_month", introOff: 500,
    title: "Monthly", price: "$4.99 first month", then: "then $9.99/month"},
  yearly: {lookup: "aurasolve_yearly", amount: 4000, interval: "year",
    title: "Yearly", price: "$40.00/year", then: "about $0.11 a day"},
};
const PAID = new Set(["active", "trialing", "past_due"]);
const SESSION_DAYS = 90;
const CODE_MINUTES = 10;

export function paywallEnabled() {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}
export function freeSolves() {
  const value = Number(process.env.FREE_SOLVES);
  // Hard paywall by default: no free solves unless FREE_SOLVES is set.
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function secret() {
  const explicit = process.env.SESSION_SECRET?.trim() || process.env.INSTALL_SECRET?.trim();
  if (explicit) return explicit;
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (!openai) throw new Error("Server signing secret is not configured.");
  return crypto.createHmac("sha256", "aurasolve-session-secret").update(openai).digest("hex");
}
const hmac = value => crypto.createHmac("sha256", secret()).update(value).digest("base64url");
const same = (a, b) => {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}

/* ---------- Email sign-in codes ---------- */
// The challenge carries the email and expiry, signed together with the code,
// so the server never has to remember codes.
export function createChallenge(email, now = Date.now()) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const expires = now + CODE_MINUTES * 60_000;
  const body = Buffer.from(JSON.stringify({email, expires})).toString("base64url");
  return {code, challenge: `${body}.${hmac(`code.${body}.${code}`)}`};
}
export function checkChallenge(challenge, code, now = Date.now()) {
  if (typeof challenge !== "string" || challenge.length > 600) return null;
  const [body, signature] = challenge.split(".");
  const clean = String(code || "").replace(/\D/g, "");
  if (!body || !signature || clean.length !== 6 || !same(signature, hmac(`code.${body}.${clean}`))) return null;
  try {
    const {email, expires} = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return now < expires ? normalizeEmail(email) : null;
  } catch { return null; }
}

/* ---------- Sessions ---------- */
export function issueSession(email, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({email, expires: now + SESSION_DAYS * 86_400_000})).toString("base64url");
  return `s1.${body}.${hmac(`session.${body}`)}`;
}
export function readSession(token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 600) return null;
  const [version, body, signature] = token.split(".");
  if (version !== "s1" || !body || !signature || !same(signature, hmac(`session.${body}`))) return null;
  try {
    const {email, expires} = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return now < expires ? normalizeEmail(email) : null;
  } catch { return null; }
}

// The browser page never receives the session. It gets a two-minute handoff
// that only the extension which started login can redeem, because only that
// extension knows the verifier whose hash was sent with the login.
const HANDOFF_MS = 2 * 60_000;
export function pkceChallenge(verifier) {
  return crypto.createHash("sha256").update(String(verifier)).digest("base64url");
}
export function issueHandoff(email, challenge, now = Date.now()) {
  const id = crypto.randomBytes(16).toString("base64url");
  const body = Buffer.from(JSON.stringify({email, challenge, id, expires: now + HANDOFF_MS})).toString("base64url");
  return `h1.${body}.${hmac(`handoff.${body}`)}`;
}
export function readHandoff(token, verifier, now = Date.now()) {
  if (typeof token !== "string" || token.length > 900 || typeof verifier !== "string" || verifier.length < 32 || verifier.length > 128) return null;
  const [version, body, signature] = token.split(".");
  if (version !== "h1" || !body || !signature || !same(signature, hmac(`handoff.${body}`))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const email = normalizeEmail(data.email);
    const expected = pkceChallenge(verifier);
    if (!email || now > data.expires || typeof data.challenge !== "string" || data.challenge.length !== expected.length || !same(data.challenge, expected)) return null;
    return {email, id: String(data.id || ""), expires: data.expires};
  } catch { return null; }
}

export function randomNonce() {
  return crypto.randomBytes(16).toString("base64url");
}

export function verifyStripeEvent(raw, header, secret, now = Date.now()) {
  if (!secret || typeof raw !== "string" || typeof header !== "string") return null;
  const items = header.split(",").map(part => {
    const split = part.indexOf("=");
    return split < 0 ? ["", ""] : [part.slice(0, split), part.slice(split + 1)];
  });
  const timestamp = items.find(([key]) => key === "t")?.[1];
  const signatures = items.filter(([key]) => key === "v1").map(([, value]) => value);
  const age = Math.abs(now / 1000 - Number(timestamp));
  if (!timestamp || !signatures.length || !Number.isFinite(age) || age > 5 * 60) return null;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const match = signatures.some(signature => {
    const left = Buffer.from(expected);
    const right = Buffer.from(signature);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  });
  if (!match) return null;
  try { return JSON.parse(raw); }
  catch { return null; }
}

const OAUTH_MS = 10 * 60_000;
export function issueOauth(payload, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({...payload, expires: now + OAUTH_MS})).toString("base64url");
  return `o1.${body}.${hmac(`oauth.${body}`)}`;
}
export function readOauth(token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 1500) return null;
  const [version, body, signature] = token.split(".");
  if (version !== "o1" || !body || !signature || !same(signature, hmac(`oauth.${body}`))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!(now < data.expires) || typeof data.nonce !== "string" || !data.nonce) return null;
    return data;
  } catch { return null; }
}

const RESET_MS = 30 * 60_000;
const SIGNUP_MS = 15 * 60_000;
export function issueSignup(email, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({email, expires: now + SIGNUP_MS})).toString("base64url");
  return `u1.${body}.${hmac(`signup.${body}`)}`;
}
export function readSignup(token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 900) return null;
  const [version, body, signature] = token.split(".");
  if (version !== "u1" || !body || !signature || !same(signature, hmac(`signup.${body}`))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const email = normalizeEmail(data.email);
    return email && now < data.expires ? email : null;
  } catch { return null; }
}
export function issueReset(email, nonce, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({email, nonce, expires: now + RESET_MS})).toString("base64url");
  return `r1.${body}.${hmac(`reset.${body}`)}`;
}
export function readReset(token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 900) return null;
  const [version, body, signature] = token.split(".");
  if (version !== "r1" || !body || !signature || !same(signature, hmac(`reset.${body}`))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const email = normalizeEmail(data.email);
    if (!email || !(now < data.expires) || typeof data.nonce !== "string" || !data.nonce) return null;
    return {email, nonce: data.nonce};
  } catch { return null; }
}

export async function sendMail({to, subject, text, html}, fetcher = fetch) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw Object.assign(new Error("Email isn't set up yet. Try again later."), {status: 503});
  const from = process.env.EMAIL_FROM?.trim() || "AuraSolve <login@aurasolve.io>";
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {"Authorization": `Bearer ${key}`, "Content-Type": "application/json"},
    body: JSON.stringify({from, to: [to], subject, text, html}),
  });
  if (!response.ok) throw Object.assign(new Error("We couldn't send the email. Try again."), {status: 502});
}

export async function sendCode(email, code, fetcher = fetch) {
  await sendMail({
    to: email,
    subject: `Your AuraSolve code: ${code}`,
    text: `Your AuraSolve code is ${code}\n\nIt expires in ${CODE_MINUTES} minutes. If you didn't ask for this, you can ignore this email.`,
    html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#1d2433"><p>Your AuraSolve code is</p><p style="font-size:30px;font-weight:700;letter-spacing:6px">${code}</p><p style="color:#667">It expires in ${CODE_MINUTES} minutes. If you didn't ask for this, you can ignore this email.</p></div>`,
  }, fetcher);
}

export async function sendReset(email, link, fetcher = fetch) {
  await sendMail({
    to: email,
    subject: "Reset your AuraSolve password",
    text: `Reset your AuraSolve password:\n\n${link}\n\nThis link expires in 30 minutes. If you didn't ask for this, you can ignore this email.`,
    html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#1d2433"><p>Reset your AuraSolve password.</p><p><a href="${link}">Choose a new password</a></p><p style="color:#667">This link expires in 30 minutes. If you didn't ask for this, you can ignore this email.</p></div>`,
  }, fetcher);
}

/* ---------- Stripe ---------- */
function form(params, prefix = "", out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object") form(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

export function createStripe(fetcher = fetch) {
  const call = async (method, path, params, version = "2024-06-20") => {
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    const query = method === "GET" && params ? `?${form(params)}` : "";
    const response = await fetcher(`https://api.stripe.com/v1${path}${query}`, {
      method,
      headers: {"Authorization": `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": version},
      body: method === "GET" ? undefined : form(params || {}).toString(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data?.error?.message || `Stripe request failed (${response.status}).`), {status: response.status, stripe: true});
    return data;
  };

  let catalog = null;
  // Creates the product, the three prices, and the intro coupons the first
  // time, then finds them by lookup key. No dashboard setup is needed.
  async function prices() {
    if (catalog) return catalog;
    const found = await call("GET", "/prices", {active: true, limit: 10, lookup_keys: Object.values(PLANS).map(plan => plan.lookup)});
    const byKey = Object.fromEntries((found.data || []).map(price => [price.lookup_key, price.id]));
    let product = null;
    const ids = {};
    for (const [name, plan] of Object.entries(PLANS)) {
      if (byKey[plan.lookup]) { ids[name] = byKey[plan.lookup]; continue; }
      product ||= (await call("POST", "/products", {name: "AuraSolve Pro", description: "Unlimited AuraSolve solves, AutoPilot, and Screenshot fill."})).id;
      ids[name] = (await call("POST", "/prices", {product, currency: "usd", unit_amount: plan.amount, recurring: {interval: plan.interval}, lookup_key: plan.lookup, nickname: `AuraSolve ${plan.title}`})).id;
    }
    for (const plan of Object.values(PLANS)) {
      if (!plan.introCoupon) continue;
      try { await call("GET", `/coupons/${plan.introCoupon}`); }
      catch (error) {
        if (error.status !== 404) throw error;
        await call("POST", "/coupons", {id: plan.introCoupon, amount_off: plan.introOff, currency: "usd", duration: "once", name: `AuraSolve ${plan.title} intro`});
      }
    }
    catalog = ids;
    return ids;
  }

  async function customer(email, create = true) {
    const found = await call("GET", "/customers", {email, limit: 1});
    if (found.data?.[0]) return found.data[0];
    if (!create) return null;
    return call("POST", "/customers", {email, metadata: {free_used: 0}});
  }

  async function subscriptions(customerId) {
    return (await call("GET", "/subscriptions", {customer: customerId, status: "all", limit: 20})).data || [];
  }

  return {
    call, prices, customer, subscriptions,
    async account(email) {
      const person = await customer(email);
      const subs = await subscriptions(person.id);
      const live = subs.find(sub => PAID.has(sub.status));
      const used = Number(person.metadata?.free_used) || 0;
      const plan = live ? Object.entries(PLANS).find(([, value]) => value.lookup === live.items?.data?.[0]?.price?.lookup_key)?.[0] || "pro" : null;
      return {
        email, customerId: person.id, paid: Boolean(live), plan, status: live?.status || null,
        renews: live?.current_period_end ? live.current_period_end * 1000 : null,
        cancelAtPeriodEnd: Boolean(live?.cancel_at_period_end),
        freeUsed: used, freeTotal: freeSolves(), freeLeft: Math.max(0, freeSolves() - used),
        hadSubscription: subs.length > 0,
      };
    },
    async useFree(customerId, used) {
      await call("POST", `/customers/${customerId}`, {metadata: {free_used: used + 1}});
    },
    async checkout(account, planName, base, mode = "hosted") {
      const plan = PLANS[planName];
      if (!plan) throw Object.assign(new Error("Pick a plan."), {status: 400});
      const ids = await prices();
      // Intro prices are for a first subscription only, so cancelling and
      // resubscribing doesn't restart the $0.99 week.
      const intro = plan.introCoupon && !account.hadSubscription;
      const embedded = mode === "elements";
      const suffix = Array.from(crypto.randomBytes(8), byte => "abcdefghijklmnopqrstuvwxyz"[byte % 26]).join("");
      const session = await call("POST", "/checkout/sessions", {
        mode: "subscription",
        ui_mode: embedded ? "elements" : undefined,
        customer: account.customerId,
        line_items: [{price: ids[planName], quantity: 1}],
        discounts: intro ? [{coupon: plan.introCoupon}] : undefined,
        success_url: embedded ? undefined : `${base}/install?paid=1`,
        cancel_url: embedded ? undefined : `${base}/login?pay=1`,
        return_url: embedded ? `${base}/install?paid=1&session_id={CHECKOUT_SESSION_ID}` : undefined,
        subscription_data: {metadata: {plan: planName}},
        integration_identifier: embedded ? `aurasolve_checkout_${suffix}` : undefined,
      }, embedded ? "2026-09-30.endive" : "2024-06-20");
      if (embedded) {
        if (!session.client_secret) throw Object.assign(new Error("Checkout didn't start. Try again."), {status: 502});
        return {clientSecret: session.client_secret};
      }
      return session.url;
    },
    async portal(account, base) {
      return (await call("POST", "/billing_portal/sessions", {customer: account.customerId, return_url: `${base}/install`})).url;
    },
  };
}
