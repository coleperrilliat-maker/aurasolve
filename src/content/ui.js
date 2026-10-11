import {renderSolution, loadMathFonts} from "../shared/render.js";
import {HONOR_STATEMENT, statementMatches} from "../shared/policy.js";
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
export function createUI() {
  const host = document.createElement("div"); host.id="aurasolve-root";
  host.style.cssText="all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0";
  const shadow=host.attachShadow({mode:"closed"});
  for(const sheet of ["src/vendor/katex/katex.min.css","src/shared/loader.css","src/content/ui.css"]){const link=document.createElement("link");link.rel="stylesheet";link.href=chrome.runtime.getURL(sheet);shadow.append(link);}
  // @font-face rules don't apply inside a shadow root, so KaTeX's fonts are registered on the document.
  loadMathFonts(path=>chrome.runtime.getURL(path)).catch(()=>{});
  const wrap=document.createElement("div");
  wrap.innerHTML=`
  <nav class="dock" aria-label="AuraSolve modes"><span class="dock-grip" title="Drag to move · double-click to reset" aria-hidden="true"></span><button data-mode="autopilot" title="Practice AutoPilot" aria-label="Practice AutoPilot">✈️</button><button data-mode="field" title="Fill this field" aria-label="Fill this field">✍️</button><button data-mode="explain" title="Explain to me" aria-label="Explain to me">💡</button></nav>
  <aside class="panel" hidden aria-label="AuraSolve practice tutor">
    <header id="drag" title="Drag to move"><span class="grip" aria-hidden="true"></span><button class="icon" id="close" title="Close" aria-label="Close">×</button></header>
    <div class="body">
      <p class="notice" id="status" role="status" aria-live="polite">Choose a mode. For one field, click that field first.</p>
      <div class="loader-wrap" id="loader" hidden aria-hidden="true"><div class="spinner"></div></div>
      <button id="stop" class="stop" hidden>Stop</button>
      <section class="consent" id="consent" hidden><h2>Honor code</h2><p>AuraSolve fills answers and, in AutoPilot, clicks submit for up to five questions. You are responsible for using it only where it's allowed.</p><label class="signature">Type: <b class="phrase">${HONOR_STATEMENT}</b><input id="statement" type="text" autocomplete="off" spellcheck="false" maxlength="120" placeholder="${HONOR_STATEMENT}" /></label><label class="signature">Sign your name<input id="signature" type="text" autocomplete="off" maxlength="100" placeholder="Your name" /></label><small>Your signature lasts 30 minutes on this page and is cleared when you stop.</small><button id="confirm" class="primary" disabled>Sign & continue</button><button id="cancel" class="secondary">Cancel</button></section>
      <div id="results" aria-live="polite"></div>
    </div>
    <footer class="next-bar" id="nextbar" hidden><button id="next" class="primary">Next problem →</button></footer>
  </aside>`;
  shadow.append(wrap);document.documentElement.append(host);
  const $=selector=>shadow.querySelector(selector), panel=$(".panel"), results=$("#results");
  let running=false, token=0, pending=null, pendingField=null, consentUrl=null, explainedPrompt=null, watching=false, seen=null;
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
  const dock=$(".dock"), DOCK_KEY="aurasolve-dock";
  // Some sites (SARA) have a white work area beside a grey sidebar; sit the dock on that edge instead of over the sidebar.
  function seam() {
    const y=Math.round(innerHeight*.45);
    const bgAt=x=>{
      for(const el of document.elementsFromPoint(x,y)){
        if(el===host)continue;
        const parts=getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
        if(parts && (parts[3]===undefined || +parts[3]>.5))return parts.slice(0,3).map(Number);
      }
      return [255,255,255];
    };
    const light=c=>c.every(v=>v>=246);
    let prev=bgAt(innerWidth-2);
    for(let x=innerWidth-6;x>innerWidth*.4;x-=4){const cur=bgAt(x);if(light(cur)&&!light(prev))return x+2;prev=cur;}
    return null;
  }
  function placeDock() {
    const saved=(()=>{try{return JSON.parse(localStorage.getItem(DOCK_KEY));}catch{return null;}})();
    const width=dock.offsetWidth||48, height=dock.offsetHeight||150;
    let left=null, top=null;
    if(saved && Number.isFinite(saved.left)){left=saved.left;top=saved.top;}
    else if(/(^|\.)raydass\.com$/.test(location.hostname)){const edge=seam();if(edge)left=edge-width/2;}
    if(left==null){Object.assign(dock.style,{left:"",right:"",top:""});if(!panel.classList.contains("moved"))panel.style.right="";return;}
    left=Math.min(Math.max(4,left),innerWidth-width-4);
    if(top!=null)top=Math.min(Math.max(4,top),innerHeight-height-4);
    Object.assign(dock.style,{left:`${left}px`,right:"auto",top:top==null?"":`${top}px`});
    if(!panel.classList.contains("moved"))panel.style.right=`${Math.max(8,innerWidth-left+8)}px`;
  }
  const grip=$(".dock-grip");
  grip.addEventListener("pointerdown",event=>{
    if(event.button!==0)return;
    const rect=dock.getBoundingClientRect(), dx=event.clientX-rect.left, dy=event.clientY-rect.top;
    grip.setPointerCapture(event.pointerId);dock.classList.add("dragging");
    const move=e=>{
      const left=Math.min(Math.max(4,e.clientX-dx),innerWidth-rect.width-4), top=Math.min(Math.max(4,e.clientY-dy),innerHeight-rect.height-4);
      Object.assign(dock.style,{left:`${left}px`,top:`${top}px`,right:"auto"});
    };
    const up=()=>{
      dock.classList.remove("dragging");grip.removeEventListener("pointermove",move);grip.removeEventListener("pointerup",up);grip.removeEventListener("pointercancel",up);
      const r=dock.getBoundingClientRect();try{localStorage.setItem(DOCK_KEY,JSON.stringify({left:r.left,top:r.top}));}catch{}
      placeDock();
    };
    grip.addEventListener("pointermove",move);grip.addEventListener("pointerup",up);grip.addEventListener("pointercancel",up);
  });
  grip.addEventListener("dblclick",()=>{try{localStorage.removeItem(DOCK_KEY);}catch{}placeDock();});
  requestAnimationFrame(placeDock);setTimeout(placeDock,1500);
  addEventListener("resize",()=>requestAnimationFrame(placeDock));
  function busy(value) {
    running=value;$("#stop").hidden=!value;
    const canContinue=results.children.length && (panel.dataset.view!=="field" || pendingField);
    $("#nextbar").hidden=value || !canContinue;
    shadow.querySelectorAll("[data-mode]").forEach(el=>el.disabled=value);
  }
  async function stop() {token++;pending=null;pendingField=null;consentUrl=null;$("#consent").hidden=true;busy(false);try{await request({type:"stop"});}catch{}status("Stopped. Review any answer already filled or submitted before continuing.","STOPPED");}
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
        $("#loader").hidden=false;
        let result;
        try{result=await request({type:"solve",mode});}finally{$("#loader").hidden=true;}
        live();
        if(mode!=="autopilot") {
          if(mode==="explain")explainedPrompt=result.question.promptHash;
          const article=card(result,mode,i);
          if(mode==="field" && result.solution.supported && result.solution.actions.length && result.solution.confidence>=.85) {
            status("Filling your selected field…","FILLING");
            await request({type:"apply",planId:result.planId});live();
            const filled=document.createElement("div");filled.className="feedback";filled.textContent="✓ Field filled";
            article.append(filled);
            pendingField={planId:result.planId,hash:result.question.hash};
            $("#next").textContent="Submit & next →";
            status("Field filled. Review it, then press Submit & next.","FILLED");
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
    pendingField=null;
    panel.dataset.view=mode;panel.classList.toggle("explain",mode==="explain");open();
    $("#next").textContent=mode==="field"?"Submit & next →":"Next problem →";
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
  async function nextProblem() {
    const mode=panel.dataset.view;
    if(running || !mode)return;
    const mine=++token;busy(true);$("#nextbar").hidden=true;
    const fieldPlan=mode==="field" ? pendingField : null;
    status(fieldPlan?"Submitting your reviewed answer…":"Going to the next problem…","Next");
    try {
      let moved;
      if(fieldPlan){
        await request({type:"submitField",planId:fieldPlan.planId});
        let outcome;
        for(let poll=0;poll<12;poll++){await sleep(500);if(mine!==token)return;outcome=await request({type:"feedback",planId:fieldPlan.planId});if(outcome.state!=="unknown")break;}
        if(outcome?.state!=="correct"){
          pendingField=null;
          throw new Error(outcome?.state==="incorrect"?"The page marked this answer incorrect. Review the explanation.":"The answer was submitted, but page feedback could not be confirmed. Continue manually.");
        }
        pendingField=null;
        status("Correct — going to the next problem…","Next");
        await request({type:"next",planId:fieldPlan.planId});
        moved={clicked:true,hash:fieldPlan.hash};
      } else moved=await request({type:"nextProblem"});
      let changed=false;
      for(let poll=0;poll<(moved.clicked?20:1);poll++){
        await sleep(500);if(mine!==token)return;
        try{const info=await request({type:"inspect"});if(info.question.hash!==moved.hash){changed=true;break;}}catch{}
      }
      if(mine!==token)return;
      if(!changed)throw new Error(moved.clicked?"The next problem didn't load. Try again, or move to it yourself.":"Couldn't find the page's Next button. Go to the next problem yourself, then press Next problem.");
    } catch(error) {if(mine===token){busy(false);status(error.message,"Needs attention");}return;}
    pendingField=null;
    busy(false);
    if(mode==="field"){
      results.replaceChildren();$("#nextbar").hidden=true;
      status("Next problem ready. Click its answer field, then choose Fill this field.","READY");
      return;
    }
    await choose(mode);
  }
  $("#next").onclick=nextProblem;
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
