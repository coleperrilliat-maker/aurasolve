import test from 'node:test';
import assert from 'node:assert/strict';
let captureFails=false, captured=0, solveCalls=0, lastSnapshot;
let listener, applied=0, nextButton=true, split=false, clickedDocument=null, verdict='unknown', staleAfterFill=false, enableOnFill=false;
const local={settings:{model:'test-model'}},session={};
const storage=data=>({setAccessLevel:async()=>{},get:async key=>({[key]:data[key]}),set:async values=>Object.assign(data,values),remove:async key=>delete data[key]});
const state={url:'https://example.com/practice',context:'Ungraded practice',question:'3x+7=22',fields:[{id:'a1',kind:'text'}],dropTargets:[],selected:'a1',hash:'q1',limitations:[],controls:{submit:1,next:1}};
globalThis.chrome={storage:{local:storage(local),session:storage(session)},runtime:{id:'unit-test',onMessage:{addListener:fn=>listener=fn}},tabs:{get:async()=>({windowId:1,active:true}),captureVisibleTab:async()=>{if(captureFails)throw new Error('capture failed');captured++;return 'data:image/png;base64,fixture';},onRemoved:{addListener:()=>{}},query:async()=>[{id:1}]},scripting:{executeScript:async input=>{
  if(typeof input.args?.[0]==='boolean')return [];
  if(input.world==='MAIN')return [{result:true}];
  const wrapped=data=>[{result:{ok:true,data}}];
  if(input.args?.[0]==='dismissFeedback'){verdict='unknown';return wrapped({clicked:true});}
  if(input.args?.[0]==='clickControl'){clickedDocument=input.target.documentIds[0];return wrapped({clicked:true});}
  if(!input.args)return split ? [{frameId:0,documentId:'doc1',result:{...state,question:'',fields:[],selected:null,controls:{submit:1,next:1}}},{frameId:2,documentId:'question-frame',result:{...state,controls:{submit:0,next:0}}}] : [{frameId:0,documentId:'doc1',result:{...state}}];
  if(input.args[0]==='execute'){applied++;if(enableOnFill)state.controls.submit=1;if(staleAfterFill)state.hash='changed-after-fill';return wrapped({filled:1,submitted:input.args[1].submit && !input.args[1].deferSubmit});}
  if(input.args[0]==='feedback')return wrapped({state:input.target.documentIds[0]==='doc1'?verdict:'unknown',text:''});
  if(input.args[0]==='nextProblem')return wrapped({clicked:nextButton});
  throw new Error('Unexpected frame call');
}}};
const solution={answer:'5',explanation:'Subtract 7, divide by 3.',confidence:.99,supported:true,limitation:'',actions:[{kind:'text',target:'a1',value:'5',destination:'',x:null,y:null}]};
globalThis.createImageBitmap=async()=>({width:1800,height:1000});
globalThis.OffscreenCanvas=class {constructor(w,h){this.width=w;this.height=h;}getContext(){return {drawImage(){}};}async convertToBlob(){return new Blob(['fixture']);}};
globalThis.fetch=async (url,options)=>{
  if(String(url).startsWith('data:'))return {blob:async()=>new Blob(['fixture'])};

  if(String(url).includes('/health'))return{ok:true,json:async()=>({ok:true,keyConfigured:true,model:'test-model'})};
  solveCalls++;lastSnapshot=JSON.parse(options.body).snapshot;
  return{ok:true,json:async()=>({solution})};
};
await import('../src/background/worker.js');
const request=message=>new Promise(resolve=>listener(message,{id:'unit-test',tab:{id:1},frameId:0},resolve));
test('worker enforces consent, applies once, and invalidates on stop',async()=>{
  let result=await request({type:'solve',mode:'autopilot'});assert.equal(result.ok,false);assert.match(result.error,/sign/);
  assert.equal((await request({type:'inspect'})).data.signed,false);
  assert.equal((await request({type:'consent',statement:'yes',signature:'Student'})).ok,false);
  assert.equal((await request({type:'consent',statement:'This is not a graded homework assignment',signature:''})).ok,false);
  assert.equal((await request({type:'consent',statement:'This is not a graded homework assignment',signature:'Student'})).ok,true);
  assert.equal((await request({type:'inspect'})).data.signed,true);
  result=await request({type:'solve',mode:'field'});assert.equal(result.ok,true);const planId=result.data.planId;
  assert.equal((await request({type:'apply',planId})).ok,true);assert.equal(applied,1);
  assert.equal((await request({type:'apply',planId})).ok,false);assert.equal(applied,1);
  const next=await request({type:'solve',mode:'field'});assert.equal(next.ok,true);
  await request({type:'stop'});
  assert.equal((await request({type:'apply',planId:next.data.planId})).ok,false);assert.equal(applied,1);
  assert.equal(session['grant:1'],undefined);
});
test('page wording no longer blocks a signed AutoPilot run',async()=>{
  state.context='Homework quiz graded';
  await request({type:'consent',statement:'This is not a graded homework assignment',signature:'Student'});
  const result=await request({type:'solve',mode:'autopilot'});assert.equal(result.ok,true);
  assert.equal((await request({type:'apply',planId:result.data.planId})).ok,true);assert.equal(applied,2);
  state.context='Ungraded practice';
});
test('worker rejects changed question snapshots',async()=>{
  const result=await request({type:'solve',mode:'field'});assert.equal(result.ok,true);state.hash='q2';
  const answer=await request({type:'apply',planId:result.data.planId});assert.equal(answer.ok,false);assert.match(answer.error,/question changed/);assert.equal(applied,2);state.hash='q1';
});
test('next problem clicks the page Next button without a signature and reports the old question',async()=>{
  await request({type:'stop'});
  let result=await request({type:'nextProblem'});assert.equal(result.ok,true);assert.deepEqual(result.data,{clicked:true,hash:'q1'});
  nextButton=false;
  result=await request({type:'nextProblem'});assert.equal(result.ok,true);assert.equal(result.data.clicked,false);
  nextButton=true;
});
test('a reviewed field answer can be explicitly submitted once',async()=>{
  await request({type:'consent',statement:'This is not a graded homework assignment',signature:'Student'});
  const before=applied;
  const result=await request({type:'solve',mode:'field'});assert.equal(result.ok,true);
  assert.equal((await request({type:'apply',planId:result.data.planId})).data.submitted,false);
  assert.equal((await request({type:'submitField',planId:result.data.planId})).data.submitted,true);
  assert.equal(applied,before+2);
  assert.equal((await request({type:'submitField',planId:result.data.planId})).ok,false);
});
test('AutoPilot fills a child frame and submits and reads feedback in the parent',async()=>{
  split=true;clickedDocument=null;
  try {
    const result=await request({type:'solve',mode:'autopilot'});assert.equal(result.ok,true);
    assert.equal((await request({type:'apply',planId:result.data.planId})).data.submitted,true);
    assert.equal(clickedDocument,'doc1');
    verdict='correct';
    assert.equal((await request({type:'feedback',planId:result.data.planId})).data.state,'correct');
    assert.equal((await request({type:'next',planId:result.data.planId})).ok,true);
  } finally {split=false;verdict='unknown';}
});
test('changed question after filling prevents submit',async()=>{
  clickedDocument=null;staleAfterFill=true;
  try {
    const result=await request({type:'solve',mode:'autopilot'});
    const appliedResult=await request({type:'apply',planId:result.data.planId});
    assert.equal(appliedResult.ok,false);assert.match(appliedResult.error,/changed/);assert.equal(clickedDocument,null);
  } finally {staleAfterFill=false;state.hash='q1';}
});
test('an unsolicited editor mutation is rejected',async()=>{
  const result=await request({type:'writeEditor',planId:'made-up',target:'a1'});
  assert.equal(result.ok,false);assert.match(result.error,/no longer active/);
});
test('missing answer controls still return tutoring instead of a click-first error',async()=>{
  const fields=state.fields, selected=state.selected;
  state.fields=[];state.selected=null;
  try {
    const result=await request({type:'solve',mode:'field'});
    assert.equal(result.ok,true);
    assert.ok(result.data.solution.explanation);
    assert.equal(result.data.solution.supported,false);
    assert.deepEqual(result.data.solution.actions,[]);
    assert.match(result.data.solution.limitation,/could not detect/);
  } finally {state.fields=fields;state.selected=selected;}
});


