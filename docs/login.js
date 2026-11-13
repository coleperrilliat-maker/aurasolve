const API_HOSTS = new Set([
  "https://aurasolve.io",
  "https://www.aurasolve.io",
  "https://aurasolve-production.up.railway.app",
]);
if (!API_HOSTS.has(location.origin) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(location.origin)) {
  location.replace(`https://aurasolve.io/login${location.search}`);
}

const params = new URLSearchParams(location.search);
const extState = params.get("state") || "";
const pkce = params.get("challenge") || "";
const fromExtension = /^[A-Za-z0-9_-]{16,128}$/.test(extState) && /^[A-Za-z0-9_-]{43}$/.test(pkce);
const resetToken = params.get("reset") || "";
const error = document.getElementById("error");
const ERRORS = {
  google_denied: "Google sign-in was cancelled.",
  google_unverified: "That Google account doesn't have a verified email.",
  google_linked: "That email already has a password. Sign in with it, or reset the password.",
  google_used: "That Google account is already used by another sign-in.",
  google: "Google sign-in didn't work. Try again.",
};

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
  for (const id of ["ask", "forgot-panel", "reset"]) document.getElementById(id).hidden = true;
  document.getElementById("done").hidden = false;
  document.getElementById("done-note").textContent = `Signed in as ${email}. You’re successfully on the waiting list — we’ll email you when AuraSolve is available to install.`;
}

const google = document.getElementById("google");
if (fromExtension) {
  const googleParams = new URLSearchParams({state: extState, challenge: pkce});
  google.href = `/api/v1/auth/google?${googleParams}`;
  document.getElementById("lead").textContent = "Sign in and you'll come right back to the extension.";
}

let creating = false;
document.getElementById("mode").onclick = () => {
  creating = !creating;
  showError("");
  document.getElementById("title").textContent = creating ? "Create account" : (fromExtension ? "Sign in" : "Join the waiting list");
  document.getElementById("lead").textContent = creating ? "Use the email and password you'll sign in with." : (fromExtension ? "Sign in and you'll come right back to the extension." : "Sign in with Google, or your email and password. Download isn’t open yet.");
  document.getElementById("submit").textContent = creating ? "Create account" : "Sign in";
  document.getElementById("mode").textContent = creating ? "Already have an account? Sign in" : "Create an account";
  document.getElementById("password").autocomplete = creating ? "new-password" : "current-password";
  google.hidden = creating;
  document.getElementById("or").hidden = creating;
  document.getElementById("forgot").hidden = creating;
};

document.getElementById("password-form").onsubmit = async event => {
  event.preventDefault();
  showError("");
  const button = document.getElementById("submit");
  button.disabled = true;
  try {
    const data = await post(creating ? "/api/v1/auth/web/register" : "/api/v1/auth/web/login", {
      email: document.getElementById("email").value.trim(),
      password: document.getElementById("password").value,
    });
    await welcome(data.email);
  } catch (err) { showError(err.message); }
  finally { button.disabled = false; }
};

document.getElementById("forgot").onclick = () => {
  showError("");
  document.getElementById("forgot-email").value = document.getElementById("email").value;
  document.getElementById("ask").hidden = true;
  document.getElementById("forgot-panel").hidden = false;
  document.getElementById("forgot-note").hidden = true;
};

document.getElementById("forgot-back").onclick = () => {
  showError("");
  document.getElementById("forgot-panel").hidden = true;
  document.getElementById("ask").hidden = false;
};

document.getElementById("forgot-form").onsubmit = async event => {
  event.preventDefault();
  showError("");
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    await post("/api/v1/auth/web/forgot", {email: document.getElementById("forgot-email").value.trim()});
    document.getElementById("forgot-note").hidden = false;
  } catch (err) { showError(err.message); }
  finally { button.disabled = false; }
};

document.getElementById("reset-form").onsubmit = async event => {
  event.preventDefault();
  showError("");
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    const data = await post("/api/v1/auth/web/reset", {
      token: resetToken,
      password: document.getElementById("reset-password").value,
    });
    await welcome(data.email);
  } catch (err) { showError(err.message); }
  finally { button.disabled = false; }
};

document.getElementById("switch").onclick = async () => {
  showError("");
  try { await post("/api/v1/auth/web/logout"); } catch {}
  document.getElementById("done").hidden = true;
  document.getElementById("ask").hidden = false;
  document.getElementById("password").value = "";
};

if (resetToken) {
  document.getElementById("ask").hidden = true;
  document.getElementById("reset").hidden = false;
}

if (params.get("error")) showError(ERRORS[params.get("error")] || "Sign-in didn't work. Try again.");

if (!resetToken) {
  fetch("/api/v1/auth/session", {credentials: "same-origin"}).then(response => response.json()).then(data => {
    if (data?.signedIn) welcome(data.email);
  }).catch(() => {});
}
