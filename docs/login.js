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

function showPanel(name) {
  for (const id of ["ask", "forgot-panel", "reset", "signup-code", "signup-password", "account"]) {
    document.getElementById(id).hidden = id !== name;
  }
}

function passwordChecks(value) {
  const text = String(value || "");
  return {
    len: text.length >= 8 && text.length <= 200,
    lower: /[a-z]/.test(text),
    upper: /[A-Z]/.test(text),
    digit: /[0-9]/.test(text),
  };
}

function paintRules(listId, value) {
  const checks = passwordChecks(value);
  document.querySelectorAll(`#${listId} li`).forEach(item => item.classList.toggle("met", Boolean(checks[item.dataset.rule])));
  return Object.values(checks).every(Boolean);
}

let payToken = 0;
let currentSession = null;

function showAccount(session) {
  currentSession = session || {signedIn: true, email: "", paywall: true, paid: false};
  showPanel("account");
  const email = currentSession.email || "your account";
  const paid = !currentSession.paywall || currentSession.paid;
  document.getElementById("account-lead").textContent = `Signed in as ${email}`;
  document.getElementById("account-continue").textContent = paid ? "Add to Chrome" : "Continue";
  document.getElementById("account-continue").disabled = false;
}

async function continueAccount() {
  const session = currentSession || {};
  const paid = !session.paywall || session.paid;
  if (paid) {
    let next = "";
    try { next = sessionStorage.getItem("aura_next") || ""; sessionStorage.removeItem("aura_next"); } catch {}
    location.assign(next === "/metrics" || next.startsWith("/metrics?") ? next : "/install?paid=1");
    return;
  }
  showError("");
  location.assign("/pay");
}

async function logout() {
  payToken += 1;
  currentSession = null;
  showError("");
  try { await post("/api/v1/auth/web/logout"); } catch {}
  document.getElementById("password").value = "";
  showPanel("ask");
}

async function welcome(email, method = "session", autoPay = false) {
  if (fromExtension) return handoff();
  try { window.auraPosthogSignedIn?.(email, method); } catch {}
  let session = {signedIn: true, email, paywall: true, paid: false};
  try {
    session = await fetch("/api/v1/auth/session", {credentials: "same-origin"}).then(r => r.json());
  } catch {}
  if (!session?.email) session = {...session, signedIn: true, email};
  showAccount(session);
  if (autoPay && session.paywall && !session.paid) await continueAccount();
}

const google = document.getElementById("google");
if (fromExtension) {
  const googleParams = new URLSearchParams({state: extState, challenge: pkce});
  google.href = `/api/v1/auth/google?${googleParams}`;
  document.getElementById("title").textContent = "Sign in";
  document.getElementById("lead").textContent = "Sign in and you'll come right back to the extension.";
}

let creating = false;
let signupChallenge = "";
let signupProof = "";
let signupEmail = "";

function setCreateMode(on) {
  creating = on;
  showError("");
  document.getElementById("title").textContent = creating ? "Create account" : "Sign in";
  document.getElementById("lead").textContent = creating ? "Enter your email and we'll send a verification code." : (fromExtension ? "Sign in and you'll come right back to the extension." : "Sign in with Google, or your email and password.");
  document.getElementById("submit").textContent = creating ? "Continue" : "Sign in";
  document.getElementById("mode").textContent = creating ? "Already have an account? Sign in" : "Create an account";
  document.getElementById("password").hidden = creating;
  document.getElementById("password").required = !creating;
  google.hidden = creating;
  document.getElementById("or").hidden = creating;
  document.getElementById("forgot").hidden = creating;
}

document.getElementById("mode").onclick = () => { setCreateMode(!creating); };

document.getElementById("password-form").onsubmit = async event => {
  event.preventDefault();
  showError("");
  const button = document.getElementById("submit");
  button.disabled = true;
  const email = document.getElementById("email").value.trim();
  try {
    if (creating) {
      const data = await post("/api/v1/auth/web/register/start", {email});
      signupEmail = email;
      signupChallenge = data.challenge;
      signupProof = "";
      document.getElementById("signup-code-lead").textContent = `We sent a 6-digit code to ${email}. It expires in 10 minutes.`;
      document.getElementById("signup-code-input").value = "";
      showPanel("signup-code");
      document.getElementById("signup-code-input").focus();
    } else {
      const data = await post("/api/v1/auth/web/login", {email, password: document.getElementById("password").value});
      await welcome(data.email, "password", true);
    }
  } catch (err) { showError(err.message); }
  finally { button.disabled = false; }
};

document.getElementById("signup-code-back").onclick = () => {
  showError("");
  showPanel("ask");
  setCreateMode(true);
};

document.getElementById("signup-code-form").onsubmit = async event => {
  event.preventDefault();
  showError("");
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    const data = await post("/api/v1/auth/web/register/code", {
      challenge: signupChallenge,
      code: document.getElementById("signup-code-input").value.trim(),
    });
    signupProof = data.signup;
    signupEmail = data.email || signupEmail;
    document.getElementById("signup-password-lead").textContent = `Choose a password for ${signupEmail}.`;
    document.getElementById("signup-password-input").value = "";
    paintRules("signup-rules", "");
    document.getElementById("signup-password-submit").disabled = true;
    showPanel("signup-password");
    document.getElementById("signup-password-input").focus();
  } catch (err) { showError(err.message); }
  finally { button.disabled = false; }
};

document.getElementById("signup-password-input").addEventListener("input", event => {
  document.getElementById("signup-password-submit").disabled = !paintRules("signup-rules", event.target.value);
});

document.getElementById("signup-password-form").onsubmit = async event => {
  event.preventDefault();
  showError("");
  const button = document.getElementById("signup-password-submit");
  if (!paintRules("signup-rules", document.getElementById("signup-password-input").value)) return;
  button.disabled = true;
  try {
    const data = await post("/api/v1/auth/web/register", {
      signup: signupProof,
      password: document.getElementById("signup-password-input").value,
    });
    await welcome(data.email, "register", true);
  } catch (err) { showError(err.message); button.disabled = false; }
};

document.getElementById("reset-password").addEventListener("input", event => {
  document.getElementById("reset-submit").disabled = !paintRules("reset-rules", event.target.value);
});

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
    await welcome(data.email, "password_reset", true);
  } catch (err) { showError(err.message); }
  finally { button.disabled = !paintRules("reset-rules", document.getElementById("reset-password").value); }
};

document.getElementById("account-continue").onclick = () => { continueAccount(); };
document.getElementById("account-logout").onclick = () => { logout(); };

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
  fetch("/api/v1/auth/session", {credentials: "same-origin"}).then(response => response.json()).then(data => {
    if (data?.signedIn) welcome(data.email, signedInMethod, params.has("signed_in"));
  }).catch(() => {});
} else if (!resetToken) {
  fetch("/api/v1/auth/session", {credentials: "same-origin"}).then(response => response.json()).then(data => {
    if (data?.signedIn) welcome(data.email, signedInMethod, false);
  }).catch(() => {});
}
