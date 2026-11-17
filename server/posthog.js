import crypto from "node:crypto";
import {PostHog} from "posthog-node";

// AI Observability for OpenAI Responses calls on the AuraSolve server.
// Enabled when POSTHOG_PROJECT_API_KEY is set (Railway). Off otherwise.

let client;

export function posthogEnabled() {
  return Boolean(process.env.POSTHOG_PROJECT_API_KEY?.trim());
}

export function getPosthog() {
  if (!posthogEnabled()) return null;
  if (!client) {
    client = new PostHog(process.env.POSTHOG_PROJECT_API_KEY.trim(), {
      host: process.env.POSTHOG_HOST?.trim() || "https://us.i.posthog.com",
    });
  }
  return client;
}

export async function shutdownPosthog() {
  if (!client) return;
  await client.shutdown().catch(() => {});
  client = null;
}

function stripImages(value) {
  if (typeof value === "string") {
    if (/^data:image\//i.test(value)) return "[image omitted]";
    return value.length > 12_000 ? `${value.slice(0, 12_000)}…` : value;
  }
  if (Array.isArray(value)) return value.map(stripImages);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (/image_url|image/i.test(key) && typeof item === "string" && /^data:image\//i.test(item)) out[key] = "[image omitted]";
      else out[key] = stripImages(item);
    }
    return out;
  }
  return value;
}

function inputMessages(body) {
  const parts = [];
  if (body?.instructions) parts.push({role: "system", content: String(body.instructions).slice(0, 8_000)});
  const input = body?.input;
  if (typeof input === "string") parts.push({role: "user", content: input.slice(0, 12_000)});
  else if (input != null) parts.push({role: "user", content: stripImages(input)});
  return parts;
}

function outputChoices(data) {
  const text = data?.output?.flatMap(item => item.content || [])
    .filter(item => item.type === "output_text")
    .map(item => item.text)
    .join("") || "";
  if (!text) return [];
  return [{role: "assistant", content: text.length > 12_000 ? `${text.slice(0, 12_000)}…` : text}];
}

function captureGeneration({traceId, body, response, data, start, meta, error}) {
  const ph = getPosthog();
  if (!ph) return;
  const usage = data?.usage || {};
  ph.capture({
    distinctId: meta.distinctId || "aurasolve-server",
    event: "$ai_generation",
    properties: {
      $ai_trace_id: traceId,
      $ai_session_id: meta.sessionId ?? null,
      $ai_span_name: meta.spanName || "openai_responses",
      $ai_model: body?.model,
      $ai_provider: "openai",
      $ai_base_url: "https://api.openai.com/v1",
      $ai_request_url: "https://api.openai.com/v1/responses",
      $ai_http_status: response?.status,
      $ai_input: inputMessages(body),
      $ai_output_choices: outputChoices(data),
      $ai_input_tokens: usage.input_tokens,
      $ai_output_tokens: usage.output_tokens,
      $ai_latency: (Date.now() - start) / 1000,
      $ai_is_error: Boolean(error || (response && !response.ok)),
      $ai_error: error?.message || (response && !response.ok ? `HTTP ${response.status}` : undefined),
      aurasolve_mode: meta.mode,
    },
  });
}

export async function callOpenAIResponses({apiKey, body, signal, meta = {}}) {
  const start = Date.now();
  const traceId = crypto.randomUUID();
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    captureGeneration({traceId, body, response: null, data: null, start, meta, error});
    throw error;
  }

  let raw = "";
  let data = null;
  if (typeof response.text === "function") {
    raw = await response.text();
    try { data = JSON.parse(raw); } catch { data = null; }
  } else if (typeof response.json === "function") {
    data = await response.json();
    raw = data == null ? "" : JSON.stringify(data);
  }
  captureGeneration({traceId, body, response, data, start, meta, error: null});
  return {response, data, raw};
}
