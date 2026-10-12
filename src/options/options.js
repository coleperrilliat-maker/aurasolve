import {API_BASE} from "../shared/config.js";
import {checkBackend} from "../background/api.js";

const $ = id => document.getElementById(id);
await chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"});
const {settings = {}} = await chrome.storage.local.get("settings");
$("model").value = settings.model || "gpt-4.1";

async function refreshStatus() {
  $("server").textContent = "Checking…";
  $("server-model").textContent = "—";
  try {
    const health = await checkBackend(AbortSignal.timeout(8000));
    $("server").textContent = health.keyConfigured === false ? "Online (missing OpenAI key on server)" : "Online";
    $("server-model").textContent = health.model || "gpt-4.1";
    $("status").textContent = `Connected to ${API_BASE}`;
  } catch (error) {
    $("server").textContent = "Offline";
    $("status").textContent = error.message;
  }
}

$("settings").onsubmit = async event => {
  event.preventDefault();
  try {
    const model = $("model").value.trim();
    if (!model) throw new Error("Enter a model name.");
    await chrome.storage.local.set({settings: {...settings,model,modelUpgrade128:true}});
    $("status").textContent = "Saved. Return to your practice page and choose a mode.";
  } catch (error) {
    $("status").textContent = error.message;
  }
};

$("refresh").onclick = refreshStatus;
await refreshStatus();

