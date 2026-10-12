import test from 'node:test';
import assert from 'node:assert/strict';
import {editorBridge} from '../src/background/editors.js';
import {TUTOR_INSTRUCTIONS} from '../src/shared/instructions.js';

function fixture(kind='mathquill',valid=true) {
  let value='';
  const events=[];
  const el={id:'answer',dataset:{},isConnected:true,disabled:false,readOnly:false,
    matches:s=>s.includes(kind==='mathquill'?'.mq-editable-field':'.eqEditor'),getClientRects:()=>[{}],closest:()=>null,
    getAttribute:key=>key==='widgetid'?'pearson-widget':null,removeAttribute:()=>{},dispatchEvent:e=>events.push(e.type)};
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
test('an ARIA-linked answer menu is discovered and confirms its selected label',async()=>{
  const menu={querySelectorAll:()=>[item]};
  const el={dataset:{},textContent:'Choose',isConnected:true,disabled:false,readOnly:false,
    matches:selector=>selector.includes('[role="combobox"][aria-controls]'),getClientRects:()=>[{}],closest:()=>null,
    getAttribute:key=>key==='aria-controls'?'answer-menu':null,removeAttribute(){},querySelector:()=>null,click(){},dispatchEvent(){}};
  const item={textContent:'Square root',parentElement:{closest:()=>null},classList:{contains:()=>false},
    getAttribute:()=>null,getClientRects:()=>[{}],querySelector:()=>null,click(){el.textContent='Square root';}};
  globalThis.document={hidden:false,querySelectorAll:()=>[el],getElementById:id=>id==='answer-menu'?menu:null,createElement:()=>({set innerHTML(value){this.textContent=value;},textContent:''})};
  globalThis.getComputedStyle=()=>({visibility:'visible'});
  globalThis.window={};
  editorBridge();
  assert.equal(el.dataset.auraEditor,'dojo-select');
  assert.deepEqual(JSON.parse(el.dataset.auraOptions),[{value:'Square root',label:'Square root',disabled:false}]);
  assert.deepEqual(await editorBridge({op:'write',key:el.dataset.auraEditorKey,adapter:'dojo-select',value:'Square root'}),{filled:true});
});
test('a lazy Pearson dropdown binds to its sole opened popup and retains the choice',async()=>{
  let open=false;
  const item={textContent:'Vertical angles',parentElement:{closest:()=>null},classList:{contains:()=>false},
    getAttribute:()=>null,getClientRects:()=>open?[{}]:[],querySelector:()=>null,click(){el.value='Vertical angles';open=false;}};
  const menu={dataset:{},getClientRects:()=>open?[{}]:[],querySelectorAll:()=>[item],contains:()=>false};
  const el={dataset:{},value:'',isConnected:true,disabled:false,readOnly:false,
    matches:selector=>selector.includes('[role="combobox"]'),getClientRects:()=>[{}],
    closest:selector=>selector.includes('[data-aura-question]')?{}:null,
    getAttribute:()=>null,removeAttribute(){},querySelector:()=>null,click(){open=true;},dispatchEvent(){}};
  globalThis.KeyboardEvent=class {constructor(type,init){this.type=type;Object.assign(this,init);}};
  globalThis.document={hidden:false,activeElement:null,getElementById:()=>null,createElement:()=>({set innerHTML(value){this.textContent=value;},textContent:''}),
    querySelectorAll:selector=>selector==='[data-aura-menu-key]'?(menu.dataset.auraMenuKey?[menu]:[]):selector.startsWith('[role="listbox"]')?[menu]:[el]};
  globalThis.getComputedStyle=()=>({visibility:'visible'});
  globalThis.window={};
  await editorBridge({op:'prepare'});
  editorBridge();
  assert.equal(el.dataset.auraEditor,'dojo-select');
  assert.deepEqual(JSON.parse(el.dataset.auraOptions),[{value:'Vertical angles',label:'Vertical angles',disabled:false}]);
  assert.deepEqual(await editorBridge({op:'write',key:el.dataset.auraEditorKey,adapter:'dojo-select',value:'Vertical angles'}),{filled:true});
  assert.equal(el.value,'Vertical angles');
});
