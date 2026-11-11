import {BUILD_VERSION} from '../src/shared/version.js';
import http from "node:http";
import {readFile, stat} from "node:fs/promises";
import nodePath from "node:path";
import {fileURLToPath} from "node:url";
import {solveWithOpenAI, pickModel, askOpenAI, answerFormQuestion, answerQuiz, FORM_KINDS} from "./openai.js";
import {issueToken, verifyToken, bearer, originAllowed, createLimiter} from "./auth.js";
import {PLANS, paywallEnabled, freeSolves, normalizeEmail, createChallenge, checkChallenge, issueSession, readSession, issueHandoff, readHandoff, sendCode, sendReset, issueOauth, readOauth, issueReset, readReset, randomNonce, createStripe} from "./billing.js";
import {createMemoryUsers, createPostgresUsers} from "./users.js";
import {hashPassword, verifyPassword, passwordOk, sameText, dummyPasswordHash} from "./passwords.js";
import {googleConfigured, googleStartUrl, googleIdentity} from "./google.js";

const PORT = Number(process.env.PORT) || 8787;
const MAX_BODY = 8_000_000;
const perIp = createLimiter(60, 60_000);
const perInstall = createLimiter(40, 60_000);
const perInstallDay = createLimiter(1500, 24 * 60 * 60_000);
const installsPerIp = createLimiter(10, 60 * 60_000);
const codesPerEmail = createLimiter(5, 60 * 60_000);
const codesPerIp = createLimiter(20, 60 * 60_000);
const guessesPerChallenge = createLimiter(5, 15 * 60_000);
const loginsPerIp = createLimiter(30, 15 * 60_000);
const loginsPerEmail = createLimiter(10, 15 * 60_000);
const accountCache = new Map();
let stripe = createStripe();
let mailer = sendCode;
let resetMailer = sendReset;
let users = createMemoryUsers();
let googleFetcher = fetch;
// Tests swap in fakes for Stripe, email, and the account directory.
export function setBillingDeps({stripe: nextStripe, mailer: nextMailer, resetMailer: nextReset, users: nextUsers, googleFetcher: nextGoogle} = {}) {
  if (nextStripe) stripe = nextStripe;
  if (nextMailer) mailer = nextMailer;
  if (nextReset) resetMailer = nextReset;
  if (nextUsers) users = nextUsers;
  if (nextGoogle) googleFetcher = nextGoogle;
  accountCache.clear();
}
async function openUsers() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is not set. Password and Google accounts will reset when the server restarts.");
    return;
  }
  users = await createPostgresUsers(url);
}
// Extensions released before per-install tokens send this old public value.
// It is accepted only until store users have had time to update.
const LEGACY_KEY = "81327b4960956fd15e9f8a01aa27151852e6b5e0c93c4701561ad675f1bea2a5";
const LEGACY_UNTIL = Date.parse("2026-11-22T00:00:00Z");
const docsRoot = nodePath.resolve(fileURLToPath(new URL("../docs/", import.meta.url)));
const iconsRoot = nodePath.resolve(fileURLToPath(new URL("../icons/", import.meta.url)));
const mimeByExt = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};
const publicFiles = new Map([
  ["/", {file: nodePath.join(docsRoot, "index.html"), type: "text/html; charset=utf-8"}],
  ["/terms", {file: nodePath.join(docsRoot, "terms.html"), type: "text/html; charset=utf-8"}],
  ["/privacy", {file: nodePath.join(docsRoot, "privacy.html"), type: "text/html; charset=utf-8"}],
  ["/install", {file: nodePath.join(docsRoot, "install.html"), type: "text/html; charset=utf-8"}],
  ["/login", {file: nodePath.join(docsRoot, "login.html"), type: "text/html; charset=utf-8"}],
  ["/auth/done", {file: nodePath.join(docsRoot, "auth-done.html"), type: "text/html; charset=utf-8"}],
  ["/style.css", {file: nodePath.join(docsRoot, "style.css"), type: "text/css; charset=utf-8"}],
  ["/script.js", {file: nodePath.join(docsRoot, "script.js"), type: "text/javascript; charset=utf-8"}],
  ["/app-icon.png", {file: nodePath.join(docsRoot, "app-icon.png"), type: "image/png"}],
  ["/icon.png", {file: nodePath.join(docsRoot, "icon.png"), type: "image/png"}],
  ["/icons/icon-32.png", {file: nodePath.join(iconsRoot, "icon-32.png"), type: "image/png"}],
  ["/icons/icon-128.png", {file: nodePath.join(iconsRoot, "icon-128.png"), type: "image/png"}],
]);

