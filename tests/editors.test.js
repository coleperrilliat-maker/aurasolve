import test from 'node:test';
import assert from 'node:assert/strict';
import {editorBridge} from '../src/background/editors.js';
import {TUTOR_INSTRUCTIONS} from '../src/shared/instructions.js';

function fixture(kind='mathquill',valid=true) {
  let value='';
  const events=[];
  const el={id:'answer',dataset:{},isConnected:true,disabled:false,readOnly:false,
    matches:s=>s.includes(kind==='mathquill'?'.mq-editable-field':'.eqEditor'),getClientRects:()=>[{}],closest:()=>null,
    removeAttribute:()=>{},dispatchEvent:e=>events.push(e.type)};
  globalThis.document={hidden:false,querySelectorAll:()=>[el]};
  globalThis.getComputedStyle=()=>({visibility:'visible'});
  globalThis.window=kind==='mathquill'?{MathQuill:{getInterface:()=>()=>({focus(){},latex(v){if(v!==undefined && valid)value=v;return value;}})}}:
    {dijit:{byNode:()=>({get:()=>value,set:(_key,v)=>{value=v;},...(valid?{_setValueAttr(){}}:{})})}};
  return {el,events,value:()=>value};
}
test('MathQuill uses its value API and checks retained LaTeX',()=>{
  const f=fixture();editorBridge();
  assert.equal(f.el.dataset.auraEditor,'mathquill');
  assert.deepEqual(editorBridge({op:'write',key:f.el.dataset.auraEditorKey,adapter:'mathquill',value:'\\frac{1}{2}'}),{filled:true});
  assert.equal(f.value(),'\\frac{1}{2}');assert.deepEqual(f.events,['input','change']);
});
test('unretained values fail and hidden documents cannot write',()=>{
  const f=fixture('mathquill',false);editorBridge();
  const request={op:'write',key:f.el.dataset.auraEditorKey,adapter:'mathquill',value:'5'};
  assert.throws(()=>editorBridge(request),/did not retain/);
  document.hidden=true;assert.throws(()=>editorBridge(request),/hidden/);
});
test('Dojo requires an actual value setter, not generic property assignment',()=>{
  let f=fixture('dojo',false);editorBridge();assert.equal(f.el.dataset.auraEditor,undefined);
  f=fixture('dojo');editorBridge();assert.equal(f.el.dataset.auraEditor,'dojo');
  editorBridge({op:'write',key:f.el.dataset.auraEditorKey,adapter:'dojo',value:'12'});assert.equal(f.value(),'12');
});
test('tutor instructions preserve LaTeX backslashes',()=>{
  assert.ok(TUTOR_INSTRUCTIONS.includes('\\frac{a}{b}'));
  assert.ok(TUTOR_INSTRUCTIONS.includes('\\('));
  assert.ok(!TUTOR_INSTRUCTIONS.includes('\f'));
});
