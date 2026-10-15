import {editorBridge} from '../src/background/editors.js';
import {snapshot,prepareField} from '../src/content/detection.js';
import {execute} from '../src/content/actions.js';
import {captureFigures} from '../src/content/figures.js';
const fixture=document.querySelector('#fixture'),results=document.querySelector('#results');
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const action=(field,value)=>({target:field.id,kind:field.kind,value,x:null,y:null,destination:''});
let plan=null,submits=0;
// Exercise the same MAIN-world bridge called by the worker; this fixture's
// transport substitutes for Chrome messaging, not for the editor itself.
window.chrome={runtime:{sendMessage:async message=>{
 try{
  assert(message.type==='writeEditor','Unexpected request');
  const s=snapshot();assert(s.hash===plan.hash,'Question fingerprint changed during a multi-field fill');
  const a=plan.solution.actions.find(a=>a.target===message.target),f=s.fields.find(f=>f.id===a.target);
  return {ok:true,data:await editorBridge({op:'write',key:f.editorKey,adapter:f.adapter,value:a.value})};
 }catch(e){return {ok:false,error:e.message};}
}}};
function reset(html){delete window.dijit;delete window.require;fixture.innerHTML=`<section data-aura-question>${html}</section><button id="submit">Check answer</button>`;document.querySelector('#submit').onclick=()=>submits++;}
async function fill(values){
 editorBridge();const s=snapshot();
 plan={id:'fixture',url:s.url,hash:s.hash,mode:'field',submit:false,requireComplete:true,solution:{answer:'Fixture answers',choices:[],explanation:'Test values.',confidence:.99,supported:true,limitation:'',actions:s.fields.map((f,i)=>action(f,values[i]))}};
 await execute(plan);assert(submits===0,'Fill submitted the page');return s;
}
function dropdown(button,{labels=['Given','Vertical Angles Theorem','Transitive Property'],link=true,delay=0,readonly=false,duplicate=false}={}){
 const menu=document.createElement('div');menu.id=button.id+'-menu';menu.setAttribute('role','listbox');menu.hidden=true;fixture.append(menu);
 labels.forEach((label,i)=>{const item=document.createElement('div');item.setAttribute('role','option');item.dataset.value=String(i);item.textContent=label;item.setAttribute('aria-selected','false');if(i===2)item.setAttribute('aria-disabled','true');item.onclick=()=>{if(i===2)return;for(const other of menu.children)other.setAttribute('aria-selected',String(other===item));if(readonly)button.value=label;else button.textContent=label;menu.hidden=true;button.setAttribute('aria-expanded','false');};menu.append(item);});
 if(link)button.setAttribute('aria-controls',menu.id);
 button.setAttribute('aria-expanded','false');
 button.onclick=()=>{if(!menu.hidden){menu.hidden=true;button.setAttribute('aria-expanded','false');return;}setTimeout(()=>{menu.hidden=false;button.setAttribute('aria-expanded','true');},delay);};
 button.onkeydown=e=>{if(e.key==='Escape'){menu.hidden=true;button.setAttribute('aria-expanded','false');}};
 return menu;
}
async function run(name,test){try{await test();const li=document.createElement('li');li.textContent='PASS: '+name;results.append(li);}catch(e){const li=document.createElement('li');li.textContent='FAIL: '+name+' — '+e.message;li.className='fail';results.append(li);throw e;}}
document.querySelector('#run').onclick=async()=>{
 results.replaceChildren();submits=0;
 try{
 await run('Native dropdowns use option values, skip disabled groups, and retain the selection',async()=>{
  reset('<p>Choose a reason.</p><label>Reason<select><option value="">Choose</option><option value="v1">Given</option><option value="v2">Vertical Angles Theorem</option><optgroup label="Unavailable" disabled><option value="v3">Disabled reason</option></optgroup></select></label>');
  const s=await fill(['v2']);assert(s.fields[0].options.find(o=>o.value==='v3').disabled,'Disabled option group ignored');assert(fixture.querySelector('select').value==='v2','Native value not retained');
 });
 await run('ARIA menus: discover options, open, select, read back, and fill two proof rows without a stale fingerprint',async()=>{
  reset('<p>Complete both proof reasons.</p><table><tr><th>Statement</th><th>Reason</th></tr><tr><td>AB = CD</td><td><button type="button" role="combobox" id="proof1" aria-label="Reason 1">Choose</button></td></tr><tr><td>Angle A = Angle B</td><td><button type="button" role="combobox" id="proof2" aria-label="Reason 2">Choose</button></td></tr></table>');
  dropdown(document.querySelector('#proof1'));dropdown(document.querySelector('#proof2'));
  await editorBridge({op:'prepare'});editorBridge();const before=snapshot();assert(before.fields.length===2,'Proof dropdown not discovered');assert(before.fields[0].context.includes('Statement | Reason') && before.fields[1].context.includes('Angle A'),'Lost table row/column mapping');
  await fill(['0','1']);assert(snapshot().hash===before.hash,'Filling changed question fingerprint');assert(document.querySelector('#proof1').textContent==='Given' && document.querySelector('#proof2').textContent==='Vertical Angles Theorem','Wrong proof selections');
 });
 await run('Delayed unlinked popup is associated only with its own trigger',async()=>{
  reset('<p>Select a reason.</p><button role="combobox" id="delayed" aria-label="Reason">Choose</button><div role="listbox"><div role="option">Unrelated menu</div></div>');
  dropdown(document.querySelector('#delayed'),{link:false,delay:100});await editorBridge({op:'prepare'});await fill(['1']);assert(document.querySelector('#delayed').textContent==='Vertical Angles Theorem','Delayed menu not selected');
 });
 await run('A popup unmounted after closing is rediscovered on the next fill',async()=>{
  reset('<p>Choose a reason.</p><button role="combobox" id="remount" aria-label="Reason">Choose</button>');
  const trigger=document.querySelector('#remount');let menu=null;
  trigger.onclick=()=>{if(menu){menu.remove();menu=null;trigger.setAttribute('aria-expanded','false');return;}menu=document.createElement('div');menu.setAttribute('role','listbox');menu.innerHTML='<div role="option">Given</div><div role="option">Vertical Angles Theorem</div>';for(const item of menu.children)item.onclick=()=>{trigger.textContent=item.textContent;menu.remove();menu=null;trigger.setAttribute('aria-expanded','false');};fixture.append(menu);trigger.setAttribute('aria-expanded','true');};
  await editorBridge({op:'prepare'});assert(!menu,'Preparation did not close popup');await fill(['option:1']);assert(trigger.textContent==='Vertical Angles Theorem','Remounted menu was not filled');
 });
 await run('Nested dropdown trigger and backing select count as one answer',async()=>{
  reset('<p>Choose a reason.</p><div role="combobox" aria-label="Reason"><button aria-haspopup="listbox">Choose</button><select hidden><option value="0">Given</option><option value="1">Vertical Angles Theorem</option></select></div>');
  const s=await fill(['1']);assert(s.fields.length===1,'Nested control counted twice');assert(fixture.querySelector('select').value==='1','Backing select was not filled');
 });
 await run('Readonly dropdown text is selectable and is not mistaken for a disabled answer',async()=>{
  reset('<p>Pick a reason.</p><input readonly role="combobox" id="readonly" aria-label="Reason" value="Choose">');
  dropdown(document.querySelector('#readonly'),{readonly:true});await editorBridge({op:'prepare'});const s=await fill(['0']);assert(s.fields.length===1 && s.fields[0].kind==='select','Readonly proxy not detected as select');assert(document.querySelector('#readonly').value==='Given','Readonly dropdown not filled');
 });
 await run('AMD-only Dojo uses actual numeric option values, including zero',async()=>{
  reset('<p>Select the correct reason.</p><div class="dijitSelect" role="combobox" widgetid="amd" id="amd" aria-label="Reason">Choose</div>');
  let value=-1;const widget={get:()=>value,getOptions:()=>[{value:0,label:'Given'},{value:1,label:'Vertical Angles Theorem'}],_setValueAttr(){},set:(key,v)=>{value=v;document.querySelector('#amd').textContent=v===0?'Given':'Vertical Angles Theorem';}};
  window.require=name=>{assert(name==='dijit/registry','Unexpected AMD load');return {byId:()=>widget};};
  await fill(['0']);assert(value===0,'Dojo internal value type was lost');
 });
 await run('Native multi-select applies all choices, including deselecting old choices',async()=>{
  reset('<p>Select all prime numbers.</p><select aria-label="Primes" multiple><option value="2">2</option><option value="3">3</option><option value="4" selected>4</option></select>');
  await fill(['["3","2"]']);assert([...fixture.querySelector('select').selectedOptions].map(o=>o.value).join(',')==='2,3','Multi-select mismatch');
 });
 await run('Custom radio groups and checkboxes retain ARIA state without submitting',async()=>{
  reset('<p>Choose one answer in each group.</p><div role="radiogroup" aria-label="First"><button role="radio" aria-checked="false">A</button><button role="radio" aria-checked="false">B</button></div><div role="radiogroup" aria-label="Second"><button role="radio" aria-checked="false">C</button><button role="radio" aria-checked="false">D</button></div><button role="checkbox" aria-checked="true">Include explanation</button>');
  for(const el of fixture.querySelectorAll('[role=radio]'))el.onclick=()=>{for(const other of el.parentElement.children)other.setAttribute('aria-checked',String(other===el));};
  const checkbox=fixture.querySelector('[role=checkbox]');checkbox.onclick=()=>checkbox.setAttribute('aria-checked',String(checkbox.getAttribute('aria-checked')!=='true'));
  const s=snapshot();plan={url:s.url,hash:s.hash,mode:'field',solution:{supported:true,confidence:.99,answer:'B, C',explanation:'Fixture.',limitation:'',actions:[action(s.fields[1],''),action(s.fields[2],''),action(s.fields[4],'false')]}};await execute(plan);
  assert(fixture.querySelectorAll('[aria-checked=true]').length===2,'ARIA state mismatch');
 });
 await run('All lazy editors activate even when the page already contains an answer box',async()=>{
  reset('<p>Fill x, y and z.</p><input aria-label="x"><span id="lazy1" class="eqEditor inputField">y</span><span id="lazy2" class="eqEditor inputField">z</span>');
  for(const el of fixture.querySelectorAll('.eqEditor'))el.onclick=()=>{el.innerHTML='<input aria-label="'+el.textContent+'">';el.onclick=null;};
  await prepareField();assert(snapshot().fields.length===3,'Only one lazy editor was activated');await fill(['1','2','3']);assert([...fixture.querySelectorAll('input')].map(el=>el.value).join(',')==='1,2,3','Mixed fields not filled');
 });
 await run('A controlled input reverting asynchronously cannot report a successful fill',async()=>{
  reset('<p>Fill x.</p><input aria-label="x">');const input=fixture.querySelector('input');input.onchange=()=>setTimeout(()=>input.value='',10);
  let rejected=false;try{await fill(['2']);}catch(e){rejected=/changed an answer/.test(e.message);}assert(rejected,'Reverted input was reported as filled');
 });
 await run('An incomplete plan leaves every answer unchanged',async()=>{
  reset('<p>Fill x and y.</p><input aria-label="x"><input aria-label="y">');const s=snapshot();
  let rejected=false;try{await execute({url:s.url,hash:s.hash,mode:'field',solution:{answer:'2',explanation:'Fixture.',supported:true,confidence:.99,limitation:'',actions:[action(s.fields[0],'2')]}});}catch{rejected=true;}
  assert(rejected && [...fixture.querySelectorAll('input')].every(el=>el.value===''),'Incomplete plan made partial writes');
 });
 await run('Missing dropdown options are diagnosed and never silently skipped in a mixed question',async()=>{
  reset('<p>Fill x and choose the reason.</p><input aria-label="x"><button role="combobox" aria-label="Reason">Choose</button>');
  editorBridge();const s=snapshot();assert(s.unmappedControls.length===1,'Missing dropdown not diagnosed');let rejected=false;try{await fill(['2']);}catch{rejected=true;}assert(rejected && fixture.querySelector('input').value==='','Partial question was silently filled');
 });
 await run('SVG graph choices produce labeled close-ups without being mistaken for graph drawing inputs',async()=>{
  reset('<p>Select the matching graph.</p><label><input type="radio" name="graph">Graph A<svg aria-label="Graph A: rising line" width="220" height="180" viewBox="0 0 220 180"><path d="M20 160 L200 20" stroke="blue"/><text x="30" y="30">y = 2x</text></svg></label><label><input type="radio" name="graph">Graph B<svg aria-label="Graph B: falling line" width="220" height="180" viewBox="0 0 220 180"><path d="M20 20 L200 160" stroke="red"/><text x="30" y="30">y = -2x</text></svg></label>');
  const s=snapshot(),images=await captureFigures();assert(s.visual && !s.unmappedControls.length,'Graph choices confused with a graph editor');assert(images.length===2 && images[0].label.includes('Graph A') && images.every(i=>i.image.startsWith('data:image/jpeg;base64,')),'Graph close-ups missing');
  const gallery=document.createElement('div');for(const figure of images){const img=new Image();img.src=figure.image;img.alt=figure.label;img.width=220;gallery.append(img);}fixture.append(gallery);
 });
 const li=document.createElement('li');li.textContent='All Fill checks passed. Zero submissions.';results.append(li);
 }catch(error){console.error(error);}
};
