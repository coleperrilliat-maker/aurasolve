const API_HOSTS = new Set([
  "https://aurasolve.io",
  "https://www.aurasolve.io",
  "https://aurasolve-production.up.railway.app",
]);
if (!API_HOSTS.has(location.origin) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(location.origin)) {
  location.replace(`https://aurasolve-production.up.railway.app/login${location.search}`);
}

const params = new URLSearchParams(location.search);
const extState = params.get("state") || "";
const pkce = params.get("challenge") || "";
const fromExtension = /^[A-Za-z0-9_-]{16,128}$/.test(extState) && /^[A-Za-z0-9_-]{43}$/.test(pkce);
const error = document.getElementById("error");

function showError(message) {
  error.hidden = !message;
  error.textContent = message || "";
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

async function handoff() {
  const data = await post("/api/v1/auth/handoff", {challenge: pkce});
  location.replace(`/auth/done?state=${encodeURIComponent(extState)}&handoff=${encodeURIComponent(data.handoff)}`);
}

function welcome(email) {
  if (fromExtension) return handoff();
  document.getElementById("ask").hidden = true;
  document.getElementById("done").hidden = false;
  document.getElementById("done-note").textContent = `Signed in as ${email}. Install AuraSolve, then press Log in in the extension and you'll come right back.`;
}

document.getElementById("email-form").onsubmit = async event => {
  event.preventDefault();
  showError("");
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    const email = document.getElementById("email").value.trim();
    event.target.dataset.challenge = (await post("/api/v1/auth/web/start", {email})).challenge;
    document.getElementById("email-form").hidden = true;
    document.getElementById("code-form").hidden = false;
    document.getElementById("code").focus();
  } catch (err) { showError(err.message); }
  finally { button.disabled = false; }
};

document.getElementById("code-form").onsubmit = async event => {
  event.preventDefault();
  showError("");
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    const data = await post("/api/v1/auth/web/verify", {
      challenge: document.getElementById("email-form").dataset.challenge,
      code: document.getElementById("code").value,
    });
    await welcome(data.email);
  } catch (err) { showError(err.message); }
  finally { button.disabled = false; }
};

document.getElementById("back").onclick = () => {
  showError("");
  document.getElementById("code").value = "";
  document.getElementById("code-form").hidden = true;
  document.getElementById("email-form").hidden = false;
};

document.getElementById("switch").onclick = async () => {
  showError("");
  try { await post("/api/v1/auth/web/logout"); } catch {}
  document.getElementById("done").hidden = true;
  document.getElementById("ask").hidden = false;
  document.getElementById("email-form").hidden = false;
  document.getElementById("code-form").hidden = true;
};

fetch("/api/v1/auth/session").then(response => response.json()).then(data => {
  if (data?.signedIn) welcome(data.email);
}).catch(() => {});
