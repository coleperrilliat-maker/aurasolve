import test from 'node:test';
import assert from 'node:assert/strict';
let listener, applied=0, nextButton=true, split=false, clickedDocument=null, verdict='unknown', staleAfterFill=false;
const local={settings:{model:'test-model'}},session={};
const storage=data=>({setAccessLevel:async()=>{},get:async key=>({[key]:data[key]}),set:async values=>Object.assign(data,values),remove:async key=>delete data[key]});
const state={url:'https://example.com/practice',context:'Ungraded practice',question:'3x+7=22',fields:[{id:'a1',kind:'text'}],dropTargets:[],selected:'a1',hash:'q1',limitations:[],controls:{submit:1,next:1}};
globalThis.chrome={storage:{local:storage(local),session:storage(session)},runtime:{id:'unit-test',onMessage:{addListener:fn=>listener=fn}},tabs:{onRemoved:{addListener:()=>{}},query:async()=>[{id:1}]},scripting:{executeScript:async input=>{
  if(input.world==='MAIN')return [{result:true}];
  const wrapped=data=>[{result:{ok:true,data}}];
  if(input.args?.[0]==='clickControl'){clickedDocument=input.target.documentIds[0];return wrapped({clicked:true});}
  if(!input.args)return split ? [{frameId:0,documentId:'doc1',result:{...state,question:'',fields:[],selected:null,controls:{submit:1,next:1}}},{frameId:2,documentId:'question-frame',result:{...state,controls:{submit:0,next:0}}}] : [{frameId:0,documentId:'doc1',result:{...state}}];
  if(input.args[0]==='execute'){applied++;if(staleAfterFill)state.hash='changed-after-fill';return wrapped({filled:1,submitted:input.args[1].submit && !input.args[1].deferSubmit});}
  if(input.args[0]==='feedback')return wrapped({state:input.target.documentIds[0]==='doc1'?verdict:'unknown',text:''});
  if(input.args[0]==='nextProblem')return wrapped({clicked:nextButton});
  throw new Error('Unexpected frame call');
}}};
const solution={answer:'5',explanation:'Subtract 7, divide by 3.',confidence:.99,supported:true,limitation:'',actions:[{kind:'text',target:'a1',value:'5',destination:'',x:null,y:null}]};
globalThis.fetch=async url=>{
  if(String(url).includes('/health'))return{ok:true,json:async()=>({ok:true,keyConfigured:true,model:'test-model'})};
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
  state.visual=true;
  try {
    const result=await request({type:'solve',mode:'field'});
    assert.equal(result.ok,false);
    assert.match(result.error,/Could not capture the question image/);
  } finally {state.visual=false;}
});
