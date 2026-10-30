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
test('MathQuill uses its value API and checks retained LaTeX',async()=>{
  const f=fixture();editorBridge();
  assert.equal(f.el.dataset.auraEditor,'mathquill');
  assert.deepEqual(await editorBridge({op:'write',key:f.el.dataset.auraEditorKey,adapter:'mathquill',value:'\\frac{1}{2}'}),{filled:true});
  assert.equal(f.value(),'\\frac{1}{2}');assert.deepEqual(f.events,['input','change']);
});
test('unretained values fail and hidden documents cannot write',async()=>{
  const f=fixture('mathquill',false);editorBridge();
  const request={op:'write',key:f.el.dataset.auraEditorKey,adapter:'mathquill',value:'5'};
  const failed=editorBridge(request);
  assert.equal(failed.filled,false);assert.match(failed.error,/did not retain/);
  document.hidden=true;assert.throws(()=>editorBridge(request),/hidden/);
});
test('Dojo requires an actual value setter, not generic property assignment',async()=>{
  let f=fixture('dojo',false);editorBridge();assert.equal(f.el.dataset.auraEditor,undefined);
  f=fixture('dojo');editorBridge();assert.equal(f.el.dataset.auraEditor,'dojo');
  await editorBridge({op:'write',key:f.el.dataset.auraEditorKey,adapter:'dojo',value:'12'});assert.equal(f.value(),'12');
});
test('tutor instructions preserve LaTeX backslashes',()=>{
  assert.ok(TUTOR_INSTRUCTIONS.includes('\\frac{a}{b}'));
  assert.ok(TUTOR_INSTRUCTIONS.includes('\\('));
  assert.ok(!TUTOR_INSTRUCTIONS.includes('\f'));
});
test('an ARIA-linked answer menu is discovered and confirms its selected label',async()=>{
  const blank={id:'choice_blank',textContent:'',parentElement:{closest:()=>null},classList:{contains:()=>false},getAttribute:()=>null,getClientRects:()=>[{}],querySelector:()=>null,click(){}};
  const menu={querySelectorAll:()=>[item,blank]};
  const el={dataset:{},textContent:'Choose',isConnected:true,disabled:false,readOnly:false,
    matches:selector=>selector.includes('[role="combobox"]'),getClientRects:()=>[{}],closest:()=>null,
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
test('a Pearson fill-in menu clicks the choice and reads the displayed value back',async()=>{
  const shown={textContent:''};
  const arrow={click(){}};
  const choice={id:'always',textContent:'always',classList:{contains:()=>false},getAttribute:()=>null,getClientRects:()=>[{}],querySelector:()=>null,click(){shown.textContent='always';}};
  const blank={id:'menu_blank',textContent:'',classList:{contains:()=>false},getAttribute:()=>null,getClientRects:()=>[{}],querySelector:()=>null,click(){shown.textContent='';}};
  const el={dataset:{},isConnected:true,disabled:false,readOnly:false,
    matches:selector=>selector.includes('.xlFillin'),getClientRects:()=>[{}],closest:()=>null,getAttribute:()=>null,removeAttribute(){},dispatchEvent(){},
    querySelector:selector=>selector.includes('xlFillinInputValueAriaLabelNode')?shown:selector.includes('xlFillinArrow')?arrow:null,
    querySelectorAll:selector=>selector.includes('xlFillinItem')?[choice,blank]:[]};
  globalThis.document={hidden:false,querySelectorAll:()=>[el],getElementById:()=>null,createElement:()=>({set innerHTML(value){this.textContent=value;},textContent:''})};
  globalThis.getComputedStyle=()=>({visibility:'visible'});
  globalThis.window={};
  editorBridge();
  assert.deepEqual(JSON.parse(el.dataset.auraOptions),[{value:'always',label:'always',disabled:false}]);
  assert.deepEqual(await editorBridge({op:'write',key:el.dataset.auraEditorKey,adapter:'dojo-select',value:'always'}),{filled:true});
  assert.equal(shown.textContent,'always');
});
test('a closed Pearson fill-in keeps option ids and clicks the matching reason',async()=>{
  const shown={textContent:''};
  let opened=false;
  const reason=(id,label)=>({
    id,classList:{contains:()=>false},getAttribute:()=>null,textContent:'',
    querySelectorAll:selector=>selector.includes('[aria-label]')?[{getAttribute:key=>key==='aria-label'?label:null}]:[],
    getClientRects:()=>opened?[{}]:[],
    click(){shown.textContent=label;}
  });
  const given=reason('FL1-0','Given'),reflexive=reason('FL1-1','Reflexive Property');
  const arrow={click(){opened=true;}};
  const el={dataset:{},isConnected:true,disabled:false,readOnly:false,
    matches:selector=>selector.includes('.xlFillin'),getClientRects:()=>[{}],closest:()=>null,getAttribute:()=>null,removeAttribute(){},dispatchEvent(){},
    querySelector:selector=>selector.includes('xlFillinInputValueAriaLabelNode')?shown:selector.includes('xlFillinArrow')?arrow:null,
    querySelectorAll:selector=>selector.includes('.xlFillinContainer > div')?[given,reflexive]:[]};
  globalThis.document={hidden:false,querySelectorAll:()=>[el],getElementById:()=>null,createElement:()=>({set innerHTML(value){this.textContent=value;},textContent:''})};
  globalThis.getComputedStyle=()=>({visibility:'visible'});
  globalThis.window={};
  editorBridge();
  assert.deepEqual(JSON.parse(el.dataset.auraOptions),[
    {value:'FL1-0',label:'Given',disabled:false},
    {value:'FL1-1',label:'Reflexive Property',disabled:false}
  ]);
  assert.deepEqual(await editorBridge({op:'write',key:el.dataset.auraEditorKey,adapter:'dojo-select',value:'FL1-0'}),{filled:true});
  assert.equal(shown.textContent,'Given');
});
test('a Pearson fill-in does not advance when the reason click does not stick',async()=>{
  const shown={textContent:''};
  let clicks=0;
  const given={id:'FL1-0',classList:{contains:()=>false},getAttribute:()=>null,textContent:'',querySelectorAll:()=>[{getAttribute:key=>key==='aria-label'?'Given':null}],getClientRects:()=>[{}],click(){clicks++;}};
  const el={dataset:{},isConnected:true,disabled:false,readOnly:false,
    matches:selector=>selector.includes('.xlFillin'),getClientRects:()=>[{}],closest:()=>null,getAttribute:()=>null,removeAttribute(){},dispatchEvent(){},
    querySelector:selector=>selector.includes('xlFillinInputValueAriaLabelNode')?shown:selector.includes('xlFillinArrow')?{click(){}}:null,
    querySelectorAll:selector=>selector.includes('.xlFillinContainer > div')?[given]:selector.includes('.xlFillinContainer')?[]:[]};
  globalThis.document={hidden:false,querySelectorAll:()=>[el],getElementById:()=>null,createElement:()=>({set innerHTML(value){this.textContent=value;},textContent:''})};
  globalThis.getComputedStyle=()=>({visibility:'visible'});
  globalThis.window={};
  editorBridge();
  const failed=await editorBridge({op:'write',key:el.dataset.auraEditorKey,adapter:'dojo-select',value:'FL1-0'});
  assert.equal(failed.filled,false);
  assert.match(failed.error,/did not keep/);
  assert.equal(clicks,1);
  assert.equal(shown.textContent,'');
});
test('mouse down on the open reason selects it when click does not',async()=>{
  const shown={textContent:''};
  const previousMouse=globalThis.MouseEvent, previousPointer=globalThis.PointerEvent;
  globalThis.MouseEvent=class { constructor(type, init){ this.type=type; Object.assign(this, init||{}); } };
  globalThis.PointerEvent=globalThis.MouseEvent;
  const given={id:'FL1-0',classList:{contains:()=>false},getAttribute:()=>null,textContent:'Given',
    querySelectorAll:()=>[],getClientRects:()=>[{}],getBoundingClientRect:()=>({left:10,top:20,width:120,height:24}),
    dispatchEvent(event){ if(event.type==='mousedown') shown.textContent='Given'; },click(){}};
  const el={dataset:{},isConnected:true,disabled:false,readOnly:false,
    matches:selector=>selector.includes('.xlFillin'),getClientRects:()=>[{}],closest:()=>null,getAttribute:()=>null,removeAttribute(){},dispatchEvent(){},
    querySelector:selector=>selector.includes('xlFillinInputValueAriaLabelNode')?shown:selector.includes('xlFillinArrow')?{click(){}}:null,
    querySelectorAll:selector=>selector.includes('.xlFillinContainer > div')?[given]:[]};
  globalThis.document={hidden:false,querySelectorAll:()=>[el],getElementById:()=>null,createElement:()=>({set innerHTML(value){this.textContent=value;},textContent:''})};
  globalThis.getComputedStyle=()=>({visibility:'visible'});
  globalThis.window={};
  try{
    editorBridge();
    assert.deepEqual(await editorBridge({op:'write',key:el.dataset.auraEditorKey,adapter:'dojo-select',value:'FL1-0'}),{filled:true});
    assert.equal(shown.textContent,'Given');
  }finally{
    globalThis.MouseEvent=previousMouse;
    globalThis.PointerEvent=previousPointer;
  }
});
test('an open Pearson popup menu presses the reason row and ignores the blank row',async()=>{
  const aria={textContent:'empty selection'};
  const button={id:'FL1',innerText:'\u00a0',textContent:'\u00a0',classList:{contains:name=>name==='dijitDownArrowButton'},hasAttribute:name=>name==='aria-haspopup',getAttribute:key=>key==='aria-owns'?'FL1_menu':null,click(){}};
  let pressed='';
  const blank={id:'FL1_blank',tagName:'TR',textContent:' ',classList:{contains:()=>false},getAttribute:key=>key==='role'?'option':key==='aria-label'?'empty selection':null,querySelectorAll:()=>[],querySelector:()=>null,getClientRects:()=>[{}],click(){pressed='blank';}};
  const label={classList:{contains:name=>name==='eqAccessibleLabel'},textContent:'Given',getAttribute:()=>null};
  const given={id:'FL1-0',tagName:'TR',textContent:'Given',classList:{contains:()=>false},
    getAttribute:key=>key==='role'?'option':key==='widgetid'?'FL1-0':key==='aria-label'?' ':null,
    querySelectorAll:selector=>selector.includes('eqAccessibleLabel')||selector.includes('[aria-label]')?[label]:[],
    querySelector:()=>null,getClientRects:()=>[{}],getBoundingClientRect:()=>({left:550,top:354,width:148,height:24}),
    dispatchEvent(){},click(){pressed=given.id;button.innerText='Given';}};
  const decoy={id:'FL1-0',click(){pressed='decoy';}};
  let open=true;
  const menu={id:'FL1_menu',getClientRects:()=>open?[{}]:[],querySelectorAll:selector=>selector.includes('tr[role="option"]')?[blank,given]:[]};
  given.click=()=>{pressed=given.id;button.innerText='Given';open=false;};
  const el={dataset:{},isConnected:true,disabled:false,readOnly:false,
    matches:selector=>selector.includes('.xlFillin'),getClientRects:()=>[{}],closest:()=>null,removeAttribute(){},dispatchEvent(){},
    getAttribute:key=>key==='widgetid'?'FL1':null,
    querySelector:selector=>selector.includes('[aria-owns]')||selector.includes('xlFillinArrow')||selector.includes('aria-haspopup')||selector.includes('dijitDownArrowButton')?button:selector.includes('xlFillinInputValueAriaLabelNode')?aria:null,
    querySelectorAll:()=>[]};
  globalThis.document={hidden:false,querySelectorAll:()=>[el],getElementById:id=>id==='FL1_menu'?menu:id==='FL1-0'?decoy:null,createElement:()=>({set innerHTML(value){this.textContent=value;},textContent:''})};
  globalThis.getComputedStyle=()=>({visibility:'visible',display:'block'});
  globalThis.window={};
  await editorBridge();
  assert.deepEqual(JSON.parse(el.dataset.auraOptions),[{value:'FL1-0',label:'Given',disabled:false}]);
  assert.deepEqual(await editorBridge({op:'write',key:el.dataset.auraEditorKey,adapter:'dojo-select',value:'FL1-0'}),{filled:true});
  assert.equal(pressed,'FL1-0');
  assert.equal(button.innerText,'Given');
  assert.equal(aria.textContent,'empty selection');
});
test('aiming a Pearson reason records its row and does not click it',async()=>{
  const button={id:'FL1',innerText:'\u00a0',textContent:'\u00a0',classList:{contains:()=>false},hasAttribute:()=>true,getAttribute:key=>key==='aria-owns'?'FL1_menu':null,click(){pressed='button';}};
  let pressed='';
  const given={id:'FL1-0',tagName:'TR',textContent:'Given',classList:{contains:()=>false},
    getAttribute:key=>key==='role'?'option':null,querySelectorAll:()=>[{classList:{contains:()=>true},textContent:'Given',getAttribute:()=>null}],
    querySelector:()=>null,
    getClientRects:()=>[{}],getBoundingClientRect:()=>({left:550,top:354,width:148,height:24,bottom:378,right:698}),click(){pressed='row';}};
  const menu={getClientRects:()=>[{}],querySelectorAll:selector=>selector.includes('tr')?[given]:[]};
  const el={dataset:{},isConnected:true,disabled:false,readOnly:false,
    matches:selector=>selector.includes('.xlFillin'),getClientRects:()=>[{}],closest:()=>null,removeAttribute(){},dispatchEvent(){},
    getAttribute:key=>key==='widgetid'?'FL1':null,
    querySelector:selector=>selector.includes('xlFillinInputValueAriaLabelNode')?{textContent:'empty selection'}:selector.includes('[aria-owns]')||selector.includes('dijitDownArrowButton')||selector.includes('aria-haspopup')?button:null,
    querySelectorAll:()=>[]};
  globalThis.document={hidden:false,querySelectorAll:()=>[el],getElementById:id=>id==='FL1_menu'?menu:null,createElement:()=>({set innerHTML(value){this.textContent=value;},textContent:''})};
  globalThis.getComputedStyle=()=>({visibility:'visible',display:'block'});
  globalThis.window={};
  globalThis.location={href:'https://tdx.acs.pearson.com/Player/Player.aspx?q=1'};
  await editorBridge();
  const aimed=await editorBridge({op:'aim',key:el.dataset.auraEditorKey,adapter:'dojo-select',value:'FL1-0'});
  assert.equal(pressed,'');
  assert.equal(aimed.selected,false);
  assert.equal(aimed.x,624);
  assert.equal(aimed.y,366);
  assert.equal((await editorBridge({op:'shown',key:el.dataset.auraEditorKey,adapter:'dojo-select',value:'FL1-0'})).filled,false);
});
test('a duplicate option id and a hidden accessibility span do not move the click',async()=>{
  const button={id:'FL1',innerText:'\u00a0',textContent:'\u00a0',classList:{contains:()=>true},hasAttribute:()=>true,getAttribute:key=>key==='aria-owns'?'FL1_menu':null,click(){}};
  const hidden={classList:{contains:name=>name==='eqAccessibleLabel'},getAttribute:key=>key==='aria-hidden'?'true':null,textContent:'Given',hidden:true,getBoundingClientRect:()=>({left:1,top:1,width:2,height:2})};
  const cell={className:'dijitMenuItemLabel',innerText:'Given',textContent:'Given',contains:()=>false,getBoundingClientRect:()=>({left:100,top:40,width:80,height:16})};
  const row={id:'FL1-0',tagName:'TR',getAttribute:key=>key==='role'?'option':key==='aria-label'?' ':null,classList:{contains:()=>false},
    querySelectorAll:selector=>selector.includes('eqAccessibleLabel')?[hidden]:[],
    querySelector:selector=>selector.includes('dijitMenuItemLabel')?cell:null,
    contains:node=>node===cell,getClientRects:()=>[{}],getBoundingClientRect:()=>({left:90,top:30,width:200,height:30})};
  const blank={id:'FL1_blank',tagName:'TR',getAttribute:key=>key==='role'?'option':key==='aria-label'?'empty selection':null,classList:{contains:()=>false},querySelectorAll:()=>[],querySelector:()=>null,textContent:' ',getClientRects:()=>[{}]};
  const menu={id:'FL1_menu',getClientRects:()=>[{}],querySelectorAll:selector=>selector.includes('tr')?[blank,row]:[]};
  const decoy={id:'FL1-0',getBoundingClientRect:()=>({left:9,top:9,width:9,height:9})};
  const el={dataset:{},isConnected:true,disabled:false,readOnly:false,matches:selector=>selector.includes('.xlFillin'),getClientRects:()=>[{}],closest:()=>null,removeAttribute(){},dispatchEvent(){},
    getAttribute:key=>key==='widgetid'?'FL1':null,
    querySelector:selector=>selector.includes('[aria-owns]')||selector.includes('dijitDownArrowButton')||selector.includes('aria-haspopup')?button:selector.includes('xlFillinInputValueAriaLabelNode')?{textContent:'Given'}:null,
    querySelectorAll:()=>[]};
  globalThis.document={hidden:false,querySelectorAll:()=>[el],elementFromPoint:()=>row,getElementById:id=>id==='FL1_menu'?menu:id==='FL1-0'?decoy:null,createElement:()=>({textContent:''})};
  globalThis.getComputedStyle=()=>({visibility:'visible',display:'block'});
  globalThis.window={};
  await editorBridge();
  assert.deepEqual(JSON.parse(el.dataset.auraOptions),[{value:'FL1-0',label:'Given',disabled:false}]);
  const aimed=await editorBridge({op:'aim',key:el.dataset.auraEditorKey,adapter:'dojo-select',value:'FL1-0'});
  assert.equal(aimed.x,140);
  assert.equal(aimed.y,48);
  assert.equal((await editorBridge({op:'shown',key:el.dataset.auraEditorKey,adapter:'dojo-select',value:'FL1-0'})).filled,false);
});
test('two proof dropdowns are verified one at a time and a stale label is not success',async()=>{
  const widgets=[];
  const make=(id,label)=>{
    let open=false;
    const button={id,innerText:'\u00a0',textContent:'\u00a0',classList:{contains:()=>true},hasAttribute:()=>true,getAttribute:key=>key==='aria-owns'?`${id}_menu`:null,click(){open=!open;}};
    const hidden={classList:{contains:name=>name==='eqAccessibleLabel'},getAttribute:key=>key==='aria-hidden'?'true':null,hidden:true,textContent:label};
    const cell={innerText:label,textContent:label,contains:()=>false,getBoundingClientRect:()=>({left:20,top:20,width:100,height:18})};
    const row={id:`${id}-0`,tagName:'TR',getAttribute:key=>key==='role'?'option':key==='aria-label'?' ':null,classList:{contains:()=>false},
      querySelector:selector=>selector.includes('dijitMenuItemLabel')?cell:null,
      querySelectorAll:selector=>selector.includes('eqAccessibleLabel')?[hidden]:[],
      contains:node=>node===cell,getClientRects:()=>open?[{}]:[],getBoundingClientRect:()=>({left:10,top:10,width:140,height:28})};
    const blank={id:`${id}_blank`,tagName:'TR',getAttribute:key=>key==='role'?'option':key==='aria-label'?'empty selection':null,classList:{contains:()=>false},querySelector:()=>null,querySelectorAll:()=>[],textContent:' ',getClientRects:()=>open?[{}]:[]};
    const menu={getClientRects:()=>open?[{}]:[],querySelectorAll:selector=>selector.includes('tr')?[blank,row]:[]};
    const el={id,dataset:{},isConnected:true,disabled:false,readOnly:false,matches:selector=>selector.includes('.xlFillin'),getClientRects:()=>[{}],closest:()=>null,removeAttribute(){},dispatchEvent(){},
      getAttribute:key=>key==='widgetid'?id:null,
      querySelector:selector=>selector.includes('[aria-owns]')||selector.includes('dijitDownArrowButton')||selector.includes('aria-haspopup')||selector.includes('xlFillinArrow')?button:selector.includes('xlFillinInputValueAriaLabelNode')?{textContent:label}:null,
      querySelectorAll:()=>[]};
    widgets.push({id,el,button,menu,open:()=>open,setOpen:value=>{open=value;}});
    return el;
  };
  const first=make('FL1','Given'), second=make('FL2','Definition of midpoint');
  globalThis.document={hidden:false,querySelectorAll:()=>[first,second],elementFromPoint:(x,y)=>widgets.find(widget=>widget.open() && x>=20 && y>=20)?.el && widgets.find(widget=>widget.id==='FL1').button && null,
    getElementById:id=>widgets.map(widget=>({[`${widget.id}_menu`]:widget.menu}))[id.startsWith('FL1')?0:1][id] || null,
    createElement:()=>({textContent:''})};
  // elementFromPoint must hit the option row, not the hidden span.
  const rows={FL1:null,FL2:null};
  widgets.forEach(widget=>{
    const row=widget.menu.querySelectorAll('tr')[1];
    rows[widget.id]=row;
  });
  globalThis.document.elementFromPoint=()=>rows.FL1;
  globalThis.getComputedStyle=()=>({visibility:'visible',display:'block'});
  globalThis.window={};
  await editorBridge();
  const key=el=>el.dataset.auraEditorKey;
  const aim1=await editorBridge({op:'aim',key:key(first),adapter:'dojo-select',value:'FL1-0'});
  assert.equal(aim1.widgetId,'FL1');
  assert.equal(aim1.x,70);
  assert.equal(aim1.y,29);
  widgets[0].button.innerText='Given';
  widgets[0].setOpen(false);
  assert.equal((await editorBridge({op:'shown',key:key(first),adapter:'dojo-select',value:'FL1-0'})).filled,true);
  globalThis.document.elementFromPoint=()=>rows.FL2;
  const aim2=await editorBridge({op:'aim',key:key(second),adapter:'dojo-select',value:'FL2-0'});
  assert.equal(aim2.label,'Definition of midpoint');
  assert.equal((await editorBridge({op:'shown',key:key(second),adapter:'dojo-select',value:'FL2-0'})).filled,false);
  assert.equal(widgets[0].button.innerText,'Given');
});
test('a closed proof menu asks for a real click on the box instead of failing to open',async()=>{
  const button={id:'FL1',innerText:'\u00a0',textContent:'\u00a0',classList:{contains:()=>true},hasAttribute:()=>true,getAttribute:key=>key==='aria-owns'?'FL1_menu':null,getBoundingClientRect:()=>({left:40,top:80,width:148,height:22}),click(){opened=true;}};
  let opened=false;
  const row={id:'FL1-0',tagName:'TR',getAttribute:key=>key==='role'?'option':null,classList:{contains:()=>false},textContent:'Given',querySelector:()=>null,querySelectorAll:()=>[],getClientRects:()=>opened?[{}]:[],getBoundingClientRect:()=>({left:40,top:110,width:148,height:22})};
  const menu={getClientRects:()=>opened?[{}]:[],querySelectorAll:selector=>selector.includes('tr')?[row]:[]};
  const el={dataset:{},isConnected:true,disabled:false,readOnly:false,matches:selector=>selector.includes('.xlFillin'),getClientRects:()=>[{}],closest:()=>null,removeAttribute(){},dispatchEvent(){},
    getAttribute:key=>key==='widgetid'?'FL1':null,
    querySelector:selector=>selector.includes('[aria-owns]')||selector.includes('aria-haspopup')||selector.includes('dijitDownArrowButton')||selector.includes('xlFillinArrow')?button:null,
    querySelectorAll:()=>[]};
  globalThis.document={hidden:false,querySelectorAll:()=>[el],getElementById:id=>id==='FL1_menu'?menu:null,createElement:()=>({textContent:''})};
  globalThis.getComputedStyle=()=>({visibility:'visible',display:'block'});
  globalThis.window={};
  await editorBridge();
  const aimed=await editorBridge({op:'aim',key:el.dataset.auraEditorKey,adapter:'dojo-select',value:'FL1-0',trust:true});
  assert.equal(opened,false);
  assert.equal(aimed.needsOpen,true);
  assert.equal(aimed.x,114);
  assert.equal(aimed.y,91);
});
