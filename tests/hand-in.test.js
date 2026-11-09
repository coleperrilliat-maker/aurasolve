import test from 'node:test';
import assert from 'node:assert/strict';
import {readPlayer} from '../src/content/player.js';

function button(text, top) {
  return {innerText:text, value:'', disabled:false, getAttribute:()=>null, matches:()=>false, closest:()=>null, getBoundingClientRect:()=>({top})};
}
function doc(buttons, body='') {
  return {body:{innerText:body}, querySelectorAll:selector=>selector.startsWith('button')?buttons:[]};
}

test('a Submit in the top bar is the test hand-in button, never Check answer',()=>{
  globalThis.innerHeight = 800;
  const view = readPlayer(doc([button('Submit', 12), button('Next', 740)]), ()=>true);
  assert.equal(view.controls.submit, 0);
  assert.equal(view.controls.next, 1);
});

test('a Submit in the footer still counts as the per-question control',()=>{
  globalThis.innerHeight = 800;
  assert.equal(readPlayer(doc([button('Submit', 720)]), ()=>true).controls.submit, 1);
});

test('the last test question is recognized from "Question N of N"',()=>{
  assert.equal(readPlayer(doc([], 'Question 20 of 20'), ()=>true).progress.lastQuestion, true);
  assert.equal(readPlayer(doc([], 'Question 3 of 20'), ()=>true).progress.lastQuestion, false);
});