test('Fill solves and applies without any signature',async()=>{
  await request({type:'stop'});
  assert.equal(session['grant:1'],undefined);
  const result=await request({type:'solve',mode:'field'});
  assert.equal(result.ok,true);
  const filled=await request({type:'apply',planId:result.data.planId});
  assert.equal(filled.ok,true);
  assert.equal(filled.data.submitted,false);
  assert.equal(session['grant:1'],undefined);
});
test('a visual question never silently falls back to text when capture fails',async()=>{
  state.visual=true;captureFails=true;
  try {
    const result=await request({type:'solve',mode:'field'});
    assert.equal(result.ok,false);
    assert.match(result.error,/Could not capture the question image/);
  } finally {state.visual=false;captureFails=false;}
});

test('text-only questions do not capture or send screenshots',async()=>{
  state.visual=false;
  const before=solveCalls, shots=captured;
  const result=await request({type:'solve',mode:'field'});
  assert.equal(result.ok,true);
  assert.equal(solveCalls,before+1);assert.equal(captured,shots);
  assert.equal(lastSnapshot.image,undefined);
});
test('visual questions include a screenshot in the same single solve call',async()=>{
  state.visual=true;
  const before=solveCalls,shots=captured;
  try {
    const result=await request({type:'solve',mode:'field'});
    assert.equal(result.ok,true);
    assert.equal(solveCalls,before+1);assert.equal(captured,shots+1);
    assert.match(lastSnapshot.image,/^data:image\/jpeg;base64,/);
  }finally{state.visual=false;}
});

