import {decidePlayer} from './player-state.js';

export const partKey = v => `${v.progress?.current || v.url}|${v.progress?.part || 1}|${v.promptHash || v.hash}`;
export const expectedPage = v => ({assignment:v.assignment,documentId:v.documentId,hash:v.hash,current:v.progress?.current,part:v.progress?.part});
const feedbackKey = v => `${v.feedback?.state}:${v.feedback?.text || ''}`;
const stamp = v => JSON.stringify([expectedPage(v),v.progress?.status,{submitPresent:v.controls?.submitPresent||0,continue:v.controls?.continue||0,next:v.controls?.next||0,similar:v.controls?.similar||0},v.incompleteWarning,v.feedback?.state,Boolean(v.feedback?.modal)]);
const error = message => {throw new Error(message);};

// Navigation is deterministic. Only an active, unanswered part invokes the model.
// A checkpoint is saved BEFORE submitting so reopening the panel cannot replay it.
export async function runPilot({request,checkpoint=async()=>{},delay,onEvent=()=>{},limit=0,budget=200,pollLimit=80}) {
  const opened=await request({type:'pilotOpen'});
  const tabId=opened.view.tabId,runId=opened.runId;
  const send=async message=>{await checkpoint();return request({...message,pilotTabId:tabId,pilotRunId:runId});};
  const saved=opened.checkpoint;
  const state=saved?.version===1 && saved.assignment===opened.view.assignment ? saved : {
    version:1,assignment:opened.view.assignment,spent:0,attempts:{},similar:{},completed:[],rejected:{},pending:null,last:null
  };
  const initialCompleted=new Set([...state.completed,...opened.view.progress.questions.filter(q=>q.status==='correct' && q.number!==state.pending?.questionNumber).map(q=>String(q.number))]);
  let view=opened.view;
  const save=()=>send({type:'pilotSave',checkpoint:state});
  const read=()=>send({type:'pilotRead'});
  const stable=async (predicate,waiting='the next step')=>{
    let previous='',lastError;
    await onEvent({kind:'wait',view,waiting});
    for(let n=0;n<pollLimit;n++){
      await delay(300);
      let next;
      try{next=await read();}catch(e){
        if(!/Reload this page|No supported question|Several questions|frame stopped responding/i.test(e.message))throw e;
        lastError=e;continue;
      }
      if(next.assignment!==state.assignment)error('The assignment changed. Start AutoPilot on the new page.');
      const s=stamp(next);
      if(s===previous && predicate(next))return next;
      previous=s;view=next;
    }
    error(lastError?.message || `The page did not show ${waiting}. AutoPilot paused; no action was repeated.`);
  };
  await save();
  view=await stable(()=>true,'the current question');
  await onEvent({kind:'start',view,spent:state.spent,resumed:Boolean(saved)});
  let resumePending=Boolean(saved?.pending);
  for(let steps=0;steps<3000;steps++){
    await checkpoint();
    if(state.pending){
      const p=state.pending;
      const stuck=resumePending && partKey(view)===p.key && view.fields.length>0 && !view.incompleteWarning && !view.feedback?.modal && (view.feedback?.state || 'unknown')==='unknown' && !(view.controls.continue>0) && !(view.controls.similar>0);
      resumePending=false;
      if(stuck){state.pending=null;await save();}
      else {
      view=await stable(v=>v.incompleteWarning || v.feedback?.modal ||
        (v.feedback?.state!=='unknown' && feedbackKey(v)!==p.before) ||
        partKey(v)!==p.key || v.controls.continue>0 || v.controls.similar>0 ||
        (['correct','incorrect','partial'].includes(v.progress.status) && v.progress.status!==p.status),
        'answer feedback after Check answer');
      if(view.incompleteWarning){
        await send({type:'pilotAction',action:{kind:'stay'},expected:expectedPage(view)});
        view=await stable(v=>!v.incompleteWarning);continue;
      }
      const outcome=view.feedback?.state || 'unknown';
      if(outcome==='incorrect' && partKey(view)===p.key){
        state.rejected[p.key]=[...(state.rejected[p.key] || []),{actions:p.actions,feedback:view.feedback.text.slice(0,2000)}].slice(-3);
      }
      state.last={key:p.key,state:outcome,text:view.feedback?.text || ''};
      state.pending=null;await save();
      await onEvent({kind:'feedback',view,outcome});
      }
    }
    const action=decidePlayer(view);
    if(action.kind==='solve' && state.last?.state==='correct' && state.last.key===partKey(view)){
      view=await stable(v=>partKey(v)!==state.last.key || decidePlayer(v).kind!=='solve');continue;
    }
    if(action.kind==='pause'){
      if(/score|question list/i.test(action.reason || '')){
        view=await stable(v=>decidePlayer(v).kind!=='pause','an updated score');continue;
      }
      error(action.reason || 'AutoPilot paused. This page has no supported answer field or Continue/Similar control.');
    }
    if(['question','next','done'].includes(action.kind)){
      const id=String(view.progress.current || partKey(view));
      if(!state.completed.includes(id)){state.completed.push(id);await save();await onEvent({kind:'complete',view});}
      const completed=state.completed.filter(q=>!initialCompleted.has(q)).length;
      if(action.kind==='done' || (limit>0 && completed>=limit)){
        await onEvent({kind:'done',view,completed,all:action.kind==='done',spent:state.spent});return state;
      }
    }
    if(action.kind==='solve'){
      if(state.spent>=budget)error(`AI request budget reached (${state.spent}/${budget}). Increase the budget to continue.`);
      const key=partKey(view),attempts=state.attempts[key] || 0;
      if(attempts>=3)error('Three attempts on this part were unsuccessful. Review it before continuing.');
      state.attempts[key]=attempts+1;state.spent++;await save();
      const started=Date.now();
      await onEvent({kind:'solve',view,spent:state.spent});
      const result=await send({type:'solve',mode:'autopilot',expected:expectedPage(view),retryContext:state.rejected[key] || []});
      await checkpoint();
      await onEvent({kind:'answer',view,result});
      if(!result.solution.supported || result.solution.confidence<.85 || !result.solution.actions.length)
        error(result.solution.limitation || 'This answer needs a manual step. AutoPilot paused.');
      // The UI implements the selected pace and Pause without blocking page checks.
      await onEvent({kind:'pace',view,started});
      await checkpoint();
      const fresh=await read();
      if(JSON.stringify(expectedPage(fresh))!==JSON.stringify(expectedPage(view)))error('The question changed while solving. Resume from the current page.');
      state.pending={key,questionNumber:view.progress.current,actions:result.solution.actions,before:feedbackKey(view),status:view.progress.status};
      await save();
      await onEvent({kind:'submit',view});
      try {
        const applied=await send({type:'apply',planId:result.planId});
        if(!applied?.submitted)error('Submission was not confirmed. Resume to check page feedback.');
      } catch(e) {
        if(e.submission==='not_sent'){
          state.pending=null;
          state.attempts[key]=attempts;
          await save();
        }
        await onEvent({kind:e.submission==='not_sent'?'notSubmitted':'submissionUnknown',view});
        throw e;
      }
      await onEvent({kind:'submitted',view});
      continue;
    }
    if(action.kind==='similar'){
      const key=String(view.progress.current || view.url);
      const count=state.similar[key] || 0;
      if(count>=5)error('Five similar-question retries did not produce full credit. Review this question before continuing.');
      state.similar[key]=count+1;await save();
    }
    await onEvent({kind:action.kind,view,number:action.number});
    const old=view;
    await send({type:'pilotAction',action,expected:expectedPage(view)});
    view=await stable(v=>{
      if(v.incompleteWarning)return action.kind!=='stay';
      if(action.kind==='stay')return !v.incompleteWarning;
      if(action.kind==='dismiss')return !v.feedback?.modal;
      if(action.kind==='question')return v.progress.current===action.number;
      if(action.kind==='next')return partKey(v)!==partKey(old);
      if(action.kind==='continue')return partKey(v)!==partKey(old) || (!v.controls.continue && v.fields.length>0);
      if(action.kind==='similar')return !v.controls.similar && v.fields.length>0;
      return false;
    });
  }
  error('AutoPilot reached its step limit. Review the current page before resuming.');
}

