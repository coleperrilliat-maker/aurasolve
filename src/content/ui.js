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
    <header><div class="brand"><span class="mark">a</span><div><strong>AuraSolve<span class="dot">.</span></strong><small>YOUR PRACTICE COMPANION</small></div></div><button class="icon" id="close" title="Close sidebar" aria-label="Close sidebar">×</button></header>
    <div class="body">
      <div class="eyebrow"><span></span> A LITTLE HELP. A LOT MORE CLARITY.</div>
      <h1>Let’s make it<br><span>make sense.</span></h1>
      <p class="intro">Work through practice, one clear explanation at a time.</p>
      <div class="modes"><button data-mode="autopilot"><span>✈️</span><b>AutoPilot</b><small>Practice together</small></button><button data-mode="field"><span>✍️</span><b>Fill a field</b><small>One answer</small></button><button data-mode="explain"><span>💡</span><b>Explain</b><small>Understand why</small></button></div>
      <section class="notice"><div class="badge" id="badge">READY WHEN YOU ARE</div><p id="status" role="status" aria-live="polite">Open a practice question and choose a mode. For one field, click that field first.</p><button id="stop" class="stop" hidden>■ Stop AutoPilot / request</button></section>
      <section class="consent" id="consent" hidden><h2>Practice only. Your call.</h2><p>AuraSolve will fill answers and, in AutoPilot, click submit for up to five practice questions. It sends the detected question and field labels to OpenAI. It stops if the page appears graded or is unsupported.</p><label class="check"><input id="agree" type="checkbox"> I confirm this is ungraded practice, not homework, a quiz, a test, or an assessment.</label><label class="signature">Type your name<input id="signature" type="text" autocomplete="off" maxlength="100" placeholder="Your name" /></label><small>Page checks are imperfect. This confirmation lasts 30 minutes on this page and is cleared when you stop.</small><button id="confirm" class="primary">Confirm & continue</button><button id="cancel" class="secondary">Cancel</button></section>
      <div id="results" aria-live="polite"></div>
      <div class="empty" id="empty"><div class="orb">✦</div><h2>A tutor, right beside you.</h2><p>Your answer previews and explanations will appear here.</p><div class="pill">PRACTICE ONLY · YOU’RE IN CONTROL</div></div>
    </div>
    <footer><span>Private workspace <i>✦</i></span><button id="settings">API key & settings ↗</button></footer>
  </aside>`;
  shadow.append(wrap);document.documentElement.append(host);
  const $=selector=>shadow.querySelector(selector), panel=$(".panel"), results=$("#results");
  let running=false, token=0, pending=null, consentUrl=null;
  const request=async message=>{const response=await chrome.runtime.sendMessage(message);if(!response?.ok)throw new Error(response?.error || "AuraSolve disconnected. Reload the page.");return response.data;};
  const open=()=>{panel.classList.remove("quick");panel.hidden=false;};
  const quick=()=>{panel.classList.add("quick");panel.hidden=false;};
  const status=(text,badge="READY")=>{$("#status").textContent=text;$("#badge").textContent=badge;};
  function busy(value) {running=value;$("#stop").hidden=!value;shadow.querySelectorAll("[data-mode]").forEach(el=>el.disabled=value);}
  async function stop() {token++;pending=null;consentUrl=null;$("#consent").hidden=true;busy(false);try{await request({type:"stop"});}catch{}status("Stopped. Review any answer already filled or submitted before continuing.","STOPPED");}
  function card(result,mode,number) {
    $("#empty").hidden=true;
    const article=document.createElement("article");article.className="result";
    const label=document.createElement("div");label.className="result-label";label.textContent=mode==="autopilot"?`PRACTICE ${number} · TUTOR NOTES`:mode==="field"?"ANSWER PREVIEW":"LET’S WALK THROUGH IT";
    const answer=document.createElement("h2");answer.textContent=result.solution.answer;
    const explanation=document.createElement("p");explanation.textContent=result.solution.explanation;
    article.append(label,answer,explanation);
    if (result.solution.limitation) {const note=document.createElement("p");note.className="limitation";note.textContent=result.solution.limitation;article.append(note);}
    results.prepend(article);return article;
  }
  async function run(mode) {
    const mine=++token;busy(true);$("#consent").hidden=true;
    const live=()=>{if(mine!==token)throw new Error("Stopped.");};
    try {
      const settings=await request({type:"settingsStatus"});live();
      if(!settings.configured)throw new Error("Add your OpenAI API key using Settings below. API usage is billed by OpenAI.");
      for(let i=1;i<=(mode==="autopilot"?5:1);i++) {
        live();status(mode==="autopilot"?`Working on practice question ${i} of 5…`:"Reading the question and thinking it through…","THINKING");
        const result=await request({type:"solve",mode});live();
        if(mode!=="autopilot") {
          const article=card(result,mode,i);
          if(mode==="field" && result.solution.supported && result.solution.actions.length && result.solution.confidence>=.85) {
            status("Filling your selected field…","FILLING");
            await request({type:"apply",planId:result.planId});live();
            const filled=document.createElement("div");filled.className="feedback";filled.textContent="✓ Field filled";
            article.append(filled);
            status("Field filled. Review it on the page; you choose whether to submit.","FILLED");
          } else status(mode==="explain"?"Your explanation is ready.":"Automatic filling is unavailable for this answer. Use the explanation to complete it manually.",mode==="explain"?"EXPLAINED":"MANUAL STEP");
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
    if(running)return;quick();
    results.replaceChildren();$("#empty").hidden=true;
    status("Checking the current question…","CHECKING");
    const mine=++token;
    shadow.querySelectorAll("[data-mode]").forEach(el=>el.classList.toggle("active",el.dataset.mode===mode));
    if(mode==="explain"){pending=null;return run(mode);}
    busy(true);
    try {
      const info=await request({type:"inspect"});
      if(mine!==token)return;
      if(info.status.state!=="practice")throw new Error(info.status.reason);
      if(mode==="field" && !info.question.selected)throw new Error("Click the answer field on the page first, then choose Fill a field.");
      if(consentUrl===location.href){busy(false);return await run(mode);}
      pending=mode;$("#consent").hidden=false;$("#agree").checked=false;$("#signature").value="";
      status("Confirm this is ungraded practice before continuing.","YOUR CONFIRMATION");
    }catch(error){status(error.message,"NEEDS ATTENTION");}finally{busy(false);}
  }
  shadow.querySelectorAll("[data-mode]").forEach(button=>button.onclick=()=>choose(button.dataset.mode));
  $("#confirm").onclick=async()=>{const mode=pending;if(!mode)return;$("#confirm").disabled=true;try{await request({type:"consent",agree:$("#agree").checked,signature:$("#signature").value});consentUrl=location.href;pending=null;await run(mode);}catch(error){status(error.message,"CHECK CONFIRMATION");}finally{$("#confirm").disabled=false;}};
  $("#cancel").onclick=()=>{pending=null;$("#consent").hidden=true;status("Choose a mode whenever you’re ready.");};
  $("#close").onclick=()=>{if(running)stop();panel.hidden=true;};
  $("#stop").onclick=stop;
  $("#settings").onclick=()=>request({type:"settings"}).catch(error=>status(error.message));
  document.addEventListener("visibilitychange",()=>{if(document.hidden && running)stop();});
  return {open};
}
