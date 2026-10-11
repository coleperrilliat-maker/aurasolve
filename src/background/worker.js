import {validateConsent, statementMatches, HONOR_STATEMENT} from "../shared/policy.js";
import {checkBackend, solve} from "./api.js";
import {editorBridge} from './editors.js';
const plans = new Map(), jobs = new Map(), revisions = new Map();
const storageReady = chrome.storage.local.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"});
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
  const focused = candidates.filter(f=>f.selected);
  let options = focused.length === 1 ? focused : candidates;
  // Several guessed containers (e.g. a sidebar form and the question frame): use the one with the most answer controls.
  if (options.length > 1 && !known.length) options = [options.reduce((a,b)=>(b.fields.length-a.fields.length || b.question.length-a.question.length)>0?b:a)];
  if (options.length !== 1) throw new Error(options.length ? "Several questions were found. Click an answer field in the question you want." : "No supported question container was found. This page needs a site adapter; try the included practice lab.");
  return {top,question:options[0],contexts:frames.map(f=>f.context)};
}
async function frameCall(tabId, documentId, method, payload) {
  const result = await chrome.scripting.executeScript({target:{tabId,documentIds:[documentId]},func:async(method,payload)=>{
    await globalThis.__auraReady;
    if (!globalThis.__aura) throw new Error("AuraSolve is no longer attached to this page.");
    return globalThis.__aura[method](payload);
  },args:[method,payload ?? null]});
  if (!result[0] || result[0].result == null) throw new Error("The page action failed. Check the page before continuing.");
  return result[0].result;
}
const veil = (tabId, hidden) => chrome.scripting.executeScript({target:{tabId,frameIds:[0]},func:hidden=>globalThis.__auraVeil?.(hidden),args:[hidden]}).catch(()=>{});
async function screenshot(tabId, question) {
  const {windowId} = await chrome.tabs.get(tabId);
  await veil(tabId,true);
  let shot;
  try { await new Promise(resolve=>setTimeout(resolve,80)); shot = await chrome.tabs.captureVisibleTab(windowId,{format:"png"}); }
  finally { await veil(tabId,false); }
  const bitmap = await createImageBitmap(await (await fetch(shot)).blob());
  let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
  const r = question.rect;
  // Rects from child frames are relative to the iframe, so only crop for top-frame questions.
  if (question.frameId === 0 && r && question.viewport) {
    const scale = bitmap.width / question.viewport, pad = 16 * scale;
    sx = Math.max(0, r.x * scale - pad); sy = Math.max(0, r.y * scale - pad);
    sw = Math.min(bitmap.width, (r.x + r.width) * scale + pad) - sx; sh = Math.min(bitmap.height, (r.y + r.height) * scale + pad) - sy;
    if (sw < 40 || sh < 40) { sx = 0; sy = 0; sw = bitmap.width; sh = bitmap.height; }
  }
  const fit = Math.min(1, 1400 / sw, 1400 / sh);
  const canvas = new OffscreenCanvas(Math.round(sw * fit), Math.round(sh * fit));
  canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({type:"image/jpeg",quality:.82})).arrayBuffer());
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
  const frames = [state.question, ...(state.top.documentId !== state.question.documentId ? [state.top] : [])];
  const available = frames.filter(frame=>(frame.controls?.[kind] || 0)>0);
  if (available.length!==1 || available[0].controls[kind]!==1) throw new Error(`Could not identify exactly one ${kind} button. Your answer and explanation are still available.`);
  return available[0].documentId;
}
async function pageFeedback(tabId,state) {
  const outcomes = [];
  for (const documentId of new Set([state.question.documentId,state.top.documentId])) outcomes.push(await frameCall(tabId,documentId,'feedback'));
  return outcomes.find(o=>o.state==='incorrect') || outcomes.find(o=>o.state==='correct') || {state:'unknown',text:''};
}
async function submitPlan(tabId,plan,state) {
  // Resolve the control before modifying any answer. Pearson may put it in
  // the parent frame while the answer editor lives in a child frame.
  const documentId = controlDocument(state,'submit');
  if ((await pageFeedback(tabId,state)).state!=='unknown') throw new Error('This question already has feedback. Move to a fresh question.');
  const result = await frameCall(tabId,plan.documentId,'execute',{...plan,submit:true,deferSubmit:true});
  if (plan.generation!==rev(tabId)) throw new Error('Stopped.');
  const fresh = await collect(tabId);
  if (fresh.top.url!==plan.topUrl || fresh.question.documentId!==plan.documentId || fresh.question.hash!==plan.hash || controlDocument(fresh,'submit')!==documentId) throw new Error('The question or submit control changed. Review the filled answer manually.');
  await consent(tabId,fresh);
  if (plan.generation!==rev(tabId)) throw new Error('Stopped.');
  await frameCall(tabId,documentId,'clickControl','submit');
  return {...result,submitted:true};
}
async function resolveTab(message, sender) {
  if (sender.tab?.id != null) {
    if (sender.frameId !== 0) throw new Error("Open AuraSolve on a web page first.");
    return sender.tab.id;
  }
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab?.id) throw new Error("Open a practice page first.");
  await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:["src/content/bootstrap.js"]});
  return tab.id;
}
async function handle(message,sender) {
  if (sender.id !== chrome.runtime.id) throw new Error("Invalid extension sender.");
  if (message.type==='writeEditor') {
    const tabId=sender.tab?.id, plan=plans.get(message.planId);
    if (!plan || plan.tabId!==tabId || plan.documentId!==sender.documentId || !['applying','submitting'].includes(plan.state) || plan.generation!==rev(tabId) || Date.now()-plan.created>10*60*1000) throw new Error('The editor request is no longer active.');
    const state=await collect(tabId);await consent(tabId,state);
    if (state.top.url!==plan.topUrl || state.question.documentId!==plan.documentId || state.question.hash!==plan.hash) throw new Error('The question changed.');
    const field=state.question.fields.find(f=>f.id===message.target), action=plan.solution.actions.find(a=>a.target===message.target);
    if (!field?.editorKey || !action || action.kind!=='text' || !['mathquill','dojo'].includes(field.adapter)) throw new Error('Unsupported editor action.');
    if (plan.generation!==rev(tabId)) throw new Error('Stopped.');
    const result=await chrome.scripting.executeScript({target:{tabId,documentIds:[plan.documentId]},world:'MAIN',func:editorBridge,args:[{op:'write',key:field.editorKey,adapter:field.adapter,value:action.value}]});
    if (!result[0]?.result?.filled) throw new Error('The editor did not confirm the answer.');
    return result[0].result;
  }
  if (message.type === "settingsStatus") {
    const {settings={}} = await chrome.storage.local.get("settings");
    try {
      const health = await checkBackend(AbortSignal.timeout(8000));
      return {configured:health.keyConfigured !== false,model:settings.model || health.model || "gpt-4.1-mini",service:"AuraSolve Cloud"};
    } catch {
      return {configured:false,model:settings.model || "gpt-4.1-mini",service:"AuraSolve Cloud"};
    }
  }
  const tabId = await resolveTab(message, sender);
  if (message.type === "stop") { cancel(tabId); await chrome.storage.session.remove(`grant:${tabId}`); return {}; }
  if (message.type === "inspect") {
    const state = await collect(tabId);
    let signed = true;
    try { await consent(tabId,state); } catch { signed = false; }
    return {question:state.question,signed};
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
    await chrome.storage.session.set({[`grant:${tabId}`]:{url:state.top.url,statement:message.statement.trim(),signature:message.signature.trim(),expires:Date.now()+30*60*1000}});
    return {};
  }
  if (message.type === "solve") {
    if (!["explain","field","autopilot"].includes(message.mode)) throw new Error("Unknown mode.");
    cancel(tabId); const generation = rev(tabId);
    const state = await collect(tabId);
    if (message.mode !== "explain") await consent(tabId,state);
    if (message.mode === "field" && !state.question.selected) throw new Error("Click the answer field on the page, then choose Fill this field.");
    const {settings={}} = await chrome.storage.local.get("settings");
    if (rev(tabId)!==generation) throw new Error("Stopped.");
    const controller = new AbortController(); jobs.set(tabId,controller);
    const timeout = setTimeout(()=>controller.abort(),90000);
    let solution;
    try {
      const {rect, viewport, ...question} = state.question;
      if (question.visual) {
        question.image = await screenshot(tabId, state.question).catch(error => { console.warn("AuraSolve screenshot failed:", error); return null; });
        if (question.image) question.limitations = question.limitations.filter(l => !/Canvas\/SVG|image has no description/.test(l));
      }
      if (rev(tabId)!==generation) throw new Error("Stopped.");
      solution = await solve(question,message.mode,settings,controller.signal);
    }
    finally {clearTimeout(timeout);if(jobs.get(tabId)===controller)jobs.delete(tabId);}
    if (rev(tabId)!==generation) throw new Error("Stopped.");
    const id = crypto.randomUUID();
    plans.set(id,{id,tabId,frameId:state.question.frameId,documentId:state.question.documentId,topUrl:state.top.url,url:state.question.url,hash:state.question.hash,solution,mode:message.mode,generation,created:Date.now(),state:"ready"});
    return {planId:id,solution,question:state.question};
  }
  const plan = plans.get(message.planId);
  if (!plan || plan.tabId!==tabId || plan.generation!==rev(tabId) || Date.now()-plan.created>10*60*1000) throw new Error("The answer expired or was stopped. Generate a new answer.");
  const state = await collect(tabId); await consent(tabId,state);
  if (state.top.url!==plan.topUrl || state.question.documentId!==plan.documentId || state.question.url!==plan.url) throw new Error("The practice page changed. Start again.");
  if (plan.generation!==rev(tabId)) throw new Error("Stopped.");
  if (message.type === "apply") {
    if (plan.state!=="ready" || plan.mode==="explain") throw new Error("This answer cannot be applied again.");
    if (state.question.hash!==plan.hash) throw new Error("The question changed. Generate another answer.");
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
    return pageFeedback(tabId,state);
  }
  if (message.type === "next") {
    if (plan.state!=="submitted") throw new Error("This question has not been submitted.");
    if ((await pageFeedback(tabId,state)).state!=='correct') throw new Error('No correct-answer feedback was detected. Continue manually.');
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
chrome.tabs.onRemoved.addListener(tabId=>{cancel(tabId);chrome.storage.session.remove(`grant:${tabId}`);});

