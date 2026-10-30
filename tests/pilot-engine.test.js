import test from 'node:test';
import assert from 'node:assert/strict';
import {runPilot,partKey} from '../src/shared/pilot-engine.js';
const clone=structuredClone;
const base=()=>({tabId:1,assignment:'assignment-1',url:'https://example.com/q',documentId:'doc',hash:'q21p3',promptHash:'p3',fields:[{id:'a1',kind:'text'}],controls:{submitPresent:1,next:1},progress:{current:21,part:3,totalParts:3,status:'partial',questions:[{number:20,status:'correct'},{number:21,status:'partial'},{number:22,status:'unanswered'}]},feedback:{state:'unknown',modal:false}});
function fixture({view=base(),saved=null,apply,action,solve,read}={}){
 const calls=[],events=[];let checkpoint=saved;
 const request=async m=>{
  calls.push(clone(m));
  if(m.type==='pilotOpen')return {runId:'run',view:clone(view),checkpoint:clone(checkpoint)};
  assert.equal(m.pilotTabId,1);assert.equal(m.pilotRunId,'run');
  if(m.type==='pilotSave'){checkpoint=clone(m.checkpoint);return {};}
  if(m.type==='pilotRead'){await read?.(view);return clone(view);}
  if(m.type==='solve')return await solve?.(view) || {planId:'plan',question:clone(view),solution:{supported:true,confidence:.99,actions:[{target:'a1',kind:'text',value:'5'}]}};
  if(m.type==='apply'){assert.ok(checkpoint.pending);await apply?.(view);return {submitted:true};}
  if(m.type==='pilotAction'){await action?.(view,m.action);return {clicked:true};}
  throw new Error('unexpected '+m.type);
 };
 return {view,calls,events,get saved(){return checkpoint;},run:options=>runPilot({request,delay:async()=>{},onEvent:e=>events.push(e),pollLimit:4,...options})};
}
function terminal(v,status='correct'){
 v.feedback={state:status==='correct'?'correct':'incorrect',text:status,modal:true};v.controls={similar:1,next:1};v.fields=[];
 v.progress.status=status;v.progress.questions.find(q=>q.number===v.progress.current).status=status;
}
function nextQuestion(v,number){
 v.progress={...v.progress,current:number,part:1,totalParts:1,status:'unanswered'};
 v.fields=[{id:'a1'}];v.controls={submitPresent:1};v.hash='q'+number;v.promptHash='q'+number;v.feedback={state:'unknown',modal:false};
}
test('a question with answer fields is filled before Check answer is enabled',async()=>{
 const v=base();v.controls={next:1};
 const f=fixture({view:v,apply:terminal,action:(v,a)=>{if(a.kind==='dismiss')v.feedback={state:'unknown',modal:false};}});
 await f.run({limit:1});
 assert.equal(f.calls.filter(m=>m.type==='solve').length,1);
 assert.equal(f.calls.filter(m=>m.type==='apply').length,1);
});
test('resumes Part 3, closes OK, skips correct questions, finishes remaining list',async()=>{
 const f=fixture({apply:terminal,action:(v,a)=>{if(a.kind==='dismiss')v.feedback={state:'unknown',modal:false};if(a.kind==='question')nextQuestion(v,a.number);}});
 await f.run();assert.deepEqual(f.calls.filter(m=>m.type==='solve').map(m=>m.expected.current),[21,22]);
 assert.equal(f.calls.find(m=>m.type==='solve').expected.part,3);
 assert.deepEqual(f.calls.filter(m=>m.type==='pilotAction').map(m=>m.action.kind),['dismiss','question','dismiss']);
 assert.equal(f.events.at(-1).all,true);assert.equal(f.saved.spent,2);
});
test('wrong part continues all steps then Similar until question gets full credit',async()=>{
 const v=base();v.progress.part=1;v.progress.totalParts=2;v.progress.questions=[{number:21,status:'partial'}];let tries=0;
 const f=fixture({view:v,apply:v=>{
   if(v.progress.part===1){v.feedback={state:tries?'correct':'incorrect',text:tries?'correct':'wrong',modal:true};v.fields=[];v.controls={continue:1,next:1};}
   else terminal(v,tries?'correct':'partial');
 },action:(v,a)=>{
  if(a.kind==='dismiss')v.feedback={state:'unknown',modal:false};
  if(a.kind==='continue'){v.progress.part=2;v.fields=[{id:'a1'}];v.controls={submitPresent:1,next:1};v.hash=v.promptHash='part2-'+tries;}
  if(a.kind==='similar'){tries++;v.progress.part=1;v.fields=[{id:'a1'}];v.controls={submitPresent:1};v.hash=v.promptHash='retry-'+tries;}
 }});
 await f.run();assert.equal(tries,1);assert.equal(f.saved.spent,4);
 assert.equal(f.calls.filter(m=>m.type==='pilotAction' && m.action.kind==='continue').length,2);
});
test('incomplete warning clicks No and continues current question',async()=>{
 const v=base();v.incompleteWarning=true;
 const f=fixture({view:v,apply:terminal,action:(v,a)=>{if(a.kind==='stay')v.incompleteWarning=false;if(a.kind==='dismiss')v.feedback={state:'unknown',modal:false};}});
 await f.run({limit:1});assert.equal(f.calls.find(m=>m.type==='pilotAction').action.kind,'stay');
 assert.equal(f.calls.filter(m=>m.type==='solve').length,1);
});
test('resume after a check that did not change the page fills again',async()=>{
 const f=fixture();await assert.rejects(f.run(),/did not show/);
 assert.ok(f.saved.pending);
 const resume=fixture({saved:f.saved,apply:terminal,action:(v,a)=>{if(a.kind==='dismiss')v.feedback={state:'unknown',modal:false};}});
 await resume.run({limit:1});
 assert.equal(resume.calls.filter(m=>m.type==='solve').length,1);
 assert.equal(resume.calls.filter(m=>m.type==='apply').length,1);
});
test('known fill failure clears pending submission and preserves the part attempt',async()=>{
 const f=fixture({apply:()=>{throw Object.assign(new Error('Field did not retain answer'),{submission:'not_sent'});}});
 await assert.rejects(f.run(),/retain/);
 assert.equal(f.saved.pending,null);assert.equal(f.saved.attempts[partKey(base())],0);
 assert.equal(f.saved.spent,1);assert.equal(f.events.at(-1).kind,'notSubmitted');
 assert.equal(f.events.some(e=>e.kind==='submitted'),false);
 const resumed=fixture({saved:f.saved,apply:terminal,action:(v,a)=>{if(a.kind==='dismiss')v.feedback={state:'unknown',modal:false};}});
 await resumed.run({limit:1});assert.equal(resumed.calls.filter(m=>m.type==='apply').length,1);
});
test('lost apply reply retains checkpoint and reports submission unconfirmed',async()=>{
 const f=fixture({apply:()=>{throw new Error('Lost reply');}});
 await assert.rejects(f.run(),/Lost reply/);
 assert.ok(f.saved.pending);assert.equal(f.events.at(-1).kind,'submissionUnknown');
 const resumed=fixture({saved:f.saved,apply:terminal,action:(v,a)=>{if(a.kind==='dismiss')v.feedback={state:'unknown',modal:false};}});
 await resumed.run({limit:1});
 assert.equal(resumed.calls.filter(m=>m.type==='solve').length,1);
});
test('resume after completed submit reads feedback without another solve',async()=>{
 const f=fixture();await assert.rejects(f.run());const v=base();terminal(v);
 const next=fixture({view:v,saved:f.saved,action:(v,a)=>{if(a.kind==='dismiss')v.feedback={state:'unknown',modal:false};}});
 await next.run({limit:1});assert.equal(next.calls.filter(m=>m.type==='apply').length,0);
});
test('rejected answer and feedback are supplied on same-part retry',async()=>{
 let n=0;const f=fixture({apply:v=>{if(++n===1)v.feedback={state:'incorrect',modal:true,text:'Wrong; check the sign.'};else terminal(v);},action:(v,a)=>{if(a.kind==='dismiss')v.feedback={state:'unknown',modal:false};}});
 await f.run({limit:1});const solves=f.calls.filter(m=>m.type==='solve');assert.equal(solves.length,2);assert.match(solves[1].retryContext[0].feedback,/sign/);
});
test('budget is cumulative across resumes and prevents further paid calls',async()=>{
 const f=fixture();await assert.rejects(f.run({budget:0}),/budget reached/);assert.equal(f.calls.filter(m=>m.type==='solve').length,0);
 const v=base(),saved={version:1,assignment:v.assignment,spent:200,attempts:{},similar:{},completed:[],rejected:{},pending:null,last:null};
 const resumed=fixture({saved});await assert.rejects(resumed.run(),/200\/200/);
});
test('Stop during model solve prevents apply',async()=>{
 let stopped=false;const f=fixture({solve:()=>{stopped=true;}});
 await assert.rejects(f.run({checkpoint:async()=>{if(stopped)throw new Error('Stopped.');}}),/Stopped/);
 assert.equal(f.calls.filter(m=>m.type==='apply').length,0);
});
test('page changed while model was solving prevents submit',async()=>{
 const f=fixture({solve:v=>{v.hash='changed';}});await assert.rejects(f.run(),/question changed/);assert.equal(f.calls.filter(m=>m.type==='apply').length,0);
});
test('delayed feedback is polled, without another model call',async()=>{
 let reads=0,submitted=false;
 const f=fixture({apply:()=>{submitted=true;},read:v=>{if(submitted && ++reads===3)terminal(v);},action:(v,a)=>{if(a.kind==='dismiss')v.feedback={state:'unknown',modal:false};}});
 await f.run({limit:1,pollLimit:8});assert.equal(f.saved.spent,1);
});
test('three failed part attempts stop with no unbounded spending',async()=>{
 const f=fixture({apply:v=>{v.feedback={state:'incorrect',modal:true,text:'wrong'};},action:v=>{v.feedback={state:'unknown',modal:false};}});
 await assert.rejects(f.run(),/Three attempts/);assert.equal(f.saved.spent,3);
});
test('five terminal Similar retries stop independently of request budget',async()=>{
 const v=base();terminal(v,'partial');v.feedback={state:'unknown',modal:false};let tries=0;
 const f=fixture({view:v,apply:v=>terminal(v,'partial'),action:(v,a)=>{
  if(a.kind==='dismiss')v.feedback={state:'unknown',modal:false};
  if(a.kind==='similar'){tries++;v.fields=[{id:'a1'}];v.controls={submitPresent:1};v.promptHash=v.hash='retry'+tries;}
 }});
 await assert.rejects(f.run(),/Five similar/);assert.equal(tries,5);assert.equal(f.saved.spent,5);
});
