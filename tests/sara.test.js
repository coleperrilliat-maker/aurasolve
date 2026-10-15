import test from 'node:test';
import assert from 'node:assert/strict';
import {saraChoices,clickSaraChoice} from '../src/content/sara.js';
const button=letter=>({innerText:letter,isConnected:true,className:'answer',getAttribute:()=>null,closest:()=>null,matches:()=>true,contains:()=>false,click(){this.className='answer selected';}});
globalThis.getComputedStyle=()=>({cursor:'pointer',backgroundColor:'black'});
test('SARA detects a unique letter button set outside the prompt',()=>{
  const buttons='ABCDE'.split('').map(button),doc={querySelectorAll:()=>buttons};
  assert.deepEqual(saraChoices(doc,'sara.raydass.com',()=>true),buttons);
  assert.deepEqual(saraChoices(doc,'example.com',()=>true),[]);
  assert.deepEqual(saraChoices({querySelectorAll:()=>[...buttons,button('A')]},'sara.raydass.com',()=>true),[]);
});
test('SARA clicks the requested button and checks selection feedback',async()=>{
  const b=button('C');await clickSaraChoice(b);assert.equal(b.className,'answer selected');
});
test('SARA keeps the compact sidebar pad when the prompt also has A-D labels',()=>{
  const pad={contains(el){return this.children.includes(el);},parentElement:null};
  const prompt={contains(){return false;},parentElement:null};
  const sidebar='ABCD'.split('').map((letter,i)=>{
    const el=button(letter);
    el.parentElement=pad;
    el.getBoundingClientRect=()=>({left:900,top:200+i*40,right:940,bottom:236+i*40});
    return el;
  });
  pad.children=sidebar;
  const extras='ABCD'.split('').map((letter,i)=>{
    const el=button(letter);
    el.parentElement=prompt;
    el.getBoundingClientRect=()=>({left:40,top:80+i*80,right:60,bottom:100+i*80});
    return el;
  });
  prompt.children=extras;
  const body={parentElement:null};
  pad.parentElement=body;prompt.parentElement=body;
  const doc={body,documentElement:{},querySelectorAll:()=>[...sidebar,...extras]};
  assert.deepEqual(saraChoices(doc,'sara.raydass.com',()=>true),sidebar);
});
