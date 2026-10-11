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
