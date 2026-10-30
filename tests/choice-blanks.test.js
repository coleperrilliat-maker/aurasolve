import test from 'node:test';
import assert from 'node:assert/strict';

const log = [];
class Field {
  constructor(){ this._value = ''; }
  get value(){ return this._value; }
  set value(v){ this._value = String(v); if (this.type === 'text') log.push(this._value); }
}
globalThis.HTMLInputElement = Field;
globalThis.HTMLTextAreaElement = Field;
globalThis.HTMLSelectElement = Field;
globalThis.getComputedStyle = () => ({visibility:'visible', backgroundImage:'none'});
globalThis.location = {href:'https://example.com/practice', pathname:'/practice', hostname:'example.com'};

let order = 0;
function node(spec) {
  const el = Object.assign(new Field(), spec, {order: order++, children: spec.children || [], parentElement: null, isConnected: true, disabled: spec.disabled || false, readOnly: false, labels: [], dataset: {}, checked: false});
  el.innerText = spec.text || '';
  el.textContent = el.innerText;
  el.getClientRects = () => [{}];
  el.getBoundingClientRect = () => ({x:0,y:0,left:0,top:0,right:40,bottom:20,width:40,height:20});
  el.getAttribute = key => key === 'aria-label' ? el.ariaLabel || null : null;
  el.matches = () => false;
  el.closest = () => null;
  el.contains = other => { let current = other; while (current) { if (current === el) return true; current = current.parentElement; } return false; };
  el.dispatchEvent = () => true;
  el.cloneNode = () => ({textContent: el.textContent, querySelectorAll: () => [], remove(){}});
  el.querySelectorAll = selector => walk(el, selector);
  el.querySelector = selector => el.querySelectorAll(selector)[0] || null;
  for (const child of el.children) child.parentElement = el;
  return el;
}
function walk(el, selector) {
  const all = [];
  (function visit(current){ for (const child of current.children || []) { all.push(child); visit(child); } })(el);
  const query = String(selector);
  if (query.includes('eqEditor') || query.includes('svg') || query.includes('img') || query.includes('canvas') || query.includes('math')) return [];
  if (query.includes('input') || query.includes('textarea') || query.includes('contenteditable')) return all.filter(child => child.tagName === 'INPUT');
  return [];
}
function radio(letter, sentence) {
  return node({tagName:'INPUT', type:'radio', name:'choice', ariaLabel:`${letter}. ${sentence}`, text:''});
}
function blank(disabled=true) {
  return node({tagName:'INPUT', type:'text', disabled, text:''});
}

const prompt = node({tagName:'P', text:'Select the correct choice below and fill in any answer boxes within your choice.'});
const a = radio('A', 'The student rule is correct, but the next number should be');
const aBlank = blank();
const rowA = node({tagName:'DIV', text:'A. The student rule is correct, but the next number should be', children:[a, aBlank]});
const c = radio('C', 'The rule is to add to the denominator, which gives the next number');
const add = blank();
const next = blank();
const rowC = node({tagName:'DIV', text:'C. The rule is to add to the denominator, which gives as the next number', children:[c, add, next]});
c.click = () => { log.push('radio'); c.checked = true; a.checked = false; add.disabled = false; next.disabled = false; };
const root = node({tagName:'DIV', text: prompt.text, children:[prompt, rowA, rowC]});
root.matches = selector => String(selector).includes('data-aura-question');
globalThis.document = {
  title:'Practice', hidden:false, documentElement:{parentElement:null},
  querySelector: () => null,
  querySelectorAll: selector => String(selector).includes('data-aura-question') || String(selector).includes('xl_player') ? [root] : [],
};

const {snapshot, choiceOwnerRadio} = await import('../src/content/detection.js');
const {execute} = await import('../src/content/actions.js');
const {coversEveryField} = await import('../server/verification.js');

test('a blank inside one choice belongs to that radio', () => {
  assert.equal(choiceOwnerRadio(add, [a, c]), c);
  assert.equal(choiceOwnerRadio(aBlank, [a, c]), a);
  assert.equal(choiceOwnerRadio(prompt, [a, c]), null);
});

test('only the selected choice blanks are required', () => {
  const fields = [
    {id:'a', kind:'radio', group:'pick'}, {id:'c', kind:'radio', group:'pick'},
    {id:'a1', kind:'text', choice:'a'}, {id:'c1', kind:'text', choice:'c'}, {id:'c2', kind:'text', choice:'c'}
  ];
  const act = (kind, target, value='') => ({kind, target, value});
  assert.equal(coversEveryField({actions:[act('radio','c'), act('text','c1','9'), act('text','c2','1/30')]}, {fields}), true);
  assert.equal(coversEveryField({actions:[act('radio','c'), act('text','c1','9')]}, {fields}), false);
  assert.equal(coversEveryField({actions:[act('radio','a'), act('text','a1','1/30')]}, {fields}), true);
});

test('fill selects the choice before writing the blanks that were closed', async () => {
  log.length = 0;
  const question = snapshot();
  const chosen = question.fields.find(field => field.kind === 'radio' && field.label.startsWith('C.'));
  const boxes = question.fields.filter(field => field.choice === chosen.id);
  assert.equal(boxes.length, 2);
  assert.equal(question.fields.filter(field => field.choice && field.choice !== chosen.id).length, 1);
  await execute({
    url: question.url, hash: question.hash, mode:'field', submit:false,
    solution:{answer:'C\n9\n1/30', explanation:'Denominators increase by 9.', confidence:.99, supported:true, limitation:'',
      actions:[
        {kind:'text', target:boxes[0].id, value:'9', destination:'', x:null, y:null},
        {kind:'radio', target:chosen.id, value:'C', destination:'', x:null, y:null},
        {kind:'text', target:boxes[1].id, value:'1/30', destination:'', x:null, y:null}
      ]}
  });
  assert.equal(c.checked, true);
  assert.deepEqual(log, ['radio', '9', '1/30']);
});
