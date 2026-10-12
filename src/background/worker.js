import {assignmentKey,decidePlayer} from '../shared/player-state.js';
import {expectedPage} from '../shared/pilot-engine.js';
import {fieldValue} from '../shared/solution.js';
import {validateConsent, statementMatches, HONOR_STATEMENT} from "../shared/policy.js";
import {checkBackend, solve} from "./api.js";
import {editorBridge} from './editors.js';
import {frameCall} from './frame-call.js';
const plans = new Map(), jobs = new Map(), revisions = new Map();
const storageReady = chrome.storage.local.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"}).then(async()=>{
  const {settings={}}=await chrome.storage.local.get("settings");
  if(!settings.modelUpgrade128){
    await chrome.storage.local.set({settings:{...settings,model:!settings.model || settings.model==="gpt-4.1-mini"?"gpt-4.1":settings.model,modelUpgrade128:true}});
  }
});
const rev = id => revisions.get(id) || 0;
async function collect(tabId) {
  await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',func:editorBridge,args:[{op:'discover'}]}).catch(()=>{});
  const results = await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:async()=>{
    try { await globalThis.__auraReady; return globalThis.__aura?.snapshot() || null; } catch { return null; }
  }});
  const frames = results.filter(r=>r.result).map(r=>({...r.result,frameId:r.frameId,documentId:r.documentId}));
  const top = frames.find(f=>f.frameId===0);
  if (!top) throw new Error("Reload this page and open AuraSolve again.");
  const found = frames.filter(f=>f.question);
  const known = found.filter(f=>!f.fallback);
  const candidates = known.length ? known : found;
  const focused = candidates.filter(f=>f.selected && f.selectionSource!=='automatic');
  let options = focused.length === 1 ? focused : candidates;
  // Several guessed containers (e.g. a sidebar form and the question frame): use the one with the most answer controls.
  if (options.length > 1 && !known.length) options = [options.reduce((a,b)=>(b.fields.length-a.fields.length || b.question.length-a.question.length)>0?b:a)];
  if (options.length !== 1) throw new Error(options.length ? "Several questions were found. Click an answer field in the question you want." : "No supported question container was found. This page needs a site adapter; try the included practice lab.");
  return {top,question:options[0],frames,contexts:frames.map(f=>f.context)};
}
const veil = (tabId, hidden) => chrome.scripting.executeScript({target:{tabId,allFrames:true},func:hidden=>globalThis.__auraVeil?.(hidden),args:[hidden]}).catch(()=>{});
async function screenshot(tabId, question) {
  const {windowId,active} = await chrome.tabs.get(tabId);
  if(!active)throw new Error("Keep the question tab active so AuraSolve can read its image.");
  await veil(tabId,true);
  let shot;
  try { await new Promise(resolve=>setTimeout(resolve,80)); shot = await chrome.tabs.captureVisibleTab(windowId,{format:"png"}); }
  finally { await veil(tabId,false); }
  const [activeTab] = await chrome.tabs.query({active:true,windowId});
  if (activeTab?.id !== tabId) throw new Error("The active tab changed during capture. Return to the question and retry.");
  const bitmap = await createImageBitmap(await (await fetch(shot)).blob());
  let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
  // Keep sibling diagram panels and the active answer area together.
  // A detected input container is not a reliable boundary for the problem.
  const fit = Math.min(1, 2048 / sw, 2048 / sh);
  const canvas = new OffscreenCanvas(Math.round(sw * fit), Math.round(sh * fit));
  canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({type:"image/jpeg",quality:.92})).arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(binary)}`;
}
async function consent(tabId, state) {
  const data = await chrome.storage.session.get(`grant:${tabId}`);
  validateConsent(data[`grant:${tabId}`],state.top.url);
}
function cancel(tabId) {
  revisions.set(tabId,rev(tabId)+1);
  jobs.get(tabId)?.abort(); jobs.delete(tabId);
  for (const [id,p] of plans) if (p.tabId===tabId) plans.delete(id);
}
function controlDocument(state, kind) {
  const frames = state.frames || [state.question,state.top];
  const available = frames.filter(frame=>(frame.controls?.[kind] || 0)>0);
  if (available.length!==1 || available[0].controls[kind]!==1) throw new Error(`Could not identify exactly one ${kind} button. Your answer and explanation are still available.`);
  return available[0].documentId;
}
async function pageFeedback(tabId,state) {
  const outcomes = [];
  for (const documentId of new Set((state.frames || [state.question,state.top]).map(frame=>frame.documentId))) outcomes.push(await frameCall(tabId,documentId,'feedback'));
  const dialogs=outcomes.filter(o=>o.modal);
  const candidates=dialogs.length?dialogs:outcomes;
  return candidates.find(o=>o.state==='incorrect') || candidates.find(o=>o.state==='correct') || {state:'unknown',text:''};
}
async function submitPlan(tabId,plan,state) {
  // Pearson may enable Check answer only after the inputs have changed.
  if ((await pageFeedback(tabId,state)).modal) throw new Error('This question already has feedback. Move to a fresh question.');
  const result = await frameCall(tabId,plan.documentId,'execute',{...plan,submit:true,deferSubmit:true});
  if (plan.generation!==rev(tabId)) throw new Error('Stopped.');
  let fresh,documentId;
  for(let attempt=0;attempt<20;attempt++){
    if(plan.generation!==rev(tabId))throw new Error('Stopped.');
    fresh=await collect(tabId);
    if(fresh.top.url!==plan.topUrl || fresh.question.documentId!==plan.documentId || fresh.question.hash!==plan.hash)throw new Error('The question changed. Review the filled answer manually.');
    const count=(fresh.frames || [fresh.question,fresh.top]).reduce((sum,frame)=>sum+(frame.controls?.submit || 0),0);
    if(count>0){documentId=controlDocument(fresh,'submit');break;}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  if(!documentId)throw new Error('Answers were filled, but Check answer did not become available. Inspect this page to report its submit control.');
  await consent(tabId,fresh);
  if (plan.generation!==rev(tabId)) throw new Error('Stopped.');
  await frameCall(tabId,documentId,'clickControl','submit');
  return {...result,submitted:true};
}
async function resolveTab(message, sender) {
  if (sender.tab?.id != null) {
    if (sender.frameId !== 0 && !["prepareField","solve","apply"].includes(message.type)) throw new Error("Open AuraSolve on a web page first.");
    if (sender.frameId !== 0 && message.type === "solve" && message.mode !== "field") throw new Error("Open this mode from the extension panel.");
    return sender.tab.id;
  }
  const tab=Number.isInteger(message.pilotTabId)?await chrome.tabs.get(message.pilotTabId):(await chrome.tabs.query({active:true,currentWindow:true}))[0];
  if (!tab?.id) throw new Error("Open a practice page first.");
  await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:["src/content/bootstrap.js"]});
  return tab.id;
}
async function activePilotTab(tabId){
  if(!(await chrome.tabs.get(tabId)).active)throw new Error('Return to the AutoPilot question tab and resume.');
}
async function playerView(tabId,state){
  const players=state.frames.filter(f=>f.player);
  const progressFrame=players.find(f=>f.player.progress.current && f.player.progress.questions.length) || players.find(f=>f.player.progress.current) || state.question;
  const controls={submit:0,submitPresent:0,continue:0,next:0,similar:0};
  for(const frame of players)for(const kind of Object.keys(controls))controls[kind]+=frame.player.controls[kind] || 0;
  const feedback=await pageFeedback(tabId,state);
  return {tabId,assignment:assignmentKey(state.top.url),documentId:state.question.documentId,url:state.question.url,
    hash:state.question.hash,promptHash:state.question.promptHash,fields:state.question.fields,
    progress:progressFrame.player?.progress || {current:null,part:null,status:'unknown',questions:[]},controls,feedback,
    incompleteWarning:players.some(f=>f.player.incompleteWarning)};
}
function requireExpected(view,expected){
  if(!expected || JSON.stringify(expectedPage(view))!==JSON.stringify(expected))throw new Error('The question changed. Resume from the current page.');
}
async function pilotAction(tabId,state,view,message){
  const generation=rev(tabId);
  const perform=async(documentId,method,payload)=>{
    const saved=await chrome.storage.session.get(`pilotRun:${tabId}`);
    if(rev(tabId)!==generation || saved[`pilotRun:${tabId}`]?.id!==message.pilotRunId)throw new Error('Stopped.');
    return frameCall(tabId,documentId,method,payload);
  };
  requireExpected(view,message.expected);
  const allowed=decidePlayer(view), action=message.action;
  if(allowed.kind!==action?.kind || allowed.number!==action.number)throw new Error('The page is no longer ready for that step. Resume AutoPilot.');
  await consent(tabId,state);await activePilotTab(tabId);
  if(['stay','dismiss'].includes(action.kind)){
    for(const frame of state.frames){
      const result=await perform(frame.documentId,action.kind==='stay'?'stayOnIncompleteQuestion':'dismissFeedback');
      if(result.stayed || result.clicked)return result;
    }
    throw new Error('The feedback dialog could not be closed. Review it and resume.');
  }
  if(action.kind==='question'){
    const frame=state.frames.find(f=>f.player?.progress.current===view.progress.current && f.player.progress.questions.some(q=>q.number===action.number));
    if(!frame)throw new Error('The question list changed. Resume from the current page.');
    return perform(frame.documentId,'navigateQuestion',action.number);
  }
  if(['continue','similar','next'].includes(action.kind))return perform(controlDocument(state,action.kind),'clickControl',action.kind);
  throw new Error('This step does not need a page action.');
}
async function handle(message,sender) {
  if (sender.id !== chrome.runtime.id) throw new Error("Invalid extension sender.");
  if (message.type==='writeEditor') {
    const tabId=sender.tab?.id, plan=plans.get(message.planId);
    if (!plan || plan.tabId!==tabId || plan.documentId!==sender.documentId || !['applying','submitting'].includes(plan.state) || plan.generation!==rev(tabId) || Date.now()-plan.created>10*60*1000) throw new Error('The editor request is no longer active.');
    const state=await collect(tabId);if(plan.mode!=="field")await consent(tabId,state);
    if (state.top.url!==plan.topUrl || state.question.documentId!==plan.documentId || state.question.hash!==plan.hash) throw new Error('The question changed.');
    const field=state.question.fields.find(f=>f.id===message.target), action=plan.solution.actions.find(a=>a.target===message.target);
    if (!field?.editorKey || !action || action.kind!==field.kind || !['mathquill','dojo','dojo-select'].includes(field.adapter)) throw new Error('Unsupported editor action.');
    if (plan.generation!==rev(tabId)) throw new Error('Stopped.');
    const result=await chrome.scripting.executeScript({target:{tabId,documentIds:[plan.documentId]},world:'MAIN',func:editorBridge,args:[{op:'write',key:field.editorKey,adapter:field.adapter,value:fieldValue(action.value,field)}]});
    if (!result[0]?.result?.filled) throw new Error('The editor did not confirm the answer.');
    return result[0].result;
  }
  if (message.type === "settingsStatus") {
    const {settings={}} = await chrome.storage.local.get("settings");
    try {
      const health = await checkBackend(AbortSignal.timeout(8000));
      return {configured:health.keyConfigured !== false,model:settings.model || health.model || "gpt-4.1",service:"AuraSolve Cloud"};
    } catch {
      return {configured:false,model:settings.model || "gpt-4.1",service:"AuraSolve Cloud"};
    }
  }
  const tabId = await resolveTab(message, sender);
  if(message.pilotRunId){
    const data=await chrome.storage.session.get(`pilotRun:${tabId}`);
    if(data[`pilotRun:${tabId}`]?.id!==message.pilotRunId)throw new Error('This AutoPilot run was replaced or stopped.');
  }
  if(message.type==='pilotOpen'){
    if(sender.tab)throw new Error('Start AutoPilot from its panel.');
    await activePilotTab(tabId);
    const state=await collect(tabId);await consent(tabId,state);
    const view=await playerView(tabId,state),runId=crypto.randomUUID();
    cancel(tabId);
    await chrome.storage.session.set({[`pilotRun:${tabId}`]:{id:runId,assignment:view.assignment}});
    const key=`pilot:${view.assignment}`,data=await chrome.storage.local.get(key);
    return {runId,view,checkpoint:data[key] || null};
  }
  if(['pilotRead','pilotSave','pilotAction'].includes(message.type)){
    if(!message.pilotRunId || sender.tab)throw new Error('Start AutoPilot from its panel.');
    if(message.type==='pilotSave'){
      const data=await chrome.storage.session.get(`pilotRun:${tabId}`),run=data[`pilotRun:${tabId}`];
      if(message.checkpoint?.assignment!==run?.assignment || JSON.stringify(message.checkpoint).length>500000)throw new Error('Invalid AutoPilot checkpoint.');
      await chrome.storage.local.set({[`pilot:${run.assignment}`]:message.checkpoint});return {};
    }
    await activePilotTab(tabId);
    const state=await collect(tabId),view=await playerView(tabId,state);
    if(message.type==='pilotRead')return view;
    return pilotAction(tabId,state,view,message);
  }

  if (message.type === 'inspectPage') {
    await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',func:editorBridge,args:[{op:'discover'}]});
    const reports=await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:async()=>{await globalThis.__auraReady;return globalThis.__aura?.inspectControls?.() || null;}});
    return {version:chrome.runtime.getManifest().version,frames:reports.filter(r=>r.result).map(r=>({frameId:r.frameId,...r.result}))};
  }
  if(message.type==="stayIfIncomplete"){
    const results=await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:async()=>{
      await globalThis.__auraReady;
      return globalThis.__aura?.stayOnIncompleteQuestion?.() || {stayed:false};
    }});
    return {stayed:results.some(r=>r.result?.stayed)};
  }
  if (message.type === "stop") { cancel(tabId); await chrome.storage.session.remove(`grant:${tabId}`); await chrome.storage.session.remove(`pilotRun:${tabId}`); return {}; }
  if (message.type==='prepareField') {
    const state=await collect(tabId);
    await frameCall(tabId,state.question.documentId,'prepareField');
    await chrome.scripting.executeScript({target:{tabId,documentIds:[state.question.documentId]},world:'MAIN',func:editorBridge,args:[{op:'prepare'}]});
    return {};
  }
  if (message.type === "inspect") {
    const state = await collect(tabId);
    let signed = true;
    try { await consent(tabId,state); } catch { signed = false; }
    return {tabId,question:state.question,signed};
  }
  if (message.type === "nextProblem") {
    cancel(tabId);
    const state = await collect(tabId);
    for (const documentId of new Set([state.question.documentId, state.top.documentId])) {
      const result = await frameCall(tabId, documentId, "nextProblem");
      if (result.clicked) return {clicked:true,hash:state.question.hash};
    }
    return {clicked:false,hash:state.question.hash};
  }
  if (message.type === "consent") {
    const state = await collect(tabId);
    if (!statementMatches(message.statement)) throw new Error(`Type exactly: ${HONOR_STATEMENT}`);
    if (typeof message.signature !== "string" || message.signature.trim().length < 2 || message.signature.length > 100) throw new Error("Sign with your name.");
    await chrome.storage.session.set({[`grant:${tabId}`]:{url:state.top.url,statement:message.statement.trim(),signature:message.signature.trim(),expires:Date.now()+4*60*60*1000}});
    return {};
  }
  if (message.type === "solve") {
    if (!["explain","field","autopilot"].includes(message.mode)) throw new Error("Unknown mode.");
    cancel(tabId); const generation = rev(tabId);
    let state = await collect(tabId);
    if (message.mode === "autopilot") {await consent(tabId,state);await activePilotTab(tabId);}
    if(message.expected)requireExpected(await playerView(tabId,state),message.expected);
    await chrome.scripting.executeScript({target:{tabId,documentIds:[state.question.documentId]},world:"MAIN",func:editorBridge,args:[{op:"prepare"}]});
    state = await collect(tabId);
    const {settings={}} = await chrome.storage.local.get("settings");
    if (rev(tabId)!==generation) throw new Error("Stopped.");
    const controller = new AbortController(); jobs.set(tabId,controller);
    const timeout = setTimeout(()=>controller.abort(),180000);
    let solution, visualRead = false;
    try {
      const {rect, viewport, player, ...question} = state.question;
      question.activePart=player?.progress?.part || null;
      question.totalParts=player?.progress?.totalParts || null;
      // Limit feedback context; it is evidence about rejected answers, never instructions.
      if(Array.isArray(message.retryContext))question.retryContext=message.retryContext.slice(-3);

      if (question.visual) {
        question.image = await screenshot(tabId, state.question).catch(error => { throw new Error(`Could not capture the question image: ${error.message}`); });
        visualRead = Boolean(question.image);
        if (question.image) question.limitations = question.limitations.filter(l => !/Canvas\/SVG|image has no description/.test(l));
      }
      if (rev(tabId)!==generation) throw new Error("Stopped.");
      const fresh=await collect(tabId);
      if(fresh.question.hash!==state.question.hash || fresh.question.documentId!==state.question.documentId)throw new Error("The question changed while reading it. Please retry.");
      const missingField=message.mode==='field' && !question.fields.length;
      solution = await solve(question,missingField?'explain':message.mode==='field'?'autopilot':message.mode,settings,controller.signal);
      if (missingField) solution={...solution,supported:false,actions:[],limitation:'I can explain this question, but could not detect a supported answer box on this page.'};
    }
    finally {clearTimeout(timeout);if(jobs.get(tabId)===controller)jobs.delete(tabId);}
    if (rev(tabId)!==generation) throw new Error("Stopped.");
    const id = crypto.randomUUID();
    plans.set(id,{id,tabId,frameId:state.question.frameId,documentId:state.question.documentId,topUrl:state.top.url,url:state.question.url,hash:state.question.hash,solution,visualRead,mode:message.mode,generation,created:Date.now(),state:"ready"});
    return {planId:id,solution,question:state.question};
  }
  const plan = plans.get(message.planId);
  if (!plan || plan.tabId!==tabId || plan.generation!==rev(tabId) || Date.now()-plan.created>10*60*1000) throw new Error("The answer expired or was stopped. Generate a new answer.");
  const state = await collect(tabId);
  if (plan.mode!=="field" || message.type!=="apply") await consent(tabId,state);
  if (state.top.url!==plan.topUrl || state.question.documentId!==plan.documentId || state.question.url!==plan.url) throw new Error("The practice page changed. Start again.");
  if (plan.generation!==rev(tabId)) throw new Error("Stopped.");
  if (message.type === "apply") {
    if (plan.state!=="ready" || plan.mode==="explain") throw new Error("This answer cannot be applied again.");
    if (state.question.hash!==plan.hash) throw new Error("The question changed. Generate another answer.");
    if(message.pilotRunId)await activePilotTab(tabId);
    const submit = plan.mode === "autopilot";
    if (plan.generation!==rev(tabId)) throw new Error("Stopped.");
    plan.state="applying";
    const result = submit ? await submitPlan(tabId,plan,state) : await frameCall(tabId,plan.documentId,"execute",{...plan,submit:false});
    plan.state=submit?"submitted":"filled";
    return result;
  }
  if (message.type === "submitField") {
    if (plan.mode!=="field" || plan.state!=="filled") throw new Error("Fill and review a field before submitting it.");
    if (state.question.hash!==plan.hash) throw new Error("The question changed. Generate another answer.");
    plan.state="submitting";
    try {
      const result = await submitPlan(tabId,plan,state);
      plan.state="submitted";
      return result;
    } catch (error) {
      plan.state="filled";
      throw error;
    }
  }
  if (message.type === "feedback") {
    if (plan.state!=="submitted") throw new Error("No submitted question to check.");
    const outcome=await pageFeedback(tabId,state);
    if(outcome.state!=='unknown')plan.verdict=outcome.state;
    return outcome;
  }
  if(message.type==='acknowledge'){
    if(plan.state!=='submitted')throw new Error('No submitted question to acknowledge.');
    const outcome=await pageFeedback(tabId,state);
    if(outcome.state!=='unknown')plan.verdict=outcome.state;
    if(!['correct','incorrect'].includes(plan.verdict))throw new Error('No answer feedback detected.');
    let clicked=false;
    for(let attempt=0;attempt<12;attempt++){
      if(plan.generation!==rev(tabId))throw new Error('Stopped.');
      for(const documentId of new Set((state.frames || [state.question,state.top]).map(frame=>frame.documentId))){
        const dismissed=await frameCall(tabId,documentId,'dismissFeedback');
        if(dismissed.clicked){clicked=true;break;}
      }
      if(clicked || (await pageFeedback(tabId,state)).state==='unknown')break;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    if(!clicked && (await pageFeedback(tabId,state)).state!=='unknown')throw new Error('Feedback is still open, but its OK button was not found.');
    return {acknowledged:true,clicked};
  }
  if(message.type==='continuation'){
    if(plan.state!=='submitted')throw new Error('No submitted part to continue.');
    const controls=(state.frames || [state.question,state.top]).reduce((all,f)=>{
      for(const key of ['submit','similar','next'])all[key]+=(f.controls?.[key] || 0);
      return all;
    },{submit:0,similar:0,next:0});
    return {controls,question:state.question};
  }

  if(message.type==='similar'){
    if(plan.state!=='submitted' || !['incorrect','correct'].includes(plan.verdict))throw new Error('A confirmed result is required before trying a similar question.');
    const documentId=controlDocument(state,'similar');
    if(plan.generation!==rev(tabId))throw new Error('Stopped.');
    plan.state='advancing';
    await frameCall(tabId,documentId,'clickControl','similar');
    return {advanced:true};
  }
  if (message.type === "next") {
    if (plan.state!=="submitted") throw new Error("This question has not been submitted.");
    if (plan.verdict!=='correct' && (await pageFeedback(tabId,state)).state!=='correct') throw new Error('No correct-answer feedback was detected. Continue manually.');
    const documentId=controlDocument(state,'next');
    if (plan.generation!==rev(tabId)) throw new Error('Stopped.');
    plan.state="advancing";
    await frameCall(tabId,documentId,'clickControl','next');
    return {advanced:true};
  }
  throw new Error("Unknown request.");
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  storageReady.then(()=>handle(message,sender)).then(data=>reply({ok:true,data})).catch(error=>reply({ok:false,error:error.name === "AbortError"?"Request stopped or timed out. Nothing else will be submitted.":error.message}));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId=>{cancel(tabId);chrome.storage.session.remove(`grant:${tabId}`);chrome.storage.session.remove(`pilotRun:${tabId}`);});


// Keep the extension open while the user interacts with the question.
chrome.sidePanel?.setPanelBehavior({openPanelOnActionClick:true}).catch(console.error);
