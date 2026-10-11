const $ = id => document.getElementById(id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let pending = null;
let token = 0;
let busy = false;

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "AuraSolve disconnected.");
  return response.data;
}

function status(text) {
  $("status").textContent = text;
}

function setBusy(value) {
  busy = value;
  $("stop").hidden = !value;
  document.querySelectorAll("[data-mode]").forEach(button => { button.disabled = value; });
}

function card(result, mode, number) {
  const article = document.createElement("article");
  const label = document.createElement("b");
  label.textContent = mode === "autopilot" ? `PRACTICE ${number}` : mode === "field" ? "ANSWER PREVIEW" : "EXPLANATION";
  const answer = document.createElement("h2");
  answer.textContent = result.solution.answer;
  const explanation = document.createElement("p");
  explanation.textContent = result.solution.explanation;
  article.append(label, answer, explanation);
  $("results").prepend(article);
}

async function run(mode) {
  const mine = ++token;
  setBusy(true);
  $("consent").hidden = true;
  const live = () => { if (mine !== token) throw new Error("Stopped."); };
  try {
    const settings = await send({type: "settingsStatus"});
    live();
    if (!settings.configured) throw new Error("AuraSolve Cloud is offline. Check Railway, then try again.");
    for (let i = 1; i <= (mode === "autopilot" ? 5 : 1); i++) {
      live();
      status(mode === "autopilot" ? `Working on question ${i} of 5…` : "Reading the question…");
      const result = await send({type: "solve", mode});
      live();
      if (mode !== "autopilot") {
        card(result, mode, i);
        if (mode === "field" && result.solution.supported && result.solution.actions.length && result.solution.confidence >= .85) {
          status("Filling the selected field…");
          await send({type: "apply", planId: result.planId});
          live();
          status("Field filled. You choose whether to submit.");
        } else status(mode === "explain" ? "Explanation ready." : "Fill this one yourself using the explanation.");
        break;
      }
      if (!result.solution.supported || result.solution.confidence < .85 || !result.solution.actions.length) {
        card(result, mode, i);
        throw new Error("AutoPilot paused. This one needs a manual step.");
      }
      status("Checking the answer…");
      await send({type: "apply", planId: result.planId});
      live();
      card(result, mode, i);
      let outcome;
      for (let poll = 0; poll < 12; poll++) {
        await sleep(500);
        live();
        outcome = await send({type: "feedback", planId: result.planId});
        live();
        if (outcome.state !== "unknown") break;
      }
      if (outcome?.state !== "correct") throw new Error("AutoPilot stopped. A correct answer was not confirmed.");
      status(i === 5 ? "Five questions done." : "Correct. Continuing…");
      if (i === 5) break;
      await sleep(2500);
      live();
      await send({type: "next", planId: result.planId});
      live();
      let changed = false;
      for (let poll = 0; poll < 12; poll++) {
        await sleep(500);
        live();
        const next = await send({type: "inspect"});
        live();
        if (next.question.hash !== result.question.hash) { changed = true; break; }
      }
      if (!changed) throw new Error("The next question did not load.");
    }
  } catch (error) {
    if (mine === token) status(error.message);
  } finally {
    if (mine === token) setBusy(false);
  }
}

async function choose(mode) {
  if (busy) return;
  document.querySelectorAll("[data-mode]").forEach(button => button.classList.toggle("active", button.dataset.mode === mode));
  $("results").replaceChildren();
  status("Checking this page…");
  if (mode === "explain") { pending = null; return run(mode); }
  setBusy(true);
  try {
    const info = await send({type: "inspect"});
    if (info.status.state !== "practice") throw new Error(info.status.reason);
    if (mode === "field" && !info.question.selected) throw new Error("Click the answer field on the page first.");
    pending = mode;
    $("consent").hidden = false;
    $("agree").checked = false;
    $("signature").value = "";
    status("Confirm this is ungraded practice.");
  } catch (error) {
    status(error.message);
  } finally {
    setBusy(false);
  }
}

document.querySelectorAll("[data-mode]").forEach(button => {
  button.onclick = () => choose(button.dataset.mode);
});
$("confirm").onclick = async () => {
  const mode = pending;
  if (!mode) return;
  $("confirm").disabled = true;
  try {
    await send({type: "consent", agree: $("agree").checked, signature: $("signature").value});
    pending = null;
    await run(mode);
  } catch (error) {
    status(error.message);
  } finally {
    $("confirm").disabled = false;
  }
};
$("stop").onclick = async () => {
  token++;
  pending = null;
  $("consent").hidden = true;
  setBusy(false);
  try { await send({type: "stop"}); } catch {}
  status("Stopped.");
};

try {
  const health = await send({type: "settingsStatus"});
  $("cloud").textContent = health.configured ? "Cloud online" : "Cloud offline";
} catch {
  $("cloud").textContent = "Cloud offline";
}
