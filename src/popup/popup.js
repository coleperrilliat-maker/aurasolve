import {renderSolution} from "../shared/render.js";
import {HONOR_STATEMENT, statementMatches} from "../shared/policy.js";
import {BUILD_VERSION} from '../shared/version.js';
import {sendExtension} from '../shared/messaging.js';
const $ = id => document.getElementById(id);
document.querySelector('.brand strong').textContent=`AuraSolve ${BUILD_VERSION}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let pending = null;
let token = 0;
let busy = false, paused=false;
for(const id of ['time-min','time-max']){
  for(let seconds=10;seconds<=120;seconds+=10)$(id).add(new Option(seconds+' seconds',seconds));
}
$('time-min').value='20';$('time-max').value='40';
function updateTiming(){
  $('timing-settings').hidden=$('speed-run').checked;
  $('max-label').hidden=!$('random-timing').checked;
  if(+$('time-max').value<+$('time-min').value)$('time-max').value=$('time-min').value;
}
for(const id of ['speed-run','random-timing','time-min','time-max','question-limit'])$(id).onchange=()=>{
  updateTiming();
  try{localStorage.setItem('pilotSettings',JSON.stringify(Object.fromEntries(['speed-run','random-timing','time-min','time-max','question-limit'].map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]))));}catch{}
};
try{
 const saved=JSON.parse(localStorage.getItem('pilotSettings')||'{}');
 for(const [id,value] of Object.entries(saved))if(['speed-run','random-timing','time-min','time-max','question-limit'].includes(id)){
   if($(id).type==='checkbox')$(id).checked=Boolean(value);
   else if([...$(id).options].some(o=>o.value===String(value)))$(id).value=value;
 }
}catch{}
updateTiming();
function pauseUI(){
 $('pause').setAttribute('aria-label',paused?'Resume AutoPilot':'Pause AutoPilot');
 $('pause').title=paused?'Resume AutoPilot':'Pause AutoPilot';
 $('pause').innerHTML=paused?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 9 6-9 6Z"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12"/></svg>';
}
$('pause').onclick=()=>{
 paused=!paused;pauseUI();
 $('pace-status').textContent=paused?'Paused. An action already sent may finish; the next action will wait.':'Resuming…';
};


async function send(message) {
  return sendExtension(message);
}

function status(text) {
  $("status").textContent = text;
}

function setBusy(value) {
  busy = value;
  $('start-pilot').disabled=value;
  document.querySelectorAll('#autopilot-settings input,#autopilot-settings select').forEach(el=>el.disabled=value);
  $('pause').disabled=!value;
  if(!value){paused=false;pauseUI();}

  $("stop").hidden = !value;
  document.querySelectorAll("[data-mode]").forEach(button => { button.disabled = value; });
}

function card(result, mode, number) {
  $("results").prepend(renderSolution(result, mode === "autopilot" ? `Question ${number}` : ""));
}

async function run(mode) {
  const mine = ++token;
  paused=false;pauseUI();
  const limit=mode==='autopilot'?Number($('question-limit').value):1;
  $('pilot-progress').hidden=mode!=='autopilot';
  $('progress').max=limit;$('progress').value=0;
  $('pace-status').textContent='';

  setBusy(true);
  $("consent").hidden = true;
  const live = () => { if (mine !== token) throw new Error("Stopped."); };
  const checkpoint=async()=>{live();while(paused){await sleep(100);live();}};
  const delay=async ms=>{
    let remaining=ms;
    while(remaining>0){
      await checkpoint();
      const started=performance.now();await sleep(Math.min(100,remaining));live();
      if(!paused)remaining-=performance.now()-started;
    }
    await checkpoint();
  };
  try {
    const settings = await send({type: "settingsStatus"});
    live();
    if (!settings.configured) throw new Error("AuraSolve Cloud is offline. Check Railway, then try again.");
    for (let i = 1; i <= limit; i++) {
      await checkpoint();
      const started=performance.now();
      const minimum=Number($('time-min').value),maximum=Number($('time-max').value);
      const target=$('speed-run').checked?0:minimum+($('random-timing').checked?10*Math.floor(Math.random()*((maximum-minimum)/10+1)):0);
      $('progress-label').textContent='Question '+i+' of '+limit;
      status(mode === "autopilot" ? `Working on question ${i} of ${limit}…` : "Reading the question…");
      $("loader").hidden = false;
      let result;
      try { result = await send({type: "solve", mode}); } finally { $("loader").hidden = true; }
      await checkpoint();
      card(result, mode, i);
      if (mode !== "autopilot") {
        if (mode === "field" && result.solution.supported && result.solution.actions.length && result.solution.confidence >= .85) {
          status("Filling the selected field…");
          await send({type: "apply", planId: result.planId});
          live();
          status("Field filled. You choose whether to submit.");
        } else if (mode === "explain") $("status").hidden = true;
        else status("Fill this one yourself using the explanation.");
        break;
      }
      if (!result.solution.supported || result.solution.confidence < .85 || !result.solution.actions.length) {
        throw new Error("AutoPilot paused. This one needs a manual step.");
      }
      let remaining=Math.max(0,target*1000-(performance.now()-started));
      while(remaining>0){
        await checkpoint();
        $('pace-status').textContent='Submitting in '+Math.ceil(remaining/1000)+'s';
        const step=Math.min(250,remaining);await delay(step);remaining-=step;
      }
      await checkpoint();
      $('pace-status').textContent=$('speed-run').checked?'Speed run · no extra delay':'Target pace: '+target+' seconds';
      status("Checking the answer…");
      await send({type: "apply", planId: result.planId});
      live();
      let outcome;
      for (let poll = 0; poll < 12; poll++) {
        await delay(500);
        live();
        outcome = await send({type: "feedback", planId: result.planId});
        live();
        if (outcome.state !== "unknown") break;
      }
      if (outcome?.state !== "correct") throw new Error("AutoPilot stopped. A correct answer was not confirmed.");
      $('progress').value=i;
      status(i === limit ? limit+(limit===1?" question done.":" questions done.") : "Correct. Continuing…");
      if (i === limit) break;
      await checkpoint();
      await send({type: "next", planId: result.planId});
      live();
      let changed = false;
      for (let poll = 0; poll < 12; poll++) {
        await delay(500);
        live();
        const next = await send({type: "inspect"});
        live();
        if (next.question.hash !== result.question.hash) { changed = true; break; }
      }
      if (!changed) throw new Error("The next question did not load.");
    }
  } catch (error) {
    if (mine === token) status(`${error.message}${$("results").children.length ? ' Your answer and explanation are below.' : ''}`);
  } finally {
    if (mine === token) setBusy(false);
  }
}

async function choose(mode) {
  if (busy) return;
  document.querySelectorAll("[data-mode]").forEach(button => button.classList.toggle("active", button.dataset.mode === mode));
  $("results").replaceChildren();
  $("status").hidden = false;
  status("Checking this page…");
  if (mode === "explain") { pending = null; return run(mode); }
  setBusy(true);
  try {
    if(mode==='field')await send({type:'prepareField'});
    const info = await send({type: "inspect"});
    if (info.signed) { setBusy(false); return await run(mode); }
    pending = mode;
    $("consent").hidden = false;
    $("statement").value = "";
    $("statement").classList.remove("ok");
    $("signature").value = "";
    $("confirm").disabled = true;
    status("Type the honor statement and sign to continue.");
  } catch (error) {
    status(error.message);
  } finally {
    setBusy(false);
  }
}

document.querySelectorAll("[data-mode]").forEach(button => {
  button.onclick = () => {
    const auto=button.dataset.mode==='autopilot';
    $('autopilot-settings').hidden=!auto;
    if(auto){
      document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b===button));
      $('status').hidden=false;status('Choose your pace, then start AutoPilot.');
    }else choose(button.dataset.mode);
  };
});
$('start-pilot').onclick=()=>choose('autopilot');
$("phrase").textContent = HONOR_STATEMENT;
$("statement").placeholder = HONOR_STATEMENT;
const signed = () => statementMatches($("statement").value) && $("signature").value.trim().length >= 2;
for (const id of ["statement", "signature"]) {
  $(id).addEventListener("input", () => {
    $("confirm").disabled = !signed();
    $("statement").classList.toggle("ok", statementMatches($("statement").value));
  });
}
$("confirm").onclick = async () => {
  const mode = pending;
  if (!mode || !signed()) return;
  $("confirm").disabled = true;
  try {
    await send({type: "consent", statement: $("statement").value, signature: $("signature").value});
    pending = null;
    await run(mode);
  } catch (error) {
    status(error.message);
  } finally {
    $("confirm").disabled = !signed();
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
  $("cloud").className = health.configured ? "online" : "offline";
} catch {
  $("cloud").textContent = "Cloud offline";
  $("cloud").className = "offline";
}


$('close').onclick=async()=>{const win=await chrome.windows.getCurrent();await chrome.sidePanel.close({windowId:win.id});};

let inspectionReport=null;
$('inspect-page').onclick=async()=>{
  $('inspect-page').disabled=true;
  try {
    inspectionReport=await send({type:'inspectPage'});
    const frames=inspectionReport.frames;
    $('inspection-summary').textContent=frames.map(f=>`Frame ${f.frameId}: ${f.fields.length} supported fields, ${f.controls.length} controls; vision ${f.visual?'needed':'not detected'}.`).join('\n');
    $('inspection-summary').hidden=false;$('save-inspection').hidden=false;
  } catch(error){status(error.message);$('status').hidden=false;}
  finally{$('inspect-page').disabled=false;}
};
$('save-inspection').onclick=()=>{
  if(!inspectionReport)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(inspectionReport,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='aurasolve-page-inspection.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
