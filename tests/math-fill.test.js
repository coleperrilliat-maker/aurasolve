import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySubject,fillBlocker,mathFillAllowed,placeMathButton,sameEntry,whenReady} from '../src/shared/math-question.js';
import {MATH_FILL_NOTE,mathFillRequestError} from '../server/openai.js';
import {verifiedSolve} from '../server/verification.js';
import {queryDeep} from '../src/content/detection.js';

const solution={answer:'5',explanation:'Subtract 7 and divide by 3.',confidence:.99,supported:true,limitation:'',actions:[{kind:'text',target:'a1',value:'5',destination:'',x:null,y:null}]};

test('simple equations are math and English essays are not',()=>{
  assert.equal(classifySubject({text:'Solve 2x + 3 = 11.',recognizedQuestion:true,hasAnswerField:true}),'math');
  assert.equal(classifySubject({text:'Find the value of y.',recognizedQuestion:true,hasAnswerField:true}),'math');
  const essay=classifySubject({text:'Write an essay about the theme of the novel.',recognizedQuestion:true,hasAnswerField:true});
  assert.equal(essay,'writing');
  assert.equal(classifySubject({text:'What is the main idea of the passage?',recognizedQuestion:true,hasAnswerField:true}),'writing');
  assert.equal(mathFillAllowed({subject:essay}),false);
  assert.equal(mathFillAllowed({subject:'math'}),true);
});
test('fractions, negatives, and decimals compare exactly',()=>{
  assert.equal(sameEntry('1/2','1/2'),true);
  assert.equal(sameEntry('-2.5','-2.50','number'),true);
  assert.equal(sameEntry('1/2','0.5'),false);
});
test('a button moves to a 12px gap instead of covering the question',()=>{
  const root={left:0,top:80,right:500,bottom:420},size={width:100,height:28},viewport={width:800,height:600};
  const clear=placeMathButton(root,[],size,viewport);
  assert.deepEqual(clear,{left:388,top:92});
  const covered=placeMathButton(root,[{left:0,top:80,right:500,bottom:220}],size,viewport);
  assert.equal(covered.top,40);
  assert.ok(root.top-covered.top-size.height>=12);
});
test('dynamic inputs resolve on mutation and unsupported graphs explain why',async()=>{
  let ready=false;
  const appeared=whenReady(()=>ready,listen=>{ready=true;listen();return ()=>{};},1000);
  assert.equal(await appeared,true);
  assert.equal(await whenReady(()=>false,()=>()=>{},20),false);
  assert.match(fillBlocker(['Canvas/SVG content is not read visually; complex graph actions are unsupported.','Graph control has no supported coordinate adapter.']),/Graph control/);
});
test('open shadow inputs are reachable and closed editor internals are not',()=>{
  const input={matches:()=>false};
  const shadow={querySelectorAll:selector=>selector==='*'?[]:[input]};
  const host={shadowRoot:shadow,matches:()=>false};
  const root={querySelectorAll:selector=>selector==='*'?[host]:[]};
  assert.deepEqual(queryDeep(root,'input, textarea, math-field'),[input]);
  const hidden={id:'hidden'};
  const mathShadow={querySelectorAll:()=>[hidden]};
  const math={shadowRoot:mathShadow,matches:selector=>selector.includes('math-field')};
  assert.deepEqual(queryDeep({querySelectorAll:selector=>selector==='*'?[math]:[]},'input'),[]);
});
test('math fill sends one screenshot-backed request and does not submit',async()=>{
  assert.match(MATH_FILL_NOTE,/screenshot/);
  assert.match(MATH_FILL_NOTE,/Do not request submission/);
  assert.match(mathFillRequestError({mathFill:true},null),/screenshot/);
  assert.equal(mathFillRequestError({mathFill:true},'data:image/jpeg;base64,abc'),'');
  let calls=0;
  const result=await verifiedSolve(async()=>{calls++;return solution;},{mathFill:true,question:'Solve 2x+3=11',fields:[{id:'a1',kind:'text'}]},'autopilot');
  assert.equal(calls,1);assert.equal(result.actions.length,1);
});
