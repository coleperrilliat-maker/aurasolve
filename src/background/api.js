import {API_BASE, CLIENT_KEY} from "../shared/config.js";

export async function solve(snapshot, mode, settings, signal) {
  const response = await fetch(`${API_BASE}/api/v1/solve`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "X-AuraSolve-Key": CLIENT_KEY,
    },
    body: JSON.stringify({
      mode,
      snapshot,
      model: settings.model || "gpt-4.1-mini",
    }),
  });

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

export async function checkBackend(signal) {
  const response = await fetch(`${API_BASE}/api/v1/health`, {signal});
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error("AuraSolve server is unavailable.");
  return data;
}
