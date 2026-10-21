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
test('equivalent spacing and plain numbers still count as agreement',async()=>{
  let n=0;
  const result=await verifiedSolve(async()=>({...solution,actions:[{...action,value:n++?'2.0':'2 '}]}),{},'autopilot');
  assert.equal(result.supported,true);
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
test('a figure pattern disagreement names the picture instead of a generic review',async()=>{
  let n=0;
  const result=await verifiedSolve(async()=>({...solution,actions:[{...action,value:n++?'triangle':'square'}]}),{question:'Study the list of figures below. Use the pattern to draw the next figure in the list.'},'autopilot');
  assert.equal(result.supported,false);
  assert.match(result.limitation,/figure pattern/);
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
