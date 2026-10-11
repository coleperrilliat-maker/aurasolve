import test from 'node:test';
import assert from 'node:assert/strict';
// Minimal DOM doubles exercise the real detector and action executor.
class Input {
  constructor(){this.tagName='INPUT';this.type='text';this.name='x';this.id='x';this.isConnected=true;this.disabled=false;this.readOnly=false;this.labels=[];this.events=[];this._value='';}
  get value(){return this._value;}set value(v){this._value=String(v);}
  getClientRects(){return [{}];}closest(){return null;}getAttribute(k){return k==='aria-label'?'Value of x':null;}
  matches(){return false;}dispatchEvent(e){this.events.push(e.type);return true;}
}
globalThis.HTMLInputElement=Input;
globalThis.getComputedStyle=()=>({visibility:'visible'});
globalThis.location={href:'https://example.com/practice',pathname:'/practice'};
const field=new Input();let extra=false,clicked=0;
const second=new Input();second.id='y';second.name='y';
const root={isConnected:true,innerText:'Solve 3x + 7 = 22',getClientRects:()=>[{}],closest:()=>null,querySelector:()=>null,querySelectorAll:selector=>selector.startsWith('input')?(extra?[field,second]:[field]):[]};
const button={isConnected:true,innerText:'Check answer',disabled:false,getClientRects:()=>[{}],closest:()=>null,getAttribute:()=>null,click:()=>clicked++};
globalThis.document={title:'Ungraded practice',hidden:false,querySelector:()=>null,querySelectorAll:selector=>selector.startsWith('[data-aura-question]')?[root]:selector.startsWith('button')?[button]:[]};
const {snapshot}=await import('../src/content/detection.js');
const {execute}=await import('../src/content/actions.js');
function plan(submit=false){const s=snapshot();return {url:s.url,hash:s.hash,mode:submit?'autopilot':'field',submit,solution:{answer:'5',explanation:'Subtract 7 and divide by 3.',confidence:.99,supported:true,limitation:'',actions:[{kind:'text',target:s.fields[0].id,value:'5',destination:'',x:null,y:null}]}};}
// Field mode requires a selected target; these tests use autopilot without submission
// to isolate preflight and mutation behavior independently from UI selection.
test('text action uses native setter and input/change events',()=>{const p=plan();p.mode='autopilot';execute(p);assert.equal(field.value,'5');assert.deepEqual(field.events,['input','change']);assert.equal(clicked,0);});
test('changed question is rejected before mutation',()=>{const p=plan(true);root.innerText='Different question';assert.throws(()=>execute(p),/question changed/);root.innerText='Solve 3x + 7 = 22';assert.equal(clicked,0);});
test('all required fields must be covered before submission',()=>{extra=true;const p=plan(true);assert.throws(()=>execute(p),/all answer fields/);extra=false;assert.equal(clicked,0);});
test('hidden page stops before clicking submit',()=>{const p=plan(true);document.hidden=true;assert.throws(()=>execute(p),/hidden/);document.hidden=false;assert.equal(clicked,0);});
test('complete practice plan submits once',()=>{execute(plan(true));assert.equal(clicked,1);});
