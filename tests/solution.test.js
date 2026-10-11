import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSolution} from '../src/shared/solution.js';
import {API_BASE, CLIENT_KEY} from '../src/shared/config.js';
import {solve} from '../src/background/api.js';
const snapshot={question:'3x + 7 = 22',fields:[{id:'a1',kind:'text'},{id:'a2',kind:'text'}],selected:'a1',dropTargets:[],limitations:[]};
const action={kind:'text',target:'a1',value:'5',destination:'',x:null,y:null};
const solution={answer:'x = 5',explanation:'Subtract 7, then divide by 3.',confidence:.99,supported:true,limitation:'',actions:[action]};
test('valid selected field answer passes',()=>assert.equal(validateSolution(solution,snapshot,'field'),solution));
test('model cannot edit a different field or invent a target',()=>{assert.throws(()=>validateSolution({...solution,actions:[{...action,target:'a2'}]},snapshot,'field'));assert.throws(()=>validateSolution({...solution,actions:[{...action,target:'missing'}]},snapshot,'autopilot'));});
test('duplicate actions are rejected',()=>assert.throws(()=>validateSolution({...solution,actions:[action,action]},snapshot,'field')));
test('graph bounds are enforced',()=>{const snap={...snapshot,fields:[{id:'a1',kind:'point',bounds:{xMin:-5,xMax:5,yMin:-5,yMax:5}}]};assert.throws(()=>validateSolution({...solution,actions:[{...action,kind:'point',x:6,y:0}]},snap,'field'));});
test('invalid select values and unknown drops are rejected',()=>{assert.throws(()=>validateSolution({...solution,actions:[{...action,kind:'select',value:'fake'}]},{...snapshot,fields:[{id:'a1',kind:'select',options:[{value:'real'}]}]},'field'));assert.throws(()=>validateSolution({...solution,actions:[{...action,kind:'drag',destination:'fake'}]},{...snapshot,fields:[{id:'a1',kind:'drag'}]},'field'));});
test('extension calls AuraSolve Cloud with client key',async()=>{const original=globalThis.fetch;globalThis.fetch=async(url,request)=>{assert.equal(url,`${API_BASE}/api/v1/solve`);assert.equal(request.headers['X-AuraSolve-Key'],CLIENT_KEY);const body=JSON.parse(request.body);assert.equal(body.mode,'field');assert.deepEqual(body.snapshot,snapshot);return {ok:true,json:async()=>({solution})};};try{assert.deepEqual(await solve(snapshot,'field',{model:'test-model'},undefined),solution);}finally{globalThis.fetch=original;}});
test('server errors surface without an action plan',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>({ok:false,status:502,json:async()=>({error:'OpenAI did not finish the answer.'})});try{await assert.rejects(solve(snapshot,'field',{model:'test-model'}),/did not finish/);}finally{globalThis.fetch=original;}});
test('empty solutions are rejected',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>({ok:true,json:async()=>({})});try{await assert.rejects(solve(snapshot,'field',{model:'test-model'}),/empty answer/);}finally{globalThis.fetch=original;}});
test('multiple-choice picks come from choices, or from chosen radio/checkbox fields',async()=>{
  const {pickedChoices}=await import('../src/shared/choices.js');
  const question={fields:[{id:'r1',kind:'radio',label:'A. 12'},{id:'r2',kind:'radio',label:'B. 15'},{id:'c1',kind:'checkbox',label:'C. 3'},{id:'c2',kind:'checkbox',label:'D. 5'}]};
  assert.deepEqual(pickedChoices({choices:['B. 15'],actions:[]},question),['B. 15']);
  assert.deepEqual(pickedChoices({choices:[],actions:[{kind:'checkbox',target:'c1',value:'true'},{kind:'checkbox',target:'c2',value:'true'},{kind:'radio',target:'r1',value:''}]},question),['C. 3','D. 5','A. 12']);
  assert.deepEqual(pickedChoices({choices:[],actions:[{kind:'checkbox',target:'c1',value:'false'}]},question),[]);
});
test('invalid choices are rejected and missing choices default to none',()=>{
  assert.throws(()=>validateSolution({...solution,choices:[42]},snapshot,'field'),/choices/);
  const copy={...solution};delete copy.choices;assert.deepEqual(validateSolution(copy,snapshot,'field').choices,[]);
});
