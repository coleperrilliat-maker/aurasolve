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
