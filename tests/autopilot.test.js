import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedSolve} from '../server/verification.js';
const action={target:'a1',kind:'text',value:'12',x:null,y:null,destination:''};
const solution={supported:true,confidence:.98,actions:[action],explanation:'Checked.',answer:'12'};
test('a covered congruence question is filled even when the model says a blank was missed',async()=>{
  const fields=[
    {id:'r1',kind:'radio',group:'why'},{id:'r2',kind:'radio',group:'why'},
    {id:'t1',kind:'text'},
    {id:'c1',kind:'checkbox'},{id:'c2',kind:'checkbox'}
  ];
  const actions=[
    {target:'r1',kind:'radio',value:'A',x:null,y:null,destination:''},
    {target:'t1',kind:'text',value:'YXZ',x:null,y:null,destination:''},
    {target:'c1',kind:'checkbox',value:'true',x:null,y:null,destination:''},
    {target:'c2',kind:'checkbox',value:'false',x:null,y:null,destination:''}
  ];
  const refused={supported:false,confidence:.4,actions,explanation:'The triangles match.',answer:'A\nYXZ',limitation:'The answer did not cover every active blank. Nothing was filled.'};
  const result=await verifiedSolve(async()=>structuredClone(refused),{fields},'autopilot');
  assert.equal(result.supported,true);
  assert.equal(result.limitation,'');
  assert.equal(result.actions.length,4);
});
test('an incomplete checkbox list is not treated as a finished answer',async()=>{
  const fields=[{id:'c1',kind:'checkbox'},{id:'c2',kind:'checkbox'}];
  const result=await verifiedSolve(async()=>({supported:false,confidence:.4,actions:[{target:'c1',kind:'checkbox',value:'true',x:null,y:null,destination:''}],explanation:'Only one box.',answer:'A',limitation:'The answer did not cover every active blank. Nothing was filled.'}),{fields},'field');
  assert.equal(result.supported,false);
  assert.equal(result.actions.length,1);
});
test('every question costs exactly one model call',async()=>{
  for(const extra of [{},{visual:true},{imageBased:true},{retryContext:[{actions:[],feedback:'Check again'}]},{question:'What is the width? 12'}]){
    let calls=0;
    const result=await verifiedSolve(async()=>{calls++;return structuredClone(solution);},{fields:[{id:'a1',kind:'text'}],...extra},'autopilot');
    assert.equal(calls,1);assert.equal(result.supported,true);assert.equal(result.actions[0].value,'12');
  }
});
test('an image choice is filled from the screenshot without a second disagreeing read',async()=>{
  let calls=0;
  const radio={...solution,actions:[{target:'b',kind:'radio',value:'true',x:null,y:null,destination:''}]};
  const result=await verifiedSolve(async()=>{calls++;return structuredClone(radio);},{imageBased:true,question:'Study the list of figures below.',fields:[{id:'b',kind:'radio'}]},'autopilot');
  assert.equal(calls,1);assert.equal(result.supported,true);assert.equal(result.actions[0].target,'b');
});
test('closed dropdowns are solved once from the supplied choices',async()=>{
  let calls=0;
  const pick={...solution,actions:[{target:'a1',kind:'select',value:'FL1-0',x:null,y:null,destination:''}]};
  const snapshot={visual:true,question:'Complete the proof.',fields:[{id:'a1',kind:'select',options:[{value:'FL1-0',label:'Given'}]}]};
  const result=await verifiedSolve(async()=>{calls++;return structuredClone(pick);},snapshot,'field');
  assert.equal(calls,1);assert.equal(result.supported,true);assert.equal(result.actions[0].value,'FL1-0');
});
test('strict arithmetic uses one model call with a local independent check',async()=>{
 let calls=0;const s={...solution,actions:[{...action,value:'-2'}]};
 const result=await verifiedSolve(async()=>{calls++;return s;},{question:'Evaluate: -2^2 + 2',fields:[{id:'a1',kind:'text'}]},'autopilot');
 assert.equal(calls,1);assert.equal(result.supported,true);
});
test('wrong arithmetic answer is blocked by the local check',async()=>{
 const result=await verifiedSolve(async()=>solution,{question:'Compute 2 * (3 + 4)',fields:[{id:'a1',kind:'text'}]},'autopilot');
 assert.equal(result.supported,false);assert.deepEqual(result.actions,[]);
});
test('a repeated rejected action is blocked',async()=>{
 let calls=0;const result=await verifiedSolve(async()=>{calls++;return solution;},{retryContext:[{actions:solution.actions,feedback:'Wrong'}]},'autopilot');
 assert.equal(calls,1);assert.equal(result.supported,false);assert.deepEqual(result.actions,[]);
});
