import {BUILD_VERSION} from '../src/shared/version.js';
import http from "node:http";
import {readFile, stat} from "node:fs/promises";
import nodePath from "node:path";
import {fileURLToPath} from "node:url";
import {solveWithOpenAI, pickModel, askOpenAI} from "./openai.js";
import {issueToken, verifyToken, bearer, originAllowed, createLimiter} from "./auth.js";

const PORT = Number(process.env.PORT) || 8787;
const MAX_BODY = 4_000_000;
const perIp = createLimiter(60, 60_000);
const perInstall = createLimiter(40, 60_000);
const perInstallDay = createLimiter(1500, 24 * 60 * 60_000);
const installsPerIp = createLimiter(10, 60 * 60_000);
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

function sendJson(res, status, payload) {
  res.writeHead(status, {"Content-Type": "application/json"});
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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-AuraSolve-Key");
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

  if (path === "/api/v1/health" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      service: "aurasolve",
      version: BUILD_VERSION,
      model: pickModel(),
      keyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
      // Prompts, model routing, and answer checks live here. Push to main to
      // change them on Railway without a Chrome Web Store resubmission.
      answering: "server",
    });
    return;
  }

  if (path.startsWith("/api/") && req.method === "POST" && !trusted) {
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

  if (path === "/api/v1/solve" && req.method === "POST") {
    if (!authorize(req, res)) return;

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, {error: "Invalid JSON body."});
      return;
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      sendJson(res, 400, {error: "Expected a JSON object."});
      return;
    }
    const {mode, snapshot, model, effort} = payload;
    if (!["explain", "field", "autopilot"].includes(mode) || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      sendJson(res, 400, {error: "Missing mode or snapshot."});
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });

    try {
      const solution = await solveWithOpenAI(snapshot, mode, typeof model === "string" ? model : undefined, controller.signal, effort);
      sendJson(res, 200, {solution});
    } catch (error) {
      const message = error.name === "AbortError" ? "Request timed out." : error.message;
      sendJson(res, 502, {error: message});
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    try {
      const reply = await askOpenAI({messages: payload.messages, image: payload.image, solve: payload.solve === true}, controller.signal);
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
  createServer().listen(PORT, "0.0.0.0", () => {
    console.log(`AuraSolve API listening on 0.0.0.0:${PORT}`);
  });
}
