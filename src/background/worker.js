import {assignmentKey,decidePlayer} from '../shared/player-state.js';
import {expectedPage} from '../shared/pilot-engine.js';
import {fieldValue, dropdownsOnly, withoutDropdownDiagram} from '../shared/solution.js';
import {statementMatches, HONOR_STATEMENT} from "../shared/policy.js";
import {checkBackend, solve} from "./api.js";
import {editorBridge} from './editors.js';
import {awaitSelection, placeClick, trustedClick, withDebugger} from './trusted-click.js';
import {frameCall} from './frame-call.js';
import {cropBox} from '../shared/capture.js';
import {DEFAULT_MODEL} from '../shared/config.js';
const plans = new Map(), jobs = new Map(), revisions = new Map();
const storageReady = chrome.storage.local.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"}).then(async()=>{
  const {settings={}}=await chrome.storage.local.get("settings");
  if(!settings.modelUpgrade5){
    const legacy=!settings.model || /^gpt-4(\.1|o)(-mini)?$/.test(settings.model);
    await chrome.storage.local.set({settings:{...settings,model:legacy?DEFAULT_MODEL:settings.model,effort:settings.effort || 'medium',modelUpgrade5:true}});
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
  // Image questions are cropped to the question and its picture choices.
  // Text questions keep the full tab; an input box is not a safe crop.
  const box = question.imageBased ? cropBox(bitmap, question.rect, question.devicePixelRatio) : null;
  if (box) ({sx, sy, sw, sh} = box);
  const fit = Math.min(1, 2048 / sw, 2048 / sh);
  const canvas = new OffscreenCanvas(Math.round(sw * fit), Math.round(sh * fit));
  canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({type:"image/jpeg",quality:.92})).arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(binary)}`;
}
async function consent() {}
function cancel(tabId) {
  revisions.set(tabId,rev(tabId)+1);
  jobs.get(tabId)?.abort(); jobs.delete(tabId);
  for (const [id,p] of plans) if (p.tabId===tabId) plans.delete(id);
}
function controlDocument(state, kind) {
  const frames = state.frames || [state.question,state.top];
  let available = frames.filter(frame=>(frame.controls?.[kind] || 0)>0);
  const label=kind==='submit'?'Check answer':kind==='next'?'Next':kind;
  if (kind==='next' && available.length>1) {
    const top=available.find(frame=>frame.frameId===0);
    available=[top || available[0]];
  }
  if (!available.length || (kind!=='submit' && kind!=='next' && (available.length!==1 || available[0].controls[kind]!==1)) || ((kind==='submit' || kind==='next') && available.length!==1))
    throw new Error(`Could not identify exactly one ${label} button. Your answer and explanation are still available.`);
  return available[0].documentId;
}
async function pageFeedback(tabId,state) {
  const outcomes = [];
  for (const documentId of new Set((state.frames || [state.question,state.top]).map(frame=>frame.documentId))) outcomes.push(await frameCall(tabId,documentId,'feedback'));
  const dialogs=outcomes.filter(o=>o.modal);
  const candidates=dialogs.length?dialogs:outcomes;
  return candidates.find(o=>o.state==='incorrect') || candidates.find(o=>o.state==='correct') || {state:'unknown',text:''};
}
const fillPlan = (tabId,plan,requireComplete=false) => frameCall(tabId,plan.documentId,'execute',{...plan,submit:false,requireComplete});
function footerNext(op, only='') {
  try {
    const clean = value => String(value || '').replace(/\s+/g,' ').trim();
    const buttonText = value => clean(String(value || '').replace(/[\u200B-\u200D\uFEFF\uE000-\uF8FF]/g,'').replace(/\s*[›>»→]+\s*$/,''));
    const classify = label => {
      const text = buttonText(label);
      if (!text) return '';
      if (text.length<=80 && /\bfinal\s+check\b/i.test(text) && !/\b(?:assignment|homework|test|quiz|exam)\b/i.test(text)) return 'final';
      if (/^(?:check(?:\s+my)?\s+answer)$/i.test(text)) return 'check';
      if (/^next(?:\s+(?:question|problem))?$/i.test(text)) return 'next';
      return '';
    };
    const kindOf = el => {
      const bits = [el.innerText, el.value, el.getAttribute?.('aria-label'), el.getAttribute?.('title')];
      for (const child of el.querySelectorAll?.(':scope > span, :scope > div') || []) bits.push(child.innerText);
      const labels = bits.map(buttonText).filter(Boolean);
      if (labels.some(text => /\b(?:submit|finish|turn in)\s+(?:assignment|homework|test|quiz|exam)\b/i.test(text) || /^save best score$/i.test(text))) return '';
      let kind = '';
      for (const text of labels) {
        const next = classify(text);
        if (next === 'final') return 'final';
        if (next && !kind) kind = next;
      }
      return kind;
    };
    const redOf = color => {
      const match = String(color || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (!match) return 0;
      return Number(match[1]) - Math.max(Number(match[2]), Number(match[3]));
    };
    const nodes = [];
    const visit = root => {
      if (!root?.querySelectorAll) return;
      nodes.push(...root.querySelectorAll('button,a,input,[role="button"],div,span'));
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
    };
    if (op==='nudge') {
      const active = document.activeElement;
      if (active && active!==document.body) {
        active.dispatchEvent(new FocusEvent('focusout', {bubbles:true}));
        active.blur?.();
      }
      return {count:0, clicked:false, nudged:true};
    }
    visit(document);
    const candidates = [];
    const seen = new Set();
    let disabledCheck = false;
    for (const el of nodes) {
      let kind = kindOf(el);
      if (!kind) continue;
      let target = el;
      if (!el.matches?.('button,a,input,[role="button"]')) {
        const host = el.closest?.('button,a,input,[role="button"]');
        if (host) { target = host; if (kindOf(host)==='final' || kind==='final') kind = 'final'; else kind = kindOf(host) || kind; }
      }
      if (seen.has(target)) continue;
      seen.add(target);
      if (target.closest('[hidden],[aria-hidden="true"]')) continue;
      if (target.disabled || target.getAttribute('aria-disabled')==='true' || target.classList?.contains('disabled')) {
        if ((kind==='check' || kind==='final') && target.getClientRects().length) disabledCheck = true;
        continue;
      }
      if (only && kind!==only) continue;
      const rect = target.getBoundingClientRect();
      if (rect.width<40 || rect.height<22 || rect.width>320 || rect.height>88) continue;
      const style = getComputedStyle(target);
      if (style.display==='none' || style.visibility==='hidden' || style.pointerEvents==='none' || Number(style.opacity)===0) continue;
      const dialog = Boolean(target.closest?.('[role="dialog"],[role="alertdialog"],.dijitDialog,.feedbackDialog,.xlDialogButtonContainer'));
      candidates.push({el:target, kind, dialog, area:rect.width*rect.height, bottom:rect.bottom, right:rect.right, red:redOf(style.backgroundColor)});
    }
    const page = candidates.filter(item=>!item.dialog);
    const visible = page.length ? page : candidates;
    const checks = visible.filter(item=>item.kind==='final' || item.kind==='check');
    const base = checks.length ? checks : visible;
    const vivid = base.filter(item=>item.red>25);
    const pool = vivid.length ? vivid : base;
    const ranked = pool.slice().sort((a,b)=>((b.kind==='final')-(a.kind==='final')) || b.red-a.red || b.bottom-a.bottom || a.area-b.area);
    const best = ranked[0];
    const hasFinal = visible.some(item=>item.kind==='final');
    const hasNext = visible.some(item=>item.kind==='next');
    if (!best) return {count:0, clicked:false, red:0, bottom:0, kind:'', hasFinal, hasNext, disabledCheck};
    const found = {count:ranked.length, clicked:false, red:best.red, bottom:best.bottom, right:best.right, kind:best.kind, hasFinal, hasNext, disabledCheck};
    if (op!=='press') return found;
    best.el.click();
    return {...found, clicked:true};
  } catch { return {count:0, clicked:false, red:0, bottom:0, kind:'', hasFinal:false, hasNext:false}; }
}
// Pearson enables Check answer a moment after the answer registers. While a
// greyed-out Check answer is on the page, wait for it rather than pressing Next,
// which would skip the check.
async function clickFooterNext(tabId, generation, only='') {
  let best = null, waitingForCheck = false;
  const weight = kind => kind==='final' ? 2 : kind==='check' ? 1 : 0;
  const pause = ms => new Promise(resolve=>setTimeout(resolve, globalThis.__AURA_INSTANT__ ? 0 : ms));
  for (let attempt=0; attempt<30; attempt++) {
    if (generation != null && rev(tabId) !== generation) throw new Error('Stopped.');
    let listed = [];
    try { listed = await chrome.scripting.executeScript({target:{tabId, allFrames:true}, func:footerNext, args:['locate', only]}); }
    catch { listed = []; }
    waitingForCheck = !only && listed.some(frame=>frame.result?.disabledCheck);
    const ranked = listed.filter(frame=>frame.result?.count>0).sort((a,b)=>(weight(b.result.kind)-weight(a.result.kind)) || (b.result.red-a.result.red) || (b.result.bottom-a.result.bottom));
    best = ranked[0] || null;
    if (best && (best.result.kind!=='next' || !waitingForCheck)) break;
    best = null;
    if (!waitingForCheck && attempt>=7) break;
    if (waitingForCheck && attempt===10) {
      await chrome.scripting.executeScript({target:{tabId, allFrames:true}, func:footerNext, args:['nudge']}).catch(()=>{});
    }
    await pause(200);
  }
  if (!best) return {clicked:false, disabledCheck:waitingForCheck};
  if (generation != null && rev(tabId) !== generation) throw new Error('Stopped.');
  try {
    const pressed = await chrome.scripting.executeScript({target:{tabId, frameIds:[best.frameId]}, func:footerNext, args:['press', only]});
    if (!pressed[0]?.result?.clicked) return {clicked:false};
    return {clicked:true, kind:pressed[0].result.kind || best.result.kind || 'next'};
  } catch (error) {
    if (!error.submission) error.submission = 'unknown';
    throw error;
  }
}
async function clickNextAfterFinalCheck(tabId, generation) {
  for (let attempt=0; attempt<10; attempt++) {
    if (generation != null && rev(tabId) !== generation) throw new Error('Stopped.');
    let listed = [];
    try { listed = await chrome.scripting.executeScript({target:{tabId, allFrames:true}, func:footerNext, args:['locate']}); }
    catch { listed = []; }
    const results = listed.map(frame=>frame.result).filter(Boolean);
    const finalUp = results.some(result=>result.hasFinal);
    const nextUp = results.some(result=>result.hasNext);
    if ((!finalUp || attempt===9) && nextUp) return clickFooterNext(tabId, generation, 'next');
    if (!finalUp && !nextUp) return {clicked:false};
    if (attempt<9) await new Promise(resolve=>setTimeout(resolve, globalThis.__AURA_INSTANT__ ? 0 : 200));
  }
  return {clicked:false};
}
async function offerIncorrectRetry(tabId, plan) {
  const pauses = globalThis.__AURA_INSTANT__ ? 1 : 12;
  let open = false;
  for (let attempt = 0; attempt < pauses; attempt++) {
    if (plan.generation !== rev(tabId)) throw new Error('Stopped.');
    const state = await collect(tabId);
    if (state.question?.hash && state.question.hash !== plan.hash) return {asked:false};
    let sawIncorrect = false, sawCorrect = false;
    try {
      const outcome = await pageFeedback(tabId, state);
      if (outcome.state === 'incorrect' && (outcome.modal || outcome.dismissible)) sawIncorrect = true;
      if (outcome.state === 'correct') sawCorrect = true;
    } catch {}
    for (const documentId of new Set((state.frames || [state.question, state.top]).map(frame => frame.documentId).filter(Boolean))) {
      try {
        if ((await frameCall(tabId, documentId, 'incorrectNotice'))?.open) sawIncorrect = true;
      } catch {}
    }
    if (sawIncorrect) { open = true; break; }
    if (sawCorrect) return {asked:false};
    if (attempt < pauses - 1) await new Promise(resolve => setTimeout(resolve, globalThis.__AURA_INSTANT__ ? 0 : 250));
  }
  if (!open) return {asked:false};
  const state = await collect(tabId);
  let answer;
  try { answer = await frameCall(tabId, state.top.documentId, 'askRetry'); }
  catch (error) { return {asked:false, error:error.message}; }
  if (!answer?.yes) return {asked:true, retried:false};
  let clicked = false;
  for (const documentId of new Set((state.frames || [state.question, state.top]).map(frame => frame.documentId).filter(Boolean))) {
    try {
      if ((await frameCall(tabId, documentId, 'dismissFeedback'))?.clicked) { clicked = true; break; }
    } catch {}
  }
  if (!clicked) throw Object.assign(new Error('You chose to try again, but the OK button was not clicked.'), {submission:'unknown'});
  return {asked:true, retried:true, clicked:true};
}
// Pearson ignores a script click on some answer menus, so their choices are
// never created. Open each one once with a real click, read it, and close it.
async function revealLazyMenus(tabId, documentId) {
  const call=(op, extra={})=>chrome.scripting.executeScript({target:{tabId,documentIds:[documentId]},world:'MAIN',func:editorBridge,args:[{op,...extra}]});
  const listed=await call('lazyMenus').catch(()=>null);
  const menus=listed?.[0]?.result || [];
  if(!Array.isArray(menus) || !menus.length)return;
  const frameId=listed[0].frameId;
  const pause=()=>new Promise(resolve=>setTimeout(resolve, globalThis.__AURA_INSTANT__ ? 0 : 50));
  await withDebugger(tabId, async ()=>{
    const reports=await frameReports(tabId);
    for(const menu of menus.slice(0,8)){
      const point=placeClick(reports, frameId, {x:menu.x,y:menu.y}, menu.href);
      if(!point)continue;
      await trustedClick(tabId, point.x, point.y);
      let read=null;
      for(let attempt=0;attempt<20;attempt++){
        read=(await call('readMenu',{key:menu.key}))?.[0]?.result;
        if(read?.count)break;
        await pause();
      }
      if(read?.open)await trustedClick(tabId, point.x, point.y);
    }
  }).catch(()=>{});
}
async function prepareAnswers(tabId,state,activate=true) {
  if(activate)await frameCall(tabId,state.question.documentId,'prepareField');
  await chrome.scripting.executeScript({target:{tabId,documentIds:[state.question.documentId]},world:'MAIN',func:editorBridge,args:[{op:'prepare'}]});
  if(activate)await revealLazyMenus(tabId,state.question.documentId);
  return collect(tabId);
}
async function submitPlan(tabId,plan,state) {
  let submission='not_sent';
  try {
    // Fill first, exactly as the Fill button does. Pearson enables Check answer
    // in response to input/change events, so resolve that button afterwards.
    if ((await pageFeedback(tabId,state)).modal) throw new Error('This question already has feedback. Move to a fresh question.');
    const result = await fillPlan(tabId,plan,true);
    if (plan.generation!==rev(tabId)) throw new Error('Stopped.');
    let fresh,documentId,advance;
    for(let attempt=0;attempt<20;attempt++){
      if(plan.generation!==rev(tabId))throw new Error('Stopped.');
      fresh=await collect(tabId);
      const sameQuestion=fresh.question.hash===plan.hash || (plan.promptHash && fresh.question.promptHash===plan.promptHash);
      if(fresh.top.url!==plan.topUrl || fresh.question.documentId!==plan.documentId || !sameQuestion)throw new Error('The question changed. Review the filled answer manually.');
      const frames=fresh.frames || [fresh.question,fresh.top];
      const submit=frames.reduce((sum,frame)=>sum+(frame.controls?.submit || 0),0);
      const submitPresent=frames.reduce((sum,frame)=>sum+(frame.controls?.submitPresent || 0),0);
      const next=frames.reduce((sum,frame)=>sum+(frame.controls?.next || 0),0);
      // Practice players enable Check answer after the fill. A pre-test has no
      // Check answer; its lower-right Next advances the question. The top Submit
      // button is the assignment hand-in and is never used here.
      if(submit>0){advance='submit';documentId=controlDocument(fresh,'submit');break;}
      if(submitPresent===0 && next>0){advance='next';documentId=controlDocument(fresh,'next');break;}
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    if(!documentId)throw new Error('Answers were filled, but neither Check answer nor Next became available. The assignment Submit button was not clicked.');
    await consent(tabId,fresh);
    if (plan.generation!==rev(tabId)) throw new Error('Stopped.');
    // Once dispatched, a lost reply cannot prove that the click did not happen.
    submission='unknown';
    const clicked=await frameCall(tabId,documentId,'clickControl',advance);
    if(!clicked?.clicked)throw new Error(advance==='next'?'Next did not confirm its click. Resume from the current question.':'Check answer did not confirm its click. Resume to check page feedback.');
    return {...result,submitted:true};
  } catch(error) {
    error.submission=submission;
    throw error;
  }
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
async function frameReports(tabId) {
  const results=await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:()=>{
    try {
      return {href:location.href,iframes:[...document.querySelectorAll('iframe')].map(frame=>{
        const rect=frame.getBoundingClientRect();
        let childHref='';
        try { childHref=frame.contentWindow?.location?.href || ''; } catch {}
        return {id:frame.id || '',name:frame.name || '',src:frame.src || '',childHref,left:rect.left+frame.clientLeft,top:rect.top+frame.clientTop};
      })};
    } catch { return {href:'',iframes:[]}; }
  }});
  return results.filter(item=>item.result).map(item=>({frameId:item.frameId,href:item.result.href,iframes:item.result.iframes}));
}
async function fillReason(tabId, plan, field, value) {
  const call=(op, extra={})=>chrome.scripting.executeScript({target:{tabId,documentIds:[plan.documentId]},world:'MAIN',func:editorBridge,args:[{op,key:field.editorKey,adapter:field.adapter,value,...extra}]});
  const outcome=result=>{
    if (result?.[0]?.error) throw new Error(result[0].error);
    return result?.[0]?.result;
  };
  const probe=outcome(await call('aim', {trust:true}));
  if (!probe?.aimed) return null;
  if (probe.selected && outcome(await call('shown'))?.filled) return {filled:true};
  const name=field.label && field.label!=='Reason' ? `${field.label} (${probe.widgetId || 'dropdown'})` : (probe.widgetId || field.label || 'This dropdown');
  const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
  const place=async aimedResult=>{
    const aimed=outcome(aimedResult);
    const located=placeClick(await frameReports(tabId), aimedResult?.[0]?.frameId, {x:aimed.x,y:aimed.y}, aimed.href);
    if (!located) throw new Error(`${name} was found, but the click could not be placed on it.`);
    await trustedClick(tabId, located.x, located.y);
    return aimed;
  };
  return withDebugger(tabId, async ()=>{
    let last=null;
    for (let attempt=0; attempt<2; attempt++) {
      let aimedResult=await call('aim', {trust:true, reopen: attempt>0});
      let aimed=outcome(aimedResult);
      if (aimed?.selected && outcome(await call('shown'))?.filled) return {filled:true};
      if (aimed?.needsOpen) {
        await place(aimedResult);
        let opened=false;
        for (let watch=0; watch<20 && !opened; watch++) {
          await pause();
          aimedResult=await call('aim', {trust:true});
          aimed=outcome(aimedResult);
          if (aimed?.selected && outcome(await call('shown'))?.filled) return {filled:true};
          opened=aimed?.aimed && !aimed.needsOpen && !aimed.pending && Number.isFinite(aimed.x);
        }
        if (!opened) throw new Error(`${name} did not open.`);
      }
      if (!Number.isFinite(aimed?.x) || !Number.isFinite(aimed?.y)) throw new Error(`${name} opened, but that reason was not on it.`);
      await place(aimedResult);
      const confirmed=await awaitSelection(async ()=>outcome(await call('shown')), pause);
      if (confirmed?.filled) return {filled:true};
      last=confirmed;
    }
    throw new Error(last?.error || `${name} did not keep the reason. The box still shows "nothing".`);
  });
}
async function handle(message,sender) {
  if (sender.id !== chrome.runtime.id) throw new Error("Invalid extension sender.");
  if (message.type==='writeEditor') {
    const tabId=sender.tab?.id, plan=plans.get(message.planId);
    if (!plan || plan.tabId!==tabId || plan.documentId!==sender.documentId || !['applying','submitting'].includes(plan.state) || plan.generation!==rev(tabId) || Date.now()-plan.created>10*60*1000) throw new Error('The editor request is no longer active.');
    const state=await collect(tabId);if(plan.mode!=="field")await consent(tabId,state);
    const samePrompt=Boolean(plan.promptHash) && state.question.promptHash===plan.promptHash;
    if (state.top.url!==plan.topUrl || state.question.documentId!==plan.documentId || (state.question.hash!==plan.hash && !samePrompt)) throw new Error('The question changed.');
    const field=state.question.fields.find(f=>f.id===message.target), action=plan.solution.actions.find(a=>a.target===message.target);
    if (!field?.editorKey || !action || action.kind!==field.kind || !['mathquill','dojo','dojo-select'].includes(field.adapter)) throw new Error('Unsupported editor action.');
    if (plan.generation!==rev(tabId)) throw new Error('Stopped.');
    const value=fieldValue(action.value,field);
    if (field.adapter==='dojo-select') {
      const trusted=await fillReason(tabId, plan, field, value);
      if (trusted) return trusted;
    }
    const result=await chrome.scripting.executeScript({target:{tabId,documentIds:[plan.documentId]},world:'MAIN',func:editorBridge,args:[{op:'write',key:field.editorKey,adapter:field.adapter,value}]});
    const outcome=result?.[0];
    if (outcome?.error) throw new Error(outcome.error);
    if (!outcome?.result?.filled) throw new Error(outcome?.result?.error || 'The editor did not confirm the answer.');
    return result[0].result;
  }
  if (message.type === "settingsStatus") {
    const {settings={}} = await chrome.storage.local.get("settings");
    try {
      const health = await checkBackend(AbortSignal.timeout(8000));
      return {configured:health.keyConfigured !== false,model:settings.model || health.model || DEFAULT_MODEL,service:"AuraSolve Cloud"};
    } catch {
      return {configured:false,model:settings.model || DEFAULT_MODEL,service:"AuraSolve Cloud"};
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
    if(message.type==='pilotRead'){
      if(!view.fields.length && view.controls.submitPresent && !view.controls.continue && !view.controls.similar && !view.feedback.modal && !view.incompleteWarning){
        await consent(tabId,state);
        return playerView(tabId,await prepareAnswers(tabId,state));
      }
      return view;
    }
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
    await prepareAnswers(tabId,state);
    return {};
  }
  if (message.type === "inspect") {
    const state = await collect(tabId);
    return {tabId,question:state.question,signed:true};
  }
  if (message.type === 'checkResult') {
    // Wait for Pearson's verdict after Check answer, then close its popup.
    const pause = ms => new Promise(resolve=>setTimeout(resolve, globalThis.__AURA_INSTANT__ ? 0 : ms));
    let verdict = 'unknown', text = '', modal = false;
    for (let attempt=0; attempt<(globalThis.__AURA_INSTANT__ ? 2 : 24); attempt++) {
      const state = await collect(tabId).catch(()=>null);
      if (!state) { await pause(250); continue; }
      let incorrectCard = false;
      for (const documentId of new Set((state.frames || [state.question, state.top]).map(frame=>frame.documentId).filter(Boolean))) {
        try { if ((await frameCall(tabId, documentId, 'incorrectNotice'))?.open) incorrectCard = true; } catch {}
      }
      const outcome = await pageFeedback(tabId, state).catch(()=>({state:'unknown', text:''}));
      verdict = incorrectCard ? 'incorrect' : outcome.state;
      text = outcome.text || '';
      modal = Boolean(outcome.modal || incorrectCard);
      if (verdict !== 'unknown' || modal) break;
      await pause(250);
    }
    let dismissed = false;
    const shown = modal ? await collect(tabId).catch(()=>null) : null;
    if (shown) {
      for (const documentId of new Set((shown.frames || [shown.question, shown.top]).map(frame=>frame.documentId).filter(Boolean))) {
        try { if ((await frameCall(tabId, documentId, 'dismissFeedback'))?.clicked) { dismissed = true; break; } } catch {}
      }
      if (dismissed) await pause(500);
    }
    return {verdict, text:String(text).slice(0,500), dismissed};
  }
  if (message.type === 'advanceQuestion') {
    // After a checked answer: Continue to the next part, otherwise Next question.
    const generation = rev(tabId);
    const state = await collect(tabId).catch(()=>null);
    const frames = state ? state.frames || [state.question, state.top] : [];
    const continues = frames.filter(frame=>(frame.controls?.continue || 0) > 0);
    if (continues.length === 1) {
      const clicked = await frameCall(tabId, continues[0].documentId, 'clickControl', 'continue').catch(()=>null);
      if (clicked?.clicked) return {moved:'continue'};
    }
    const next = await clickFooterNext(tabId, generation, 'next');
    if (next.clicked) return {moved:'next'};
    for (const documentId of new Set(frames.map(frame=>frame.documentId).filter(Boolean))) {
      const result = await frameCall(tabId, documentId, 'nextProblem').catch(()=>null);
      if (result?.clicked) return {moved:'next'};
    }
    return {moved:'none'};
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
    state=await prepareAnswers(tabId,state,message.mode!=='explain');
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

      const drawFigure=/draw the next figure|list of figures/i.test(question.question || '');
      if (question.imageBased || drawFigure || /\bfigures?\b/i.test(question.question || '')) question.visual = true;
      if (dropdownsOnly(question.fields)) {
        const slim=withoutDropdownDiagram(question);
        question.visual=false;question.imageBased=false;
        delete question.image;delete question.figureImages;
        question.limitations=slim.limitations;
      }
      if (question.imageBased) {
        const revealed = state.question.documentId ? await frameCall(tabId, state.question.documentId, 'revealQuestion').catch(() => null) : null;
        question.rect = revealed?.rect || rect;
        if (revealed?.devicePixelRatio) question.devicePixelRatio = revealed.devicePixelRatio;
      }
      if (question.visual) {
        question.image = await screenshot(tabId, question).catch(error => { throw new Error(`Could not capture the question image: ${error.message}`); });
        visualRead = Boolean(question.image);
        if (question.image) question.limitations = question.limitations.filter(l => !/Canvas\/SVG|image has no description/.test(l));
      }
      if (rev(tabId)!==generation) throw new Error("Stopped.");
      const fresh=await collect(tabId);
      if(fresh.question.documentId!==state.question.documentId || (fresh.question.hash!==state.question.hash && fresh.question.promptHash!==state.question.promptHash))throw new Error("The question changed while reading it. Please retry.");
      state.question.hash=fresh.question.hash;
      const discrete=question.fields.some(field=>['text','select','radio','checkbox'].includes(field.kind));
      const missingField=message.mode==='field' && !question.fields.length;
      if (drawFigure && !discrete && message.mode!=='explain') {
        solution = await solve(question,'explain',settings,controller.signal);
        const next=String(solution.answer || '').replace(/\s+/g,' ').trim();
        solution={...solution,supported:false,actions:[],confidence:Math.min(solution.confidence || 0,.49),
          limitation:next ? `This question asks you to draw the next figure. Nothing was filled. ${next}` : 'This question asks you to draw the next figure. The drawing area cannot be filled automatically.'};
      } else {
        solution = await solve(question,missingField?'explain':message.mode==='field'?'autopilot':message.mode,settings,controller.signal);
        if (missingField) solution={...solution,supported:false,actions:[],limitation:'I can explain this question, but could not detect a supported answer box on this page.'};
      }
    }
    finally {clearTimeout(timeout);if(jobs.get(tabId)===controller)jobs.delete(tabId);}
    if (rev(tabId)!==generation) throw new Error("Stopped.");
    const id = crypto.randomUUID();
    plans.set(id,{id,tabId,frameId:state.question.frameId,documentId:state.question.documentId,topUrl:state.top.url,url:state.question.url,hash:state.question.hash,promptHash:state.question.promptHash,solution,visualRead,mode:message.mode,generation,created:Date.now(),state:"ready"});
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
    if (!submit) {
      const filled = await fillPlan(tabId,plan);
      if (!filled || filled.filled !== plan.solution.actions.length) throw Object.assign(new Error('Not every answer was verified. Check answer and Next were not pressed.'), {submission:'not_sent'});
      const follow = await clickFooterNext(tabId, plan.generation);
      plan.state = "filled";
      if (!follow.clicked) {
        if (follow.disabledCheck) throw Object.assign(new Error('Filled the answer, but Pearson kept Check answer greyed out. Click in the answer box, then press Check answer.'), {submission:'not_sent'});
        if (message.stopAtEnd) return {...filled, submitted:false, advanced:'end'};
        throw Object.assign(new Error('Filled the answer, but Check answer and Next were not pressed.'), {submission:'not_sent'});
      }
      if (follow.kind === 'final' && message.stopAtEnd) return {...filled, submitted:false, advanced:'check', checked:'final'};
      if (follow.kind === 'final') {
        const retry = message.confirmIncorrect ? await offerIncorrectRetry(tabId, plan) : null;
        if (retry?.asked) return {...filled, submitted:false, advanced:'check', checked:'final', retry};
        const next = await clickNextAfterFinalCheck(tabId, plan.generation);
        if (next.clicked) return {...filled, submitted:false, advanced:'next', checked:'final', retry};
        if (message.stopAtEnd) return {...filled, submitted:false, advanced:'end', checked:'final', retry};
        return {...filled, submitted:false, advanced:'check', checked:'final', retry};
      }
      const retry = follow.kind === 'check' && message.confirmIncorrect ? await offerIncorrectRetry(tabId, plan) : null;
      return {...filled, submitted:false, advanced:follow.kind==='check'?'check':'next', retry};
    }
    const result = await submitPlan(tabId,plan,state);
    plan.state="submitted";
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
      plan.state=error.submission==='not_sent'?"filled":"submission_unknown";
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
  storageReady.then(()=>handle(message,sender)).then(data=>reply({ok:true,data})).catch(error=>reply({ok:false,error:error.name === "AbortError"?"Request stopped or timed out. Nothing else will be submitted.":error.message,
    ...(['not_sent','unknown'].includes(error.submission)?{submission:error.submission}:{})}));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId=>{cancel(tabId);chrome.storage.session.remove(`grant:${tabId}`);chrome.storage.session.remove(`pilotRun:${tabId}`);});


// Keep the extension open while the user interacts with the question.
chrome.sidePanel?.setPanelBehavior({openPanelOnActionClick:true}).catch(console.error);
