import {API_BASE} from "../shared/config.js";

// Each install asks the server for its own signed token once and keeps it in
// extension-only storage. No shared key ships inside the extension.
const TOKEN_KEY = "installToken";
let cachedToken = null;
async function storedToken() {
  if (cachedToken) return cachedToken;
  try { cachedToken = (await chrome.storage.local.get(TOKEN_KEY))[TOKEN_KEY] || null; } catch {}
  return cachedToken;
}
async function saveToken(token) {
  cachedToken = token;
  try { if (token) await chrome.storage.local.set({[TOKEN_KEY]: token}); else await chrome.storage.local.remove(TOKEN_KEY); } catch {}
}
async function installToken(signal) {
  const existing = await storedToken();
  if (existing) return existing;
  const response = await fetch(`${API_BASE}/api/v1/install`, {method: "POST", signal, headers: {"Content-Type": "application/json"}, body: "{}"});
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.token !== "string") throw new Error(data.error || "AuraSolve could not connect to its server. Try again in a minute.");
  await saveToken(data.token);
  return data.token;
}
async function callApi(path, body, signal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await installToken(signal);
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      signal,
      headers: {"Content-Type": "application/json", "Authorization": `Bearer ${token}`},
      body: JSON.stringify(body),
    });
    if (response.status === 401 && attempt === 0) { await saveToken(null); continue; }
    return response;
  }
}

export async function solve(snapshot, mode, settings, signal) {
  const response = await callApi("/api/v1/solve", {
    mode,
    snapshot,
    model: settings.model || undefined,
    effort: settings.effort || undefined,
  }, signal);

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = response.status;
    throw new Error(
      data.error ||
        (code === 401
          ? "AuraSolve could not reach the server. Check your extension config."
          : code === 429
            ? "AuraSolve is busy. Wait a moment and try again."
            : `AuraSolve request failed (${code}). Nothing was submitted.`),
    );
  }

  if (!data.solution) throw new Error("AuraSolve returned an empty answer.");
  return data.solution;
}

export async function ask(messages, image, solve, signal) {
  const response = await callApi("/api/v1/ask", {messages, image: image || undefined, solve: Boolean(solve)}, signal);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || (response.status === 429 ? "AuraSolve is busy. Wait a moment and try again." : `AuraSolve request failed (${response.status}).`));
  if (!data.reply) throw new Error("AuraSolve returned an empty reply.");
  return data.reply;
}

export async function checkBackend(signal) {
  const response = await fetch(`${API_BASE}/api/v1/health`, {signal});
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error("AuraSolve server is unavailable.");
  return data;
}
