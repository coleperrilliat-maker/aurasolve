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
const nextParam = params.get("next") || "";
const safeNext = nextParam === "/metrics" || nextParam.startsWith("/metrics?") ? nextParam : "";
if (safeNext) {
  try { sessionStorage.setItem("aura_next", safeNext); } catch {}
}
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

function goInstall(paid) {
  location.replace(paid ? "/install?paid=1" : "/install");
}

function goNextOrInstall(paid) {
  let next = "";
  try { next = sessionStorage.getItem("aura_next") || ""; sessionStorage.removeItem("aura_next"); } catch {}
  if (next === "/metrics" || next.startsWith("/metrics?")) {
    location.replace(next);
    return;
  }
  goInstall(paid);
}

async function startCheckout() {
  document.getElementById("ask").hidden = true;
  document.getElementById("forgot-panel").hidden = true;
  document.getElementById("reset").hidden = true;
  document.getElementById("done").hidden = false;
  document.getElementById("done-note").textContent = "Opening secure checkout for $0.99…";
  document.getElementById("store-link").hidden = true;
  const data = await post("/api/v1/auth/web/checkout", {plan: "weekly"});
  location.replace(data.url);
}

async function welcome(email, method = "session") {
  if (fromExtension) return handoff();
  try { window.auraPosthogSignedIn?.(email, method); } catch {}
  // Give PostHog a moment to flush identify + login before leaving.
  await new Promise(resolve => setTimeout(resolve, 450));
  let session = {signedIn: true, email, paywall: false, paid: true};
  try {
    session = await fetch("/api/v1/auth/session", {credentials: "same-origin"}).then(r => r.json());
  } catch {}
  if (session?.paywall && !session.paid) {
    try { await startCheckout(); }
    catch (err) { showError(err.message); document.getElementById("done").hidden = true; document.getElementById("ask").hidden = false; }
    return;
  }
  goNextOrInstall(Boolean(session?.paid));
}

const google = document.getElementById("google");
if (fromExtension) {
  const googleParams = new URLSearchParams({state: extState, challenge: pkce});
  google.href = `/api/v1/auth/google?${googleParams}`;
  document.getElementById("title").textContent = "Sign in";
  document.getElementById("lead").textContent = "Sign in and you'll come right back to the extension.";
}

let creating = false;
document.getElementById("mode").onclick = () => {
  creating = !creating;
  showError("");
  document.getElementById("title").textContent = creating ? "Create account" : "Sign in";
  document.getElementById("lead").textContent = creating ? "Use the email and password you'll sign in with." : (fromExtension ? "Sign in and you'll come right back to the extension." : "Sign in with Google, or your email and password.");
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
    await welcome(data.email, creating ? "register" : "password");
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
    await welcome(data.email, "password_reset");
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

const signedInMethod = params.get("signed_in") === "google" ? "google" : "session";
if (params.has("signed_in")) {
  const clean = new URL(location.href);
  clean.searchParams.delete("signed_in");
  history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
}

if (!resetToken && !fromExtension) {
  // Hide the form while we check; signed-in users never see it.
  document.getElementById("ask").hidden = true;
  fetch("/api/v1/auth/session", {credentials: "same-origin"}).then(response => response.json()).then(data => {
    if (data?.signedIn) welcome(data.email, signedInMethod);
    else document.getElementById("ask").hidden = false;
  }).catch(() => { document.getElementById("ask").hidden = false; });
} else if (!resetToken) {
  fetch("/api/v1/auth/session", {credentials: "same-origin"}).then(response => response.json()).then(data => {
    if (data?.signedIn) welcome(data.email, signedInMethod);
  }).catch(() => {});
}
