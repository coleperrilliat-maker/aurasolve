import {BUILD_VERSION} from '../src/shared/version.js';
import http from "node:http";
import {solveWithOpenAI, pickModel} from "./openai.js";

const PORT = Number(process.env.PORT) || 8787;
const MAX_BODY = 4_000_000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 40;
const hits = new Map();

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

  if (path === "/api/v1/health" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      service: "aurasolve",
      version: BUILD_VERSION,
      model: pickModel(),
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
