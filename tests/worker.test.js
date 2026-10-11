import test from 'node:test';
import assert from 'node:assert/strict';
let listener, applied=0;
const local={settings:{model:'test-model'}},session={};
const storage=data=>({setAccessLevel:async()=>{},get:async key=>({[key]:data[key]}),set:async values=>Object.assign(data,values),remove:async key=>delete data[key]});
const state={url:'https://example.com/practice',context:'Ungraded practice',question:'3x+7=22',fields:[{id:'a1',kind:'text'}],dropTargets:[],selected:'a1',hash:'q1',limitations:[]};
globalThis.chrome={storage:{local:storage(local),session:storage(session)},runtime:{id:'unit-test',onMessage:{addListener:fn=>listener=fn},openOptionsPage:async()=>{}},action:{onClicked:{addListener:()=>{}}},tabs:{onRemoved:{addListener:()=>{}}},scripting:{executeScript:async input=>{
  if(!input.args)return [{frameId:0,documentId:'doc1',result:{...state}}];
  if(input.args[0]==='execute'){applied++;return [{result:{filled:1,submitted:input.args[1].submit}}];}
  if(input.args[0]==='feedback')return [{result:{state:'unknown',text:''}}];
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
  assert.equal((await request({type:'consent',agree:true,signature:'Student'})).ok,true);
  result=await request({type:'solve',mode:'field'});assert.equal(result.ok,true);const planId=result.data.planId;
  assert.equal((await request({type:'apply',planId})).ok,true);assert.equal(applied,1);
  assert.equal((await request({type:'apply',planId})).ok,false);assert.equal(applied,1);
  const next=await request({type:'solve',mode:'field'});assert.equal(next.ok,true);
  await request({type:'stop'});
  assert.equal((await request({type:'apply',planId:next.data.planId})).ok,false);assert.equal(applied,1);
  assert.equal(session['grant:1'],undefined);
});
test('worker rechecks practice status between answer generation and application',async()=>{
  await request({type:'consent',agree:true,signature:'Student'});
  const result=await request({type:'solve',mode:'autopilot'});assert.equal(result.ok,true);
  state.context='Practice graded assessment';
  const appliedResult=await request({type:'apply',planId:result.data.planId});assert.equal(appliedResult.ok,false);assert.match(appliedResult.error,/indicator/);assert.equal(applied,1);
  state.context='Ungraded practice';
});
test('worker rejects changed question snapshots',async()=>{
  const result=await request({type:'solve',mode:'field'});assert.equal(result.ok,true);state.hash='q2';
  const answer=await request({type:'apply',planId:result.data.planId});assert.equal(answer.ok,false);assert.match(answer.error,/question changed/);assert.equal(applied,1);state.hash='q1';
});
