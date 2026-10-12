import {decidePlayer} from './player-state.js';

export const partKey = v => `${v.progress?.current || v.url}|${v.progress?.part || 1}|${v.promptHash || v.hash}`;
export const expectedPage = v => ({assignment:v.assignment,documentId:v.documentId,hash:v.hash,current:v.progress?.current,part:v.progress?.part});
const feedbackKey = v => `${v.feedback?.state}:${v.feedback?.text || ''}`;
const stamp = v => JSON.stringify([expectedPage(v),v.progress?.status,v.controls,v.incompleteWarning,v.feedback]);
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
  const stable=async predicate=>{
    let previous='',lastError;
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
    error(lastError?.message || 'The page did not reach the expected next step. AutoPilot paused; no action was repeated.');
  };
  await save();
  view=await stable(()=>true);
  await onEvent({kind:'start',view,spent:state.spent,resumed:Boolean(saved)});
  for(let steps=0;steps<3000;steps++){
    await checkpoint();
    if(state.pending){
      const p=state.pending;
      view=await stable(v=>v.incompleteWarning || (v.feedback?.modal && v.feedback.state!=='unknown') ||
        (v.feedback?.state!=='unknown' && feedbackKey(v)!==p.before) ||
        partKey(v)!==p.key || v.controls.continue>0 || v.controls.similar>0 || v.progress.status==='correct');
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
    const action=decidePlayer(view);
    if(action.kind==='solve' && state.last?.state==='correct' && state.last.key===partKey(view)){
      view=await stable(v=>partKey(v)!==state.last.key || decidePlayer(v).kind!=='solve');continue;
    }
    if(action.kind==='pause'){
      view=await stable(v=>decidePlayer(v).kind!=='pause');continue;
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
      state.pending={key,questionNumber:view.progress.current,actions:result.solution.actions,before:feedbackKey(view)};
      await save();
      await onEvent({kind:'submit',view});
      await send({type:'apply',planId:result.planId});
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