function resolveDocsAsset(requestPath) {
  if (!requestPath || requestPath.includes("\0")) return null;
  const decoded = requestPath;
  if (!decoded.startsWith("/") || decoded.includes("..")) return null;
  const relative = decoded.slice(1);
  if (!relative || relative.endsWith("/")) return null;
  const absolute = nodePath.resolve(docsRoot, relative);
  if (absolute !== docsRoot && !absolute.startsWith(docsRoot + nodePath.sep)) return null;
  const ext = nodePath.extname(absolute).toLowerCase();
  const type = mimeByExt[ext];
  if (!type) return null;
  return {file: absolute, type};
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

// Returns the caller's install id, or sends the error and returns null.
function authorize(req, res) {
  const ip = clientIp(req);
  if (!perIp(ip)) { sendJson(res, 429, {error: "Too many requests. Try again in a minute."}); return null; }
  let install = verifyToken(bearer(req));
  if (!install && req.headers["x-aurasolve-key"] === LEGACY_KEY && Date.now() < LEGACY_UNTIL) install = `legacy:${ip}`;
  if (!install) { sendJson(res, 401, {error: "AuraSolve needs to reconnect. Reload the extension and try again."}); return null; }
  if (!perInstall(install)) { sendJson(res, 429, {error: "Too many requests. Try again in a minute."}); return null; }
  if (!perInstallDay(install)) { sendJson(res, 429, {error: "Daily limit reached. Try again tomorrow."}); return null; }
  return install;
}

function requestOrigin(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const proto = req.headers["x-forwarded-proto"] || (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
const usedHandoffs = new Map();
function takeHandoff(id, expires) {
  const now = Date.now();
  for (const [key, exp] of usedHandoffs) if (exp <= now) usedHandoffs.delete(key);
  if (!id || usedHandoffs.has(id)) return false;
  usedHandoffs.set(id, expires);
  return true;
}
function readCookie(req, name) {
  const header = req.headers.cookie || "";
  const found = header.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  if (!found) return "";
  try { return decodeURIComponent(found.slice(name.length + 1)); } catch { return ""; }
}
function sessionCookie(req, token) {
  const secure = requestOrigin(req).startsWith("https://") ? "; Secure" : "";
  const value = token ? encodeURIComponent(token) : "";
  const maxAge = token ? 90 * 24 * 60 * 60 : 0;
  return `aura_session=${value}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}
function oauthCookie(req, token) {
  const secure = requestOrigin(req).startsWith("https://") ? "; Secure" : "";
  const value = token ? encodeURIComponent(token) : "";
  const maxAge = token ? 10 * 60 : 0;
  return `aura_oauth=${value}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}
function redirect(res, location, cookies = []) {
  res.writeHead(302, {"Location": location, "Cache-Control": "no-store", ...(cookies.length ? {"Set-Cookie": cookies} : {})});
  res.end();
}
function queryOf(req) {
  return new URL(req.url || "/", "http://localhost").searchParams;
}
const WEB_LOGIN = new Set([
  "/api/v1/auth/web/start",
  "/api/v1/auth/web/verify",
  "/api/v1/auth/web/logout",
  "/api/v1/auth/web/register",
  "/api/v1/auth/web/login",
  "/api/v1/auth/web/forgot",
  "/api/v1/auth/web/reset",
  "/api/v1/auth/handoff",
]);
function publicBase(req) {
  const configured = process.env.PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host || "aurasolve.io";
  const proto = req.headers["x-forwarded-proto"] || (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

async function loadAccount(email, fresh = false) {
  const cached = accountCache.get(email);
  // Paid status is cached briefly; free counts are always read live.
  if (!fresh && cached?.account.paid && Date.now() - cached.at < 5 * 60_000) return cached.account;
  const account = await stripe.account(email);
  accountCache.set(email, {account, at: Date.now()});
  if (accountCache.size > 20_000) accountCache.clear();
  return account;
}

function publicAccount(account) {
  if (!account) return {paywall: paywallEnabled(), signedIn: false, freeTotal: freeSolves()};
  const {customerId, hadSubscription, ...rest} = account;
  return {paywall: paywallEnabled(), signedIn: true, introEligible: !hadSubscription, ...rest};
}

// Returns {account, free} when the caller may solve, or sends 402 and returns null.
async function entitle(req, res) {
  if (!paywallEnabled()) return {account: null, free: false};
  const email = readSession(req.headers["x-aurasolve-session"]);
  if (!email) { sendJson(res, 402, {code: "signin", error: "Sign in to AuraSolve to keep solving. Open the AuraSolve panel and go to Account."}); return null; }
  let account;
  try { account = await loadAccount(email); }
  catch { sendJson(res, 503, {error: "AuraSolve couldn't check your plan. Try again in a minute."}); return null; }
  if (account.paid) return {account, free: false};
  if (account.freeLeft > 0) return {account, free: true};
  sendJson(res, 402, {code: "paywall", error: "You've used your free solves. Open the AuraSolve panel and pick a plan to keep going."});
  return null;
}

async function spendFree(grant) {
  if (!grant?.free) return;
  try {
    await stripe.useFree(grant.account.customerId, grant.account.freeUsed);
    accountCache.delete(grant.account.email);
  } catch {}
}

async function readJson(req, res) {
  try {
    const value = JSON.parse(await readBody(req));
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {}
  sendJson(res, 400, {error: "Invalid JSON body."});
  return null;
}

function billingPage(res, title, message) {
  res.writeHead(200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"});
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · AuraSolve</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px -apple-system,Segoe UI,sans-serif;background:#f5f7fb;color:#1d2433}main{background:#fff;border-radius:16px;padding:36px 40px;max-width:420px;text-align:center;box-shadow:0 10px 40px #1d24331a}img{width:56px;height:56px}h1{font-size:22px;margin:14px 0 8px}p{color:#5b6475;line-height:1.5}</style></head><body><main><img src="/icons/icon-128.png" alt=""><h1>${title}</h1><p>${message}</p></main></body></html>`);
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {"Content-Type": "application/json", ...headers});
  res.end(JSON.stringify(payload));
}

async function sendPublicFile(res, file) {
  const body = await readFile(file.file);
  const longCache = file.type.startsWith("image/") || file.type === "video/mp4";
  res.writeHead(200, {
    "Content-Type": file.type,
    "Cache-Control": longCache ? "public, max-age=86400" : "public, max-age=300",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleRequest(req, res) {
  const origin = req.headers.origin;
  const trusted = originAllowed(origin);
  if (origin && trusted && origin !== "null") {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-AuraSolve-Key, X-AuraSolve-Session");
  }
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  let path;
  try {
    path = decodeURIComponent(req.url?.split("?")[0] || "/");
  } catch {
    sendJson(res, 400, {error: "Invalid request path."});
    return;
  }

  if (req.method === "GET") {
    const exact = publicFiles.get(path);
    const asset = exact || resolveDocsAsset(path);
    if (asset) {
      try {
        await stat(asset.file);
        await sendPublicFile(res, asset);
      } catch {
        sendJson(res, exact ? 500 : 404, {error: exact ? "Landing page unavailable" : "Not found"});
      }
      return;
    }
  }

  if (path === "/billing/done" && req.method === "GET") {
    billingPage(res, "You're all set", "Your AuraSolve plan is updated. Close this tab and go back to AuraSolve. It may take a few seconds to show up.");
    return;
  }
  if (path === "/billing/cancelled" && req.method === "GET") {
    billingPage(res, "No charge made", "Checkout was cancelled and you weren't charged. You can pick a plan anytime from the AuraSolve panel.");
    return;
  }

  if (path === "/api/v1/health" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      service: "aurasolve",
      version: BUILD_VERSION,
      model: pickModel(),
      keyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
      signIn: {password: Boolean(process.env.DATABASE_URL?.trim()), google: googleConfigured()},
      // Prompts, model routing, and answer checks live here. Push to main to
      // change them on Railway without a Chrome Web Store resubmission.
      answering: "server",
    });
    return;
  }

  const webLogin = WEB_LOGIN.has(path);
  const ownSite = req.headers.origin === requestOrigin(req);
  if (path.startsWith("/api/") && req.method === "POST" && !trusted && !(webLogin && ownSite)) {
    sendJson(res, 403, {error: "Not allowed."});
    return;
  }

  if (path === "/api/v1/install" && req.method === "POST") {
    if (!installsPerIp(clientIp(req))) {
      sendJson(res, 429, {error: "Too many new installs from this network. Try again later."});
      return;
    }
    try {
      sendJson(res, 200, issueToken());
    } catch {
      sendJson(res, 503, {error: "AuraSolve Cloud is not ready. Try again in a minute."});
    }
    return;
  }

  if (path === "/api/v1/plans" && req.method === "GET") {
    sendJson(res, 200, {paywall: paywallEnabled(), freeTotal: freeSolves(), plans: Object.entries(PLANS).map(([id, plan]) => ({id, title: plan.title, price: plan.price, then: plan.then}))});
    return;
  }

  if (path === "/api/v1/auth/session" && req.method === "GET") {
    const email = readSession(readCookie(req, "aura_session"));
    sendJson(res, 200, email ? {signedIn: true, email} : {signedIn: false});
    return;
  }

  if (path === "/api/v1/auth/web/start" && req.method === "POST") {
    const payload = await readJson(req, res);
    if (!payload) return;
    const email = normalizeEmail(payload.email);
    if (!email) { sendJson(res, 400, {error: "Enter a valid email address."}); return; }
    if (!codesPerIp(clientIp(req)) || !codesPerEmail(email)) { sendJson(res, 429, {error: "Too many codes requested. Wait a bit and try again."}); return; }
    const {code, challenge} = createChallenge(email);
    try { await mailer(email, code); }
    catch (error) { sendJson(res, error.status || 502, {error: error.message}); return; }
    sendJson(res, 200, {challenge});
    return;
  }

  if (path === "/api/v1/auth/web/verify" && req.method === "POST") {
    const payload = await readJson(req, res);
    if (!payload) return;
    if (typeof payload.challenge !== "string" || !guessesPerChallenge(payload.challenge.slice(-43))) { sendJson(res, 429, {error: "Too many tries. Request a new code."}); return; }
    const email = checkChallenge(payload.challenge, payload.code);
    if (!email) { sendJson(res, 400, {error: "That code is wrong or expired."}); return; }
    sendJson(res, 200, {ok: true, email}, {"Set-Cookie": sessionCookie(req, issueSession(email))});
    return;
  }

  if (path === "/api/v1/auth/web/logout" && req.method === "POST") {
    sendJson(res, 200, {ok: true}, {"Set-Cookie": sessionCookie(req, "")});
    return;
  }

  if ((path === "/api/v1/auth/web/register" || path === "/api/v1/auth/web/login") && req.method === "POST") {
    const payload = await readJson(req, res);
    if (!payload) return;
    const email = normalizeEmail(payload.email);
    const creating = path.endsWith("/register");
    if (!email || !passwordOk(payload.password)) {
      sendJson(res, 400, {error: creating ? "Use a valid email and a password of at least 8 characters." : "Wrong email or password."});
      return;
    }
    if (!loginsPerIp(clientIp(req)) || !loginsPerEmail(email)) {
      sendJson(res, 429, {error: "Too many sign-in attempts. Wait a bit and try again."});
      return;
    }
    const existing = await users.getByEmail(email);
    const passwordMatches = await verifyPassword(payload.password, existing?.passwordHash || await dummyPasswordHash);
    if (creating) {
      if (existing?.passwordHash) { sendJson(res, 409, {error: "An account with that email already exists. Sign in."}); return; }
      if (existing?.googleSub) { sendJson(res, 409, {error: "That email uses Google. Continue with Google."}); return; }
      try { await users.create({email, passwordHash: await hashPassword(payload.password)}); }
      catch (error) { sendJson(res, error.status || 500, {error: error.status === 409 ? "An account with that email already exists. Sign in." : "Couldn't create the account. Try again."}); return; }
    } else if (!existing?.passwordHash || !passwordMatches) {
      sendJson(res, 400, {error: existing?.googleSub && !existing.passwordHash ? "That email uses Google. Continue with Google." : "Wrong email or password."});
      return;
    }
    sendJson(res, 200, {ok: true, email}, {"Set-Cookie": sessionCookie(req, issueSession(email))});
    return;
  }

  if (path === "/api/v1/auth/web/forgot" && req.method === "POST") {
    const payload = await readJson(req, res);
    if (!payload) return;
    const email = normalizeEmail(payload.email);
    if (!email) { sendJson(res, 400, {error: "Enter a valid email address."}); return; }
    if (!codesPerIp(clientIp(req)) || !codesPerEmail(email)) { sendJson(res, 429, {error: "Too many reset emails. Wait a bit and try again."}); return; }
    const existing = await users.getByEmail(email);
    if (existing?.passwordHash) {
      const nonce = randomNonce();
      await users.setResetNonce(email, nonce);
      const link = `${publicBase(req)}/login?reset=${encodeURIComponent(issueReset(email, nonce))}`;
      try { await resetMailer(email, link); }
      catch (error) { sendJson(res, error.status || 502, {error: error.message}); return; }
    }
    sendJson(res, 200, {ok: true});
    return;
  }

  if (path === "/api/v1/auth/web/reset" && req.method === "POST") {
    const payload = await readJson(req, res);
    if (!payload) return;
    const parsed = readReset(payload.token);
    if (!parsed || !passwordOk(payload.password) || !loginsPerIp(clientIp(req))) {
      sendJson(res, 400, {error: "That reset link is invalid or expired."});
      return;
    }
    const existing = await users.getByEmail(parsed.email);
    if (!existing || !sameText(existing.resetNonce, parsed.nonce)) {
      sendJson(res, 400, {error: "That reset link is invalid or expired."});
      return;
    }
    await users.setPassword(parsed.email, await hashPassword(payload.password));
    sendJson(res, 200, {ok: true, email: parsed.email}, {"Set-Cookie": sessionCookie(req, issueSession(parsed.email))});
    return;
  }

  if (path === "/api/v1/auth/google" && req.method === "GET") {
    const query = queryOf(req);
    const extState = query.get("state") || "";
    const challenge = query.get("challenge") || "";
    const back = "/login?error=google";
    if (!googleConfigured()) { redirect(res, back); return; }
    if ((extState || challenge) && (!/^[A-Za-z0-9_-]{16,128}$/.test(extState) || !/^[A-Za-z0-9_-]{43}$/.test(challenge))) {
      redirect(res, back);
      return;
    }
    const nonce = randomNonce();
    const redirectUri = `${requestOrigin(req)}/api/v1/auth/google/callback`;
    redirect(res, googleStartUrl({redirectUri, state: nonce}), [oauthCookie(req, issueOauth({nonce, extState, challenge}))]);
    return;
  }

  if (path === "/api/v1/auth/google/callback" && req.method === "GET") {
    const query = queryOf(req);
    const fail = code => redirect(res, `/login?error=${code}`, [oauthCookie(req, "")]);
    const saved = readOauth(readCookie(req, "aura_oauth"));
    if (!saved || !sameText(saved.nonce, query.get("state") || "")) { fail("google"); return; }
    if (query.get("error")) { fail(query.get("error") === "access_denied" ? "google_denied" : "google"); return; }
    const redirectUri = `${requestOrigin(req)}/api/v1/auth/google/callback`;
    let identity;
    try { identity = await googleIdentity(query.get("code") || "", redirectUri, googleFetcher); }
    catch { fail("google"); return; }
    const email = normalizeEmail(identity?.email);
    const sub = typeof identity?.sub === "string" ? identity.sub.slice(0, 255) : "";
    if (!sub || !email || identity.email_verified !== true) { fail("google_unverified"); return; }
    let accountEmail = email;
    try {
      const byGoogle = await users.getByGoogle(sub);
      if (byGoogle) accountEmail = byGoogle.email;
      else {
        const existing = await users.getByEmail(email);
        if (existing?.passwordHash) { fail("google_linked"); return; }
        if (existing?.googleSub && existing.googleSub !== sub) { fail("google_used"); return; }
        if (existing) await users.linkGoogle(email, sub);
        else await users.create({email, googleSub: sub});
      }
    } catch { fail("google"); return; }
    const next = saved.extState && saved.challenge
      ? `/login?state=${encodeURIComponent(saved.extState)}&challenge=${encodeURIComponent(saved.challenge)}`
      : "/login";
    redirect(res, next, [sessionCookie(req, issueSession(accountEmail)), oauthCookie(req, "")]);
    return;
  }

  if (path === "/api/v1/auth/handoff" && req.method === "POST") {
    const payload = await readJson(req, res);
    if (!payload) return;
    const email = readSession(readCookie(req, "aura_session"));
    const challenge = String(payload.challenge || "");
    if (!email) { sendJson(res, 401, {error: "Sign in first."}); return; }
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) { sendJson(res, 400, {error: "That login link is invalid. Start again from AuraSolve."}); return; }
    sendJson(res, 200, {handoff: issueHandoff(email, challenge)});
    return;
  }

  if (path === "/api/v1/auth/redeem" && req.method === "POST") {
    if (!authorize(req, res)) return;
    const payload = await readJson(req, res);
    if (!payload) return;
    const handoff = readHandoff(payload.handoff, payload.verifier);
    if (!handoff || !takeHandoff(handoff.id, handoff.expires)) { sendJson(res, 400, {error: "That sign-in expired. Press Log in again."}); return; }
    let account = null;
    if (paywallEnabled()) {
      try { account = await loadAccount(handoff.email, true); }
      catch { sendJson(res, 503, {error: "Signed in, but AuraSolve couldn't load your plan. Try again in a minute."}); return; }
    }
    sendJson(res, 200, {session: issueSession(handoff.email), account: account ? publicAccount(account) : {paywall: false, signedIn: true, email: handoff.email}});
    return;
  }

  if (path === "/api/v1/auth/start" && req.method === "POST") {
    if (!authorize(req, res)) return;
    const payload = await readJson(req, res);
    if (!payload) return;
    const email = normalizeEmail(payload.email);
    if (!email) { sendJson(res, 400, {error: "Enter a valid email address."}); return; }
    if (!codesPerIp(clientIp(req)) || !codesPerEmail(email)) { sendJson(res, 429, {error: "Too many codes requested. Wait a bit and try again."}); return; }
    const {code, challenge} = createChallenge(email);
    try { await mailer(email, code); }
    catch (error) { sendJson(res, error.status || 502, {error: error.message}); return; }
    sendJson(res, 200, {challenge});
    return;
  }

  if (path === "/api/v1/auth/verify" && req.method === "POST") {
    if (!authorize(req, res)) return;
    const payload = await readJson(req, res);
    if (!payload) return;
    if (typeof payload.challenge !== "string" || !guessesPerChallenge(payload.challenge.slice(-43))) { sendJson(res, 429, {error: "Too many tries. Request a new code."}); return; }
    const email = checkChallenge(payload.challenge, payload.code);
    if (!email) { sendJson(res, 400, {error: "That code is wrong or expired."}); return; }
    let account = null;
    if (paywallEnabled()) {
      try { account = await loadAccount(email, true); }
      catch { sendJson(res, 503, {error: "Signed in, but AuraSolve couldn't load your plan. Try again in a minute."}); return; }
    }
    sendJson(res, 200, {session: issueSession(email), account: account ? publicAccount(account) : {paywall: false, signedIn: true, email}});
    return;
  }

  if (path === "/api/v1/account" && req.method === "POST") {
    if (!authorize(req, res)) return;
    const email = readSession(req.headers["x-aurasolve-session"]);
    if (!email) { sendJson(res, 200, publicAccount(null)); return; }
    if (!paywallEnabled()) { sendJson(res, 200, {paywall: false, signedIn: true, email}); return; }
    try { sendJson(res, 200, publicAccount(await loadAccount(email, true))); }
    catch { sendJson(res, 503, {error: "AuraSolve couldn't load your plan. Try again in a minute."}); }
    return;
  }

  if ((path === "/api/v1/checkout" || path === "/api/v1/portal") && req.method === "POST") {
    if (!authorize(req, res)) return;
    const payload = await readJson(req, res);
    if (!payload) return;
    if (!paywallEnabled()) { sendJson(res, 400, {error: "Plans aren't available yet. Everything is unlocked for now."}); return; }
    const email = readSession(req.headers["x-aurasolve-session"]);
    if (!email) { sendJson(res, 401, {code: "signin", error: "Sign in first."}); return; }
    try {
      const account = await loadAccount(email, true);
      if (path === "/api/v1/checkout") {
        if (account.paid) { sendJson(res, 409, {error: "You already have a plan. Use Manage subscription to change it."}); return; }
        sendJson(res, 200, {url: await stripe.checkout(account, payload.plan, publicBase(req))});
      } else {
        sendJson(res, 200, {url: await stripe.portal(account, publicBase(req))});
      }
    } catch (error) {
      sendJson(res, error.status === 400 ? 400 : 502, {error: error.status === 400 ? error.message : "Checkout is unavailable right now. Try again in a minute."});
    }
    return;
  }

  if (path === "/api/v1/solve" && req.method === "POST") {
    if (!authorize(req, res)) return;

    const payload = await readJson(req, res);
    if (!payload) return;
    const {mode, snapshot, model, effort} = payload;
    if (!["explain", "field", "autopilot"].includes(mode) || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      sendJson(res, 400, {error: "Missing mode or snapshot."});
      return;
    }

    const grant = await entitle(req, res);
    if (!grant) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });

    try {
      const solution = await solveWithOpenAI(snapshot, mode, typeof model === "string" ? model : undefined, controller.signal, effort);
      await spendFree(grant);
      sendJson(res, 200, {solution});
    } catch (error) {
      const message = error.name === "AbortError" ? "Request timed out." : error.message;
      sendJson(res, 502, {error: message});
    } finally {
      clearTimeout(timeout);
    }
    return;
  }

  if (path === "/api/v1/form" && req.method === "POST") {
    if (!authorize(req, res)) return;
    const payload = await readJson(req, res);
    if (!payload) return;
    const kind = FORM_KINDS.includes(payload.kind) ? payload.kind : null;
    const title = String(payload.title || "").slice(0, 4000);
    const options = Array.isArray(payload.options) ? [...new Set(payload.options.map(value => String(value).slice(0, 500)).filter(Boolean))].slice(0, 60) : [];
    const rows = Array.isArray(payload.rows) ? [...new Set(payload.rows.map(value => String(value).slice(0, 500)).filter(Boolean))].slice(0, 40) : [];
    const images = Array.isArray(payload.images) ? payload.images.slice(0, 10).map(item => ({label: String(item?.label || "").slice(0, 200), image: typeof item?.image === "string" ? item.image : ""})).filter(item => item.image) : [];
    const needsOptions = ["radio", "checkbox", "dropdown", "grid", "checkgrid"].includes(kind);
    if (!kind || !title.trim() || (needsOptions && !options.length) || (["grid", "checkgrid"].includes(kind) && !rows.length)) { sendJson(res, 400, {error: "That question type isn't supported yet."}); return; }
    const grant = await entitle(req, res);
    if (!grant) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    try {
      const answer = await answerFormQuestion({kind, title, description: String(payload.description || "").slice(0, 4000), options, rows, images, image: payload.image}, controller.signal);
      await spendFree(grant);
      sendJson(res, 200, {answer});
    } catch (error) {
      sendJson(res, 502, {error: error.name === "AbortError" ? "Request timed out." : error.message});
    } finally {
      clearTimeout(timeout);
    }
    return;
  }

  if (path === "/api/v1/quiz" && req.method === "POST") {
    if (!authorize(req, res)) return;
    const payload = await readJson(req, res);
    if (!payload) return;
    const questions = (Array.isArray(payload.questions) ? payload.questions : []).slice(0, 40).map((question, index) => ({
      id: String(question?.id || index).slice(0, 40),
      kind: String(question?.kind || "text").slice(0, 20),
      title: String(question?.title || "").slice(0, 2000),
      options: Array.isArray(question?.options) ? question.options.map(value => String(value).slice(0, 300)).filter(Boolean).slice(0, 40) : [],
      blanks: Array.isArray(question?.blanks) ? question.blanks.slice(0, 12).map(blank => ({
        label: String(blank?.label || "").slice(0, 200),
        options: Array.isArray(blank?.options) ? blank.options.map(value => String(value).slice(0, 200)).filter(Boolean).slice(0, 30) : [],
      })) : [],
      images: Array.isArray(question?.images) ? question.images.slice(0, 4).map(item => ({
        label: String(item?.label || "Equation").slice(0, 80),
        image: typeof item?.image === "string" ? item.image : "",
      })).filter(item => item.image) : [],
    })).filter(question => question.title.trim());
    if (!questions.length) { sendJson(res, 400, {error: "No quiz questions to answer."}); return; }
    const grant = await entitle(req, res);
    if (!grant) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    try {
      const answers = await answerQuiz(questions, controller.signal);
      await spendFree(grant);
      sendJson(res, 200, {answers});
    } catch (error) {
      sendJson(res, 502, {error: error.name === "AbortError" ? "Request timed out." : error.message});
    } finally {
      clearTimeout(timeout);
    }
    return;
  }

  if (path === "/api/v1/ask" && req.method === "POST") {
    if (!authorize(req, res)) return;
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, {error: "Invalid JSON body."});
      return;
    }
    if (!Array.isArray(payload?.messages) || !payload.messages.length || payload.messages.length > 40) {
      sendJson(res, 400, {error: "Missing messages."});
      return;
    }
    const grant = await entitle(req, res);
    if (!grant) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    try {
      const reply = await askOpenAI({messages: payload.messages, image: payload.image, solve: payload.solve === true}, controller.signal);
      await spendFree(grant);
      sendJson(res, 200, {reply});
    } catch (error) {
      sendJson(res, 502, {error: error.name === "AbortError" ? "Request timed out." : error.message});
    } finally {
      clearTimeout(timeout);
    }
    return;
  }

  sendJson(res, 404, {error: "Not found"});
}

export function createServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      // Never log request bodies, screenshots, credentials, or provider responses.
      console.error("AuraSolve request failed unexpectedly.");
      if (!res.headersSent && !res.destroyed) {
        sendJson(res, 500, {error: "AuraSolve encountered an unexpected error. Try again."});
      } else if (!res.destroyed) {
        res.end();
      }
    });
  });
}

if (process.argv[1] && nodePath.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  openUsers().then(() => {
    createServer().listen(PORT, "0.0.0.0", () => {
      console.log(`AuraSolve API listening on 0.0.0.0:${PORT}`);
    });
  }).catch(error => {
    console.error(`AuraSolve couldn't open the account database. ${error instanceof Error ? error.message : ""}`);
    process.exit(1);
  });
}
