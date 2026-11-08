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

test('a wrong answer is retried twice with every earlier Pearson feedback, then AutoPilot moves on',async()=>{
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
  assert.equal(solves.length,3);
  assert.equal(solves[0],null);
  assert.match(solves[1][0].feedback,/incorrect/);
  assert.equal(solves[2].length,2);
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

const mylab=(hash,current,part,controls={})=>({question:{hash,fields:[{id:'F-'+hash,kind:'select'}],player:{progress:{current,part}}},controls});

test('an OK after a correct part keeps solving the same question instead of pressing Next',async()=>{
  let state={hash:'q1p1',current:1,part:1};const events=[];const calls=[];
  const result=await runFillAssignment({
    delay:async()=>{},limit:1,
    onEvent:event=>{events.push(event.kind+(event.part?':'+event.part:''));},
    request:async message=>{
      calls.push(message.type);
      if(message.type==='solve')return question(state.hash);
      if(message.type==='apply')return {filled:1,submitted:false,advanced:'check'};
      if(message.type==='checkResult'){
        if(state.part===1)state={hash:'q1p2',current:1,part:2};
        else if(state.part===2)state={...state,part:3,hash:'q1p3'};
        return {verdict:'correct',dismissed:true};
      }
      if(message.type==='advanceQuestion'){state={hash:'q2',current:2,part:1};return {moved:'next'};}
      if(message.type==='inspect')return mylab(state.hash,state.current,state.part);
      return {};
    }
  });
  assert.equal(result.spent,3);
  assert.equal(result.completed,1);
  assert.deepEqual(events.filter(e=>e.startsWith('part')),['part:2','part:3']);
  assert.equal(calls.filter(c=>c==='advanceQuestion').length,1);
});

test('a homework question with a wrong part is finished, then redone with Similar question',async()=>{
  let state={hash:'a1',current:1,part:1,similar:0};const calls=[];let tries=0;
  const result=await runFillAssignment({
    delay:async()=>{},limit:1,retries:0,
    request:async message=>{
      calls.push(message.type);
      if(message.type==='solve')return question(state.hash);
      if(message.type==='apply')return {filled:1,submitted:false,advanced:'check'};
      if(message.type==='checkResult'){
        tries++;
        if(state.hash==='a1'){state={hash:'a2',current:1,part:2,similar:0};return {verdict:'incorrect',text:'Incorrect'};}
        if(state.hash==='a2'){state={...state,similar:1};return {verdict:'correct'};}
        return {verdict:'correct'};
      }
      if(message.type==='similarQuestion'){state={hash:'b1',current:1,part:1,similar:0};return {clicked:true};}
      if(message.type==='advanceQuestion'){state={hash:'q2',current:2,part:1,similar:0};return {moved:'next'};}
      if(message.type==='inspect')return mylab(state.hash,state.current,state.part,{similar:state.similar});
      return {};
    }
  });
  assert.equal(calls.filter(c=>c==='similarQuestion').length,1);
  const checks=calls.map((c,i)=>c==='checkResult'?i:-1).filter(i=>i>=0);
  assert.ok(calls.indexOf('similarQuestion')>checks[1] && calls.indexOf('similarQuestion')<checks[2]);
  assert.equal(result.completed,1);
  assert.equal(result.spent,3);
});

test('test mode: an OK with no verdict moves on with Next and never asks for Similar question',async()=>{
  let state={hash:'t1',current:1};const calls=[];
  const result=await runFillAssignment({
    delay:async()=>{},limit:2,
    request:async message=>{
      calls.push(message.type);
      if(message.type==='solve')return question(state.hash);
      if(message.type==='apply')return {filled:1,submitted:false,advanced:'check'};
      if(message.type==='checkResult')return {verdict:'unknown',dismissed:true};
      if(message.type==='advanceQuestion'){state={hash:'t'+(state.current+1),current:state.current+1};return {moved:'next'};}
      if(message.type==='inspect')return mylab(state.hash,state.current,null);
      return {};
    }
  });
  assert.equal(result.completed,2);
  assert.equal(result.spent,2);
  assert.equal(calls.includes('similarQuestion'),false);
});

test('a moved matching tile is not mistaken for a new part',async()=>{
  let state={hash:'d1',current:3};const events=[];
  const result=await runFillAssignment({
    delay:async()=>{},limit:1,
    onEvent:event=>{events.push(event.kind);},
    request:async message=>{
      if(message.type==='solve')return question(state.hash);
      if(message.type==='apply')return {filled:1,submitted:false,advanced:'check'};
      if(message.type==='checkResult'){state={...state,hash:'d1-moved'};return {verdict:'correct'};}
      if(message.type==='advanceQuestion'){state={hash:'d2',current:4};return {moved:'next'};}
      if(message.type==='inspect')return {question:{hash:state.hash,fields:[{id:'tile',kind:'drag'}],player:{progress:{current:state.current}}}};
      return {};
    }
  });
  assert.equal(result.spent,1);
  assert.equal(events.includes('part'),false);
});