test('AutoPilot fills before resolving a submit button disabled until input',async()=>{
 await request({type:'consent',statement:'This is not a graded homework assignment',signature:'Student'});
 state.controls.submit=0;enableOnFill=true;clickedDocument=null;
 try{
  const result=await request({type:'solve',mode:'autopilot'});
  const response=await request({type:'apply',planId:result.data.planId});
  assert.equal(response.ok,true);assert.equal(response.data.submitted,true);
  assert.equal(clickedDocument,'doc1');
 }finally{enableOnFill=false;state.controls.submit=1;}
});

test('correct popup acknowledgement preserves permission to advance',async()=>{
 await request({type:'consent',statement:'This is not a graded homework assignment',signature:'Student'});
 const result=await request({type:'solve',mode:'autopilot'}),planId=result.data.planId;
 await request({type:'apply',planId});verdict='correct';
 assert.equal((await request({type:'acknowledge',planId})).ok,true);
 assert.equal(verdict,'unknown');
 assert.equal((await request({type:'next',planId})).ok,true);
});
test('incorrect feedback permits similar question but not Next',async()=>{
 const result=await request({type:'solve',mode:'autopilot'}),planId=result.data.planId;
 await request({type:'apply',planId});verdict='incorrect';
 assert.equal((await request({type:'acknowledge',planId})).ok,true);
 assert.equal((await request({type:'next',planId})).ok,false);
 state.controls.similar=1;
 try{assert.equal((await request({type:'similar',planId})).ok,true);}
 finally{delete state.controls.similar;verdict='unknown';}
});
test('feedback in an intermediate frame is found and its OK is clicked',async()=>{
 const original=chrome.scripting.executeScript;
 let middleVerdict='unknown',dismissed=false;
 chrome.scripting.executeScript=async input=>{
  if(!input.args){
   const frames=await original(input);
   return [...frames,{frameId:1,documentId:'middle',result:{...state,question:'',fields:[],selected:null,controls:{}}}];
  }
  if(input.args[0]==='feedback' && input.target.documentIds[0]==='middle')
   return [{result:{ok:true,data:{state:middleVerdict,text:'Fantastic!'}}}];
  if(input.args[0]==='dismissFeedback'){
   if(input.target.documentIds[0]==='middle'){dismissed=true;middleVerdict='unknown';return [{result:{ok:true,data:{clicked:true}}}];}
   return [{result:{ok:true,data:{clicked:false}}}];
  }
  return original(input);
 };
 try {
  await request({type:'consent',statement:'This is not a graded homework assignment',signature:'Student'});
  const answer=await request({type:'solve',mode:'autopilot'}),planId=answer.data.planId;
  assert.equal((await request({type:'apply',planId})).ok,true);
  middleVerdict='correct';
  assert.equal((await request({type:'feedback',planId})).data.state,'correct');
  assert.equal((await request({type:'acknowledge',planId})).ok,true);
  assert.equal(dismissed,true);
  assert.equal((await request({type:'continuation',planId})).data.controls.submit,1);
 }finally{chrome.scripting.executeScript=original;}
});

const panelRequest=message=>new Promise(resolve=>listener(message,{id:'unit-test'},resolve));
test('AutoPilot pins its tab, rejects stale navigation, and rejects replaced runs',async()=>{
 const originalGet=chrome.tabs.get;
 chrome.tabs.get=async id=>({id,windowId:1,active:true});
 state.player={progress:{current:21,part:3,totalParts:3,status:'partial',questions:[{number:21,status:'partial'}]},controls:{submit:1,submitPresent:1,next:1},incompleteWarning:false};
 try{
  await request({type:'consent',statement:'This is not a graded homework assignment',signature:'Student'});
  const opened=await panelRequest({type:'pilotOpen'});assert.equal(opened.ok,true);
  const run=opened.data,base={pilotTabId:1,pilotRunId:run.runId};
  assert.equal(run.view.progress.current,21);assert.equal(run.view.controls.submitPresent,1);
  const {expectedPage}=await import('../src/shared/pilot-engine.js');
  const wrong=await panelRequest({...base,type:'pilotAction',expected:expectedPage(run.view),action:{kind:'next'}});
  assert.equal(wrong.ok,false);assert.match(wrong.error,/no longer ready/);
  const stale=await panelRequest({...base,type:'solve',mode:'autopilot',expected:{...expectedPage(run.view),hash:'stale'}});
  assert.equal(stale.ok,false);assert.match(stale.error,/question changed/);
  chrome.tabs.get=async id=>({id,windowId:1,active:false});
  assert.match((await panelRequest({...base,type:'pilotRead'})).error,/Return to/);
  chrome.tabs.get=async id=>({id,windowId:1,active:true});
  await panelRequest({type:'pilotOpen',pilotTabId:1});
  assert.match((await panelRequest({...base,type:'pilotRead'})).error,/replaced or stopped/);
 }finally{chrome.tabs.get=originalGet;delete state.player;}
});