// Repeats Fill answers: fill this question, press Check answer or the red Next
// button, and continue until the last question is filled. Never clicks assignment Submit.
// After Check answer: read Pearson's verdict, close its popup, retry a wrong
// answer once with that feedback, then Continue to the next part or press Next.
export async function runFillAssignment({request, checkpoint=async()=>{}, delay, onEvent=()=>{}, limit=0, budget=200, pace=async()=>{}, retries=1}) {
  let completed=0, spent=0, retryContext=null, attempts=0;
  const finish=async all=>{await onEvent({kind:'done', completed, all, spent});return {completed, spent};};
  const answerBoxes=async()=>{
    await request({type:'prepareField'});
    try{return await request({type:'inspect'});}
    catch(error){if(/no supported question/i.test(error.message || ''))return null;throw error;}
  };
  for(let step=0; step<500; step++){
    await checkpoint();
    if(limit>0 && completed>=limit)return finish(false);
    if(spent>=budget)throw new Error(`AI request budget reached (${spent}/${budget}). Increase the budget to continue.`);
    const page=await answerBoxes();
    if(!page?.question?.fields?.length){
      if(completed>0)return finish(true);
      throw new Error('No answer boxes were found on this question. AutoPilot stopped before using an AI request.');
    }
    await onEvent({kind:'solve', spent:spent+1, retry:Boolean(retryContext)});
    const result=await request({type:'solve', mode:'field', ...(retryContext?{retryContext}:{})});
    spent++;
    await onEvent({kind:'answer', result, spent});
    if(!result.solution?.supported || result.solution.confidence<.85 || !result.solution.actions?.length)
      throw new Error(result.solution?.limitation || 'This answer needs a manual step. AutoPilot paused.');
    await pace(result);
    await checkpoint();
    const applied=await request({type:'apply', planId:result.planId, stopAtEnd:true});
    let verdict='';
    if(applied.advanced==='check'){
      const checked=await request({type:'checkResult'});
      verdict=checked?.verdict || 'unknown';
      if(verdict==='incorrect' && attempts<retries){
        const again=await answerBoxes();
        if(again?.question?.fields?.length){
          attempts++;
          retryContext=[{actions:result.solution.actions, feedback:checked.text || 'Pearson marked this answer incorrect.'}];
          await onEvent({kind:'retry', result, applied, verdict, spent});
          continue;
        }
      }
    }
    attempts=0;retryContext=null;
    completed++;
    await onEvent({kind:'filled', result, applied, verdict, completed, spent});
    if(applied.advanced!=='next' && applied.advanced!=='check')return finish(true);
    const previous=result.question?.hash;
    if(applied.advanced==='check'){
      const step=await request({type:'advanceQuestion'});
      if(step?.moved==='none'){
        const now=await answerBoxes();
        if(now?.question?.fields?.length && now.question.hash!==previous)continue;
        return finish(true);
      }
    }
    await onEvent({kind:'next', completed, spent});
    let moved=false;
    for(let watch=0; watch<40 && !moved; watch++){
      await delay(250);
      const info=await request({type:'inspect'}).catch(()=>null);
      moved=Boolean(info?.question?.hash && info.question.hash!==previous);
    }
    if(!moved)throw new Error('The answer was checked, but Pearson did not move to the next question. Press Next, then resume AutoPilot.');
  }
  throw new Error('AutoPilot reached its step limit. Review the current page before resuming.');
}
