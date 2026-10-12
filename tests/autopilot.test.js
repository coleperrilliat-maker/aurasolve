import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedSolve} from '../server/verification.js';
const action={target:'a1',kind:'text',value:'12',x:null,y:null,destination:''};
const solution={supported:true,confidence:.98,actions:[action],explanation:'Checked.',answer:'12'};
test('disagreement removes all automatic actions',async()=>{
  let n=0;
  const result=await verifiedSolve(async()=>({...solution,actions:[{...action,value:++n===1?'12':'38/7'}]}),{},'autopilot');
  assert.equal(result.supported,false);assert.deepEqual(result.actions,[]);
});
test('independent matching actions can proceed',async()=>{
  const result=await verifiedSolve(async()=>structuredClone(solution),{},'autopilot');
  assert.equal(result.supported,true);assert.equal(result.actions[0].value,'12');
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
test('diagrams, ambiguous prompts, and retries retain two independent solves',async()=>{
 for(const extra of [{visual:true},{retryContext:[{actions:[],feedback:'Check again'}]},{question:'What is the width? 12'}]){
  let calls=0;await verifiedSolve(async()=>{calls++;return solution;},{question:'Compute 3*4',fields:[{id:'a1',kind:'text'}],...extra},'autopilot');assert.equal(calls,2);
 }
});
test('a repeated rejected action is blocked before paying for a second check',async()=>{
 let calls=0;const result=await verifiedSolve(async()=>{calls++;return solution;},{retryContext:[{actions:solution.actions,feedback:'Wrong'}]},'autopilot');
 assert.equal(calls,1);assert.equal(result.supported,false);assert.deepEqual(result.actions,[]);
});
