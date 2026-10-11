import {renderSolution} from "../shared/render.js";
import {HONOR_STATEMENT, statementMatches} from "../shared/policy.js";
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
export function createUI() {
  const host = document.createElement("div"); host.id="aurasolve-root";
  host.style.cssText="all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0";
  const shadow=host.attachShadow({mode:"closed"});
  const style=document.createElement("link");style.rel="stylesheet";style.href=chrome.runtime.getURL("src/content/ui.css");shadow.append(style);
  const wrap=document.createElement("div");
  wrap.innerHTML=`
  <nav class="dock" aria-label="AuraSolve modes"><button data-mode="autopilot" title="Practice AutoPilot" aria-label="Practice AutoPilot">✈️</button><button data-mode="field" title="Fill this field" aria-label="Fill this field">✍️</button><button data-mode="explain" title="Explain to me" aria-label="Explain to me">💡</button></nav>
  <aside class="panel" hidden aria-label="AuraSolve practice tutor">
    <header id="drag" title="Drag to move"><span class="grip" aria-hidden="true"></span><button class="icon" id="close" title="Close" aria-label="Close">×</button></header>
    <div class="body">
      <p class="notice" id="status" role="status" aria-live="polite">Choose a mode. For one field, click that field first.</p>
      <button id="stop" class="stop" hidden>Stop</button>
      <section class="consent" id="consent" hidden><h2>Honor code</h2><p>AuraSolve fills answers and, in AutoPilot, clicks submit for up to five questions. You are responsible for using it only where it's allowed.</p><label class="signature">Type: <b class="phrase">${HONOR_STATEMENT}</b><input id="statement" type="text" autocomplete="off" spellcheck="false" maxlength="120" placeholder="${HONOR_STATEMENT}" /></label><label class="signature">Sign your name<input id="signature" type="text" autocomplete="off" maxlength="100" placeholder="Your name" /></label><small>Your signature lasts 30 minutes on this page and is cleared when you stop.</small><button id="confirm" class="primary" disabled>Sign & continue</button><button id="cancel" class="secondary">Cancel</button></section>
      <div id="results" aria-live="polite"></div>
    </div>
  </aside>`;
  shadow.append(wrap);document.documentElement.append(host);
  const $=selector=>shadow.querySelector(selector), panel=$(".panel"), results=$("#results");
  let running=false, token=0, pending=null, consentUrl=null, explainedPrompt=null, watching=false, seen=null;
  const request=async message=>{const response=await chrome.runtime.sendMessage(message);if(!response?.ok)throw new Error(response?.error || "AuraSolve disconnected. Reload the page.");return response.data;};
  const open=()=>{panel.hidden=false;};
  const status=text=>{$("#status").textContent=text;};
  $("#drag").addEventListener("pointerdown",event=>{
    if(event.button!==0 || event.target.closest("button"))return;
    const rect=panel.getBoundingClientRect(), dx=event.clientX-rect.left, dy=event.clientY-rect.top;
    panel.classList.add("dragging","moved");
    Object.assign(panel.style,{left:`${rect.left}px`,top:`${rect.top}px`,right:"auto",transform:"none"});
    $("#drag").setPointerCapture(event.pointerId);
    const move=e=>{
      const x=Math.min(Math.max(8,e.clientX-dx),innerWidth-rect.width-8);
      const y=Math.min(Math.max(8,e.clientY-dy),innerHeight-48);
      panel.style.left=`${x}px`;panel.style.top=`${y}px`;
    };
    const up=()=>{panel.classList.remove("dragging");$("#drag").removeEventListener("pointermove",move);$("#drag").removeEventListener("pointerup",up);$("#drag").removeEventListener("pointercancel",up);};
    $("#drag").addEventListener("pointermove",move);$("#drag").addEventListener("pointerup",up);$("#drag").addEventListener("pointercancel",up);
  });
  function busy(value) {running=value;$("#stop").hidden=!value;shadow.querySelectorAll("[data-mode]").forEach(el=>el.disabled=value);}
  async function stop() {token++;pending=null;consentUrl=null;$("#consent").hidden=true;busy(false);try{await request({type:"stop"});}catch{}status("Stopped. Review any answer already filled or submitted before continuing.","STOPPED");}
  function card(result,mode,number) {
    const article=renderSolution(result,mode==="autopilot"?`Question ${number}`:"");
    results.prepend(article);
    return article;
  }
  async function run(mode) {
    const mine=++token;busy(true);$("#consent").hidden=true;
    const live=()=>{if(mine!==token)throw new Error("Stopped.");};
    try {
      const settings=await request({type:"settingsStatus"});live();
      if(!settings.configured)throw new Error("AuraSolve Cloud is offline or not configured. Open Settings to check the server, then reload the extension.");
      for(let i=1;i<=(mode==="autopilot"?5:1);i++) {
        live();status(mode==="autopilot"?`Working on practice question ${i} of 5…`:"Reading the question and thinking it through…","THINKING");
        const result=await request({type:"solve",mode});live();
        if(mode!=="autopilot") {
          if(mode==="explain")explainedPrompt=result.question.promptHash;
          const article=card(result,mode,i);
          if(mode==="field" && result.solution.supported && result.solution.actions.length && result.solution.confidence>=.85) {
            status("Filling your selected field…","FILLING");
            await request({type:"apply",planId:result.planId});live();
            const filled=document.createElement("div");filled.className="feedback";filled.textContent="✓ Field filled";
            article.append(filled);
            status("Field filled. Review it on the page; you choose whether to submit.","FILLED");
          } else if(mode==="explain") $(".notice").hidden=true;
          else status("Automatic filling is unavailable for this answer. Use the explanation to complete it manually.","MANUAL STEP");
          break;
        }
        if(!result.solution.supported || result.solution.confidence<.85 || !result.solution.actions.length) {card(result,mode,i);throw new Error("AutoPilot paused: this answer needs a manual step or more certainty.");}
        status("Filling the practice answer and checking it…","CHECKING");
        await request({type:"apply",planId:result.planId});live();
        const article=card(result,mode,i);
        const feedbackLabel=document.createElement("div");feedbackLabel.className="feedback";feedbackLabel.textContent="Submitted · waiting for page feedback";article.append(feedbackLabel);
        let outcome;
        for(let poll=0;poll<12;poll++){await sleep(500);live();outcome=await request({type:"feedback",planId:result.planId});live();if(outcome.state!=="unknown")break;}
        if(outcome?.state!=="correct") {feedbackLabel.textContent=outcome?.state==="incorrect"?"The page marked this incorrect. Review the explanation.":"Submission not verified. Check the page manually.";throw new Error("AutoPilot stopped because a correct answer was not confirmed.");}
        feedbackLabel.textContent="✓ The page confirmed this answer";
        status(i===5?"Five practice questions completed. Your tutor notes are below.":"Answer checked. Read your tutor notes; continuing shortly…",i===5?"SESSION COMPLETE":"NICE WORK");
        if(i===5)break;
        await sleep(3500);live();
        await request({type:"next",planId:result.planId});live();
        let changed=false;
        for(let poll=0;poll<12;poll++){await sleep(500);live();const next=await request({type:"inspect"});live();if(next.question.hash!==result.question.hash){changed=true;break;}}
        if(!changed)throw new Error("The next question did not load. AutoPilot stopped.");
      }
    } catch(error) {if(mine===token)status(error.message,"NEEDS ATTENTION");}
    finally {if(mine===token)busy(false);}
  }
  async function choose(mode) {
    if(running)return;
    panel.dataset.view=mode;panel.classList.toggle("explain",mode==="explain");open();
    results.replaceChildren();$(".notice").hidden=false;
    status("Checking the current question…","CHECKING");
    const mine=++token;
    shadow.querySelectorAll("[data-mode]").forEach(el=>el.classList.toggle("active",el.dataset.mode===mode));
    if(mode==="explain"){pending=null;return run(mode);}
    busy(true);
    try {
      const info=await request({type:"inspect"});
      if(mine!==token)return;
      if(mode==="field" && !info.question.selected)throw new Error("Click the answer field on the page first, then choose Fill a field.");
      if(info.signed || consentUrl===location.href){busy(false);return await run(mode);}
      pending=mode;$("#consent").hidden=false;$("#statement").value="";$("#signature").value="";$("#confirm").disabled=true;
      status("Type the honor statement and sign to continue.","Honor code");
    }catch(error){status(error.message,"NEEDS ATTENTION");}finally{busy(false);}
  }
  shadow.querySelectorAll("[data-mode]").forEach(button=>button.onclick=()=>choose(button.dataset.mode));
  const explaining=()=>!running && !panel.hidden && panel.dataset.view==="explain" && explainedPrompt && !document.hidden;
  // A new question must look the same on two polls in a row so half-loaded pages don't trigger a solve.
  setInterval(async()=>{
    if(watching || !explaining())return;
    watching=true;
    try {
      const {question}=await request({type:"inspect"});
      const fresh=question.promptHash && question.promptHash!==explainedPrompt;
      if(fresh && seen===question.promptHash && explaining()){seen=null;explainedPrompt=question.promptHash;await choose("explain");}
      else seen=fresh?question.promptHash:null;
    } catch {seen=null;}
    finally {watching=false;}
  },2000);
  const signed=()=>statementMatches($("#statement").value) && $("#signature").value.trim().length>=2;
  for(const id of ["#statement","#signature"])$(id).addEventListener("input",()=>{$("#confirm").disabled=!signed();$("#statement").classList.toggle("ok",statementMatches($("#statement").value));});
  $("#confirm").onclick=async()=>{const mode=pending;if(!mode || !signed())return;$("#confirm").disabled=true;try{await request({type:"consent",statement:$("#statement").value,signature:$("#signature").value});consentUrl=location.href;pending=null;await run(mode);}catch(error){status(error.message,"Check signature");}finally{$("#confirm").disabled=!signed();}};
  $("#cancel").onclick=()=>{pending=null;$("#consent").hidden=true;status("Choose a mode whenever you’re ready.");};
  $("#close").onclick=()=>{if(running)stop();panel.hidden=true;};
  $("#stop").onclick=stop;
  document.addEventListener("visibilitychange",()=>{if(document.hidden && running)stop();});
  return {open,veil:hidden=>{host.style.visibility=hidden?"hidden":"";}};
}
