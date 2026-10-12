import test from 'node:test';
import assert from 'node:assert/strict';
import {runAutoPilot} from '../src/shared/autopilot.js';
import {verifiedSolve} from '../server/verification.js';
const action={target:'a1',kind:'text',value:'12',x:null,y:null,destination:''};
const solution={supported:true,confidence:.98,actions:[action],explanation:'Checked.',answer:'12'};
test('AutoPilot fills, submits, waits for feedback, and waits for stable next prompt',async()=>{
  const calls=[];let q=1,polls=0,inspects=0;
  await runAutoPilot({limit:2,status:()=>{},result:()=>{},live:()=>{},sleep:async()=>{},request:async m=>{
    calls.push(m.type);
    if(m.type==='solve')return {planId:String(q),solution,question:{promptHash:'q'+q}};
    if(m.type==='feedback')return {state:++polls%2?'unknown':'correct'};
    if(m.type==='next'){q++;return {};}
    if(m.type==='inspect'){inspects++;return {question:{promptHash:'q'+q}};}
    return {};
  }});
  assert.equal(calls.filter(c=>c==='apply').length,2);
  assert.equal(calls.filter(c=>c==='next').length,1);
  assert.equal(inspects,2);
});
test('incorrect feedback stops before navigation or another solve',async()=>{
  const calls=[];
  await assert.rejects(runAutoPilot({status:()=>{},result:()=>{},live:()=>{},sleep:async()=>{},request:async m=>{
    calls.push(m.type);
    if(m.type==='solve')return {planId:'1',solution,question:{hash:'q1'}};
    if(m.type==='feedback')return {state:'incorrect'};
    return {};
  }}),/incorrect/);
  assert.deepEqual(calls,['solve','apply','feedback']);
});
test('disagreement removes all automatic actions',async()=>{
  let n=0;
  const result=await verifiedSolve(async()=>({...solution,actions:[{...action,value:++n===1?'12':'38/7'}]}),{},'autopilot');
  assert.equal(result.supported,false);assert.deepEqual(result.actions,[]);
});
test('independent matching actions can proceed',async()=>{
  const result=await verifiedSolve(async()=>structuredClone(solution),{},'autopilot');
  assert.equal(result.supported,true);assert.equal(result.actions[0].value,'12');
});
