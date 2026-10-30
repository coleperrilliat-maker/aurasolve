import test from 'node:test';
import assert from 'node:assert/strict';
import {runFillAssignment} from '../src/shared/pilot-engine.js';

function question(hash) {
  return {solution:{supported:true,confidence:.95,actions:[{kind:'select',target:'FL1',value:'FL1-0'}]},question:{hash},planId:hash};
}
const page=hash=>({question:{hash,fields:[{id:'FL1',kind:'select'}]}});

test('AutoPilot repeats Fill answers through every question and stops without submitting',async()=>{
  const calls=[];
  let hash='q1';
  const result=await runFillAssignment({
    delay:async()=>{hash=hash==='q1'?'q2':'q3';},
    request:async message=>{
      calls.push(message.type+(message.mode?':'+message.mode:'')+(message.stopAtEnd?':end':''));
      if(message.type==='solve')return question(hash);
      if(message.type==='apply')return {filled:1,submitted:false,advanced:hash==='q3'?'end':'next'};
      if(message.type==='inspect')return page(hash);
      return {};
    }
  });
  assert.deepEqual(result,{completed:3,spent:3});
  assert.deepEqual(calls.filter(call=>call.startsWith('solve')),['solve:field','solve:field','solve:field']);
  assert.equal(calls.filter(call=>call==='apply:end').length,3);
  assert.equal(calls.some(call=>call.includes('autopilot') || call==='pilotAction'),false);
});

test('after Check answer the popup is closed and Next is pressed',async()=>{
  let hash='q1';const calls=[];
  const result=await runFillAssignment({
    delay:async()=>{},
    request:async message=>{
      calls.push(message.type);
      if(message.type==='solve')return question(hash);
      if(message.type==='apply')return {filled:1,submitted:false,advanced:hash==='q2'?'end':'check'};
      if(message.type==='checkResult')return {verdict:'correct',dismissed:true};
      if(message.type==='advanceQuestion'){hash='q2';return {moved:'next'};}
      if(message.type==='inspect')return page(hash);
      return {};
    }
  });
  assert.equal(result.completed,2);
  assert.equal(result.spent,2);
  assert.ok(calls.indexOf('checkResult')<calls.indexOf('advanceQuestion'));
});

test('a wrong answer is retried once with Pearson feedback, then AutoPilot moves on',async()=>{
  let hash='q1';const solves=[];
  const result=await runFillAssignment({
    delay:async()=>{},limit:1,
    request:async message=>{
      if(message.type==='solve'){solves.push(message.retryContext || null);return question(hash);}
      if(message.type==='apply')return {filled:1,submitted:false,advanced:'check'};
      if(message.type==='checkResult')return {verdict:'incorrect',text:"That's incorrect."};
      if(message.type==='advanceQuestion'){hash='q2';return {moved:'next'};}
      if(message.type==='inspect')return page(hash);
      return {};
    }
  });
  assert.equal(result.completed,1);
  assert.equal(solves.length,2);
  assert.equal(solves[0],null);
  assert.match(solves[1][0].feedback,/incorrect/);
});

test('a page with no answer boxes never pays for a solve',async()=>{
  let solves=0;
  await assert.rejects(runFillAssignment({
    delay:async()=>{},
    request:async message=>{
      if(message.type==='solve')solves++;
      if(message.type==='inspect')return {question:{hash:'x',fields:[]}};
      return {};
    }
  }),/No answer boxes/);
  assert.equal(solves,0);
});

test('a question limit stops the repeat before the assignment ends',async()=>{
  let solves=0;
  const result=await runFillAssignment({
    limit:1,delay:async()=>{},
    request:async message=>{
      if(message.type==='solve'){solves++;return question('only');}
      if(message.type==='apply')return {filled:1,submitted:false,advanced:'next'};
      return page(solves?'next':'only');
    }
  });
  assert.equal(result.completed,1);
  assert.equal(solves,1);
});
