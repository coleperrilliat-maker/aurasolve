import {runPilot} from '../shared/pilot-engine.js';
import {renderSolution} from "../shared/render.js";
import {HONOR_STATEMENT, statementMatches} from "../shared/policy.js";
import {BUILD_VERSION} from '../shared/version.js';
import {sendExtension} from '../shared/messaging.js';
const $ = id => document.getElementById(id);
document.querySelector('.brand strong').textContent=`AuraSolve ${BUILD_VERSION}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let pending = null, pilotTabId=null;
let token = 0;
let busy = false, paused=false, runLog=[];
for(const id of ['time-min','time-max']){
  for(let seconds=10;seconds<=120;seconds+=10)$(id).add(new Option(seconds+' seconds',seconds));
}
$('time-min').value='20';$('time-max').value='40';
function updateTiming(){
  $('timing-settings').hidden=$('speed-run').checked;
  $('max-label').hidden=!$('random-timing').checked;
  if(+$('time-max').value<+$('time-min').value)$('time-max').value=$('time-min').value;
}
for(const id of ['speed-run','random-timing','time-min','time-max','question-limit','solve-budget'])$(id).onchange=()=>{
  updateTiming();
  try{localStorage.setItem('pilotSettings',JSON.stringify(Object.fromEntries(['speed-run','random-timing','time-min','time-max','question-limit','solve-budget'].map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]))));}catch{}
};
try{
 const saved=JSON.parse(localStorage.getItem('pilotSettings')||'{}');
 for(const [id,value] of Object.entries(saved))if(['speed-run','random-timing','time-min','time-max','question-limit','solve-budget'].includes(id)){
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
  return sendExtension(pilotTabId===null?message:{...message,pilotTabId:message.pilotTabId ?? pilotTabId});
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

function breakdown(){
  if(!runLog.length)return;
  $('results').replaceChildren();
  const heading=document.createElement('h2');heading.textContent='Run breakdown';
  const summary=document.createElement('p');summary.className='run-summary';
  const submitted=runLog.filter(item=>item.submitted).length;
  summary.textContent=submitted ? runLog.filter(item=>item.outcome==='Correct').length+' of '+submitted+' submitted parts confirmed correct.' :
    runLog.some(item=>item.outcome==='Submission unconfirmed')?'No submissions confirmed.':'No answers were submitted.';
  $('results').append(heading,summary);
  for(const item of runLog){
    const details=document.createElement('details');details.className='run-item';
    const label=document.createElement('summary');label.textContent='Question '+item.number+' · '+item.outcome;
    details.append(label,renderSolution(item.result,''));$('results').append(details);
  }
}

async function run(mode) {
  const mine=++token;runLog=[];paused=false;pauseUI();setBusy(true);
  $('consent').hidden=true;$('pilot-progress').hidden=mode!=='autopilot';
  $('pace-status').textContent='';$('progress').value=0;
  const live=()=>{if(mine!==token)throw new Error('Stopped.');};
  const checkpoint=async()=>{live();while(paused){await sleep(100);live();}};
  const delay=async ms=>{let left=ms;while(left>0){await checkpoint();const step=Math.min(100,left);await sleep(step);live();if(!paused)left-=step;}await checkpoint();};
  try{
    const settings=await send({type:'settingsStatus'});live();
    if(!settings.configured)throw new Error('AuraSolve Cloud is offline. Check Railway, then try again.');
    if(mode==='autopilot'){
      const limit=Number($('question-limit').value),budget=Number($('solve-budget').value);
      let completed=0;
      await runPilot({request:async message=>{
        const response=await send(message);live();
        if(message.type==='pilotOpen')pilotTabId=response.view.tabId;
        return response;
      },checkpoint,delay,limit,budget,onEvent:async event=>{
        live();const v=event.view,p=v.progress;
        const label=p.current?`Question ${p.current}${p.part?`, Part ${p.part} of ${p.totalParts}`:''}`:'Current question';
        if(event.kind==='wait')status(`Waiting for ${event.waiting || 'the page to update'}…`);
        if(event.kind==='start'){
          const remaining=p.questions.filter(q=>q.status!=='correct').length;
          $('progress').max=limit || remaining || 1;
          status(`${event.resumed?'Resuming':'Starting'} at ${label.toLowerCase()}…`);
        }
        $('progress-label').textContent=label;
        if(event.kind==='solve'){
          status(`Solving ${label.toLowerCase()}…`);$('loader').hidden=false;
          $('pace-status').textContent=`${event.spent} of ${budget} AI solves used`;
        }
        if(event.kind==='answer'){
          $('loader').hidden=true;
          runLog.push({number:`${p.current || '?'}${p.part?' · Part '+p.part:''}`,result:event.result,outcome:'Not submitted',submitted:false});
        }
        if(event.kind==='pace'){
          const min=Number($('time-min').value),max=Number($('time-max').value);
          const seconds=$('speed-run').checked?0:min+($('random-timing').checked?10*Math.floor(Math.random()*((max-min)/10+1)):0);
          let left=Math.max(0,seconds*1000-(Date.now()-event.started));
          while(left>0){$('pace-status').textContent=`Submitting in ${Math.ceil(left/1000)}s`;const step=Math.min(250,left);await delay(step);left-=step;}
        }
        if(event.kind==='submit'){
          status('Filling answers, then checking…');if(runLog.length)runLog.at(-1).outcome='Filling · submission pending';
        }
        if(event.kind==='submitted' && runLog.length)Object.assign(runLog.at(-1),{submitted:true,outcome:'Submitted · awaiting feedback'});
        if(event.kind==='notSubmitted' && runLog.length)runLog.at(-1).outcome='Not submitted';
        if(event.kind==='submissionUnknown' && runLog.length)runLog.at(-1).outcome='Submission unconfirmed';
        if(event.kind==='feedback' && runLog.length)runLog.at(-1).outcome=event.outcome==='correct'?'Correct':event.outcome==='incorrect'?'Incorrect':'Step advanced · score pending';
        if(event.kind==='complete'){$('progress').value=++completed;}
        const labels={stay:'Choosing No and staying on the unfinished question…',dismiss:'Closing answer feedback…',continue:'Continuing the next part…',similar:'Starting a similar question to improve the score…',question:`Moving to question ${event.number}…`,next:'Moving to the next question…'};
        if(labels[event.kind])status(labels[event.kind]);
        if(event.kind==='done'){
          status(event.all?'All questions in the list are marked correct.':`${event.completed} question${event.completed===1?'':'s'} done.`);
          $('pace-status').textContent=`${event.spent} of ${budget} AI solves used`;
        }
      }});
    }else{
      status('Reading the question…');$('loader').hidden=false;
      const result=await send({type:'solve',mode});await checkpoint();card(result,mode,1);
      if(mode==='field' && result.solution.supported && result.solution.actions.length && result.solution.confidence>=.85){
        const applied=await send({type:'apply',planId:result.planId});live();
        status(applied.advanced==='next'?'Filled and pressed Next.':'Filled. The red Next button was not pressed.');
      }else if(mode==='explain')$('status').hidden=true;
      else status('Fill this one yourself using the explanation.');
    }
  }catch(error){if(mine===token)status(error.message);}
  finally{if(mine===token){$('loader').hidden=true;setBusy(false);if(mode==='autopilot')breakdown();}}
}

async function choose(mode) {
  if (busy) return;
  pilotTabId=null;
  document.querySelectorAll("[data-mode]").forEach(button => button.classList.toggle("active", button.dataset.mode === mode));
  $("results").replaceChildren();
  $("status").hidden = false;
  status("Checking this page…");
  if (mode === "explain") { pending = null; return run(mode); }
  setBusy(true);
  try {
    if(mode==='field')await send({type:'prepareField'});
    const info = await send({type: "inspect"});
    if(mode==='autopilot')pilotTabId=info.tabId;
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
  $("loader").hidden=true;status("Stopped. Progress is saved; start again to resume from this page.");
  breakdown();
};

try {
  const health = await send({type: "settingsStatus"});
  $("cloud").textContent = health.configured ? "Cloud online" : "Cloud offline";
  $("cloud").className = health.configured ? "online" : "offline";
} catch {
  $("cloud").textContent = "Cloud offline";
  $("cloud").className = "offline";
}


$('close').onclick=async()=>{if(busy){token++;await send({type:'stop'}).catch(()=>{});}const win=await chrome.windows.getCurrent();await chrome.sidePanel.close({windowId:win.id});};

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
