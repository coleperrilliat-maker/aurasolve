import {BUILD_VERSION} from '../src/shared/version.js';
import http from "node:http";
import {readFile} from "node:fs/promises";
import {solveWithOpenAI, DEFAULT_MODEL} from "./openai.js";

const PORT = Number(process.env.PORT) || 8787;
const MAX_BODY = 4_000_000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 40;
const hits = new Map();
const publicFiles = new Map([
  ["/", {url: new URL("../docs/index.html", import.meta.url), type: "text/html; charset=utf-8"}],
  ["/style.css", {url: new URL("../docs/style.css", import.meta.url), type: "text/css; charset=utf-8"}],
  ["/script.js", {url: new URL("../docs/script.js", import.meta.url), type: "text/javascript; charset=utf-8"}],
  ["/icon.png", {url: new URL("../icons/icon-128.png", import.meta.url), type: "image/png"}],
  ["/icons/icon-128.png", {url: new URL("../icons/icon-128.png", import.meta.url), type: "image/png"}],
]);

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function rateLimit(ip) {
  const now = Date.now();
  const bucket = hits.get(ip) || {count: 0, reset: now + WINDOW_MS};
  if (now > bucket.reset) {
    bucket.count = 0;
    bucket.reset = now + WINDOW_MS;
  }
  bucket.count += 1;
  hits.set(ip, bucket);
  return bucket.count <= MAX_REQUESTS;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {"Content-Type": "application/json"});
  res.end(JSON.stringify(payload));
}

async function sendPublicFile(res, file) {
  const body = await readFile(file.url);
  res.writeHead(200, {
    "Content-Type": file.type,
    "Cache-Control": file.type === "image/png" ? "public, max-age=86400" : "public, max-age=300",
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

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-AuraSolve-Key");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const path = req.url?.split("?")[0];

  if (req.method === "GET" && publicFiles.has(path)) {
    try {
      await sendPublicFile(res, publicFiles.get(path));
    } catch {
      sendJson(res, 500, {error: "Landing page unavailable"});
    }
    return;
  }

  if (path === "/api/v1/health" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      service: "aurasolve",
      version: BUILD_VERSION,
      model: process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
      keyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    });
    return;
  }

  if (path === "/api/v1/solve" && req.method === "POST") {
    const ip = clientIp(req);
    if (!rateLimit(ip)) {
      sendJson(res, 429, {error: "Too many requests. Try again in a minute."});
      return;
    }

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, {error: "Invalid JSON body."});
      return;
    }

    const {mode, snapshot, model, effort} = payload;
    if (!["explain", "field", "autopilot"].includes(mode) || !snapshot || typeof snapshot !== "object") {
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

  sendJson(res, 404, {error: "Not found"});
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`AuraSolve API listening on 0.0.0.0:${PORT}`);
});
