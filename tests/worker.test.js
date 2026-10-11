import test from 'node:test';
import assert from 'node:assert/strict';
let listener, applied=0, nextButton=true;
const local={settings:{model:'test-model'}},session={};
const storage=data=>({setAccessLevel:async()=>{},get:async key=>({[key]:data[key]}),set:async values=>Object.assign(data,values),remove:async key=>delete data[key]});
const state={url:'https://example.com/practice',context:'Ungraded practice',question:'3x+7=22',fields:[{id:'a1',kind:'text'}],dropTargets:[],selected:'a1',hash:'q1',limitations:[]};
globalThis.chrome={storage:{local:storage(local),session:storage(session)},runtime:{id:'unit-test',onMessage:{addListener:fn=>listener=fn}},tabs:{onRemoved:{addListener:()=>{}},query:async()=>[{id:1}]},scripting:{executeScript:async input=>{
  if(!input.args)return [{frameId:0,documentId:'doc1',result:{...state}}];
  if(input.args[0]==='execute'){applied++;return [{result:{filled:1,submitted:input.args[1].submit}}];}
  if(input.args[0]==='feedback')return [{result:{state:'unknown',text:''}}];
  if(input.args[0]==='nextProblem')return [{result:{clicked:nextButton}}];
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
  let result=await request({type:'solve',mode:'field'});assert.equal(result.ok,false);assert.match(result.error,/sign/);
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
