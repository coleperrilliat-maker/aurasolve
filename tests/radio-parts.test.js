import test from 'node:test';
import assert from 'node:assert/strict';

let order = 0;
const radios = [];
function node(spec) {
  const el = {
    ...spec,
    order: order++,
    children: spec.children || [],
    parentElement: null,
    isConnected: true,
    disabled: false,
    readOnly: false,
    labels: [],
    dataset: {},
    checked: false,
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({x:0,y:0,left:0,top:0,right:80,bottom:24,width:80,height:24}),
    getAttribute(key) { return key === 'aria-label' ? this.ariaLabel || null : null; },
    matches() { return false; },
    closest(sel) {
      const selector = String(sel);
      if (!selector.includes('.xlMultipleChoice') || !selector.includes('.QuestionResponseMc')) return null;
      let current = this.parentElement;
      while (current) {
        const classes = new Set(String(current.className || '').split(/\s+/));
        if (current.tagName === 'FIELDSET' || current.getAttribute('role') === 'radiogroup' || classes.has('xlMultipleChoice') || classes.has('QuestionResponseMc') || classes.has('part')) return current;
        current = current.parentElement;
      }
      return null;
    },
  };
  el.innerText = spec.text || '';
  el.textContent = el.innerText;
  el.contains = other => { let current = other; while (current) { if (current === el) return true; current = current.parentElement; } return false; };
  el.compareDocumentPosition = other => other?.order > el.order ? 4 : other?.order < el.order ? 2 : 0;
  el.querySelectorAll = selector => {
    const all = [];
    (function walk(current) { for (const child of current.children || []) { all.push(child); walk(child); } })(el);
    const query = String(selector);
    if (query === '*') return [];
    if (query.includes('radio')) return all.filter(child => child.type === 'radio');
    if (query.includes('legend') || query.includes('heading') || query.startsWith('p')) return all.filter(child => child.prompt);
    if (query.startsWith('input') || query.includes('textarea') || query.includes('contenteditable')) return all.filter(child => child.tagName === 'INPUT');
    return [];
  };
  el.querySelector = selector => el.querySelectorAll(selector)[0] || null;
  el.cloneNode = () => ({textContent: el.textContent, querySelectorAll: () => []});
  el.click = () => {
    if (el.type === 'radio' && el.name) for (const other of radios) if (other !== el && other.name === el.name) other.checked = false;
    el.checked = true;
  };
  for (const child of el.children) child.parentElement = el;
  return el;
}
function prompt(text) { return node({tagName:'P', prompt:true, text, className:''}); }
function radio(name, ariaLabel) {
  const el = node({tagName:'INPUT', type:'radio', name, ariaLabel, className:'', text:''});
  radios.push(el);
  return el;
}
function container(className, children, text='') { return node({tagName:'DIV', className, children, text, prompt:false}); }

function parts() {
  radios.length = 0;
  const stem = prompt('If I am in San Diego, then I am in the West.');
  const blocks = [
    'Write the converse of the conditional statement.',
    'Write the inverse of the conditional statement.',
    'Write the contrapositive of the conditional statement.',
  ].map(title => {
    const heading = prompt(title);
    const choose = prompt('Choose the correct answer below.');
    const options = ['A','B','C','D'].map(letter => radio('answer', `${letter}. ${title}`));
    return container('part', [heading, choose, container('xlMultipleChoice', options)]);
  });
  const root = container('', [stem, ...blocks], stem.textContent);
  root.id = 'question';
  return root;
}

globalThis.getComputedStyle = () => ({visibility:'visible', backgroundImage:'none', cursor:'auto'});
globalThis.location = {href:'https://example.com/practice', pathname:'/practice', hostname:'example.com'};
const root = parts();
globalThis.document = {
  title:'Practice', hidden:false, documentElement:{parentElement:null},
  querySelector: () => null,
  querySelectorAll: selector => {
    const query = String(selector);
    if (query.includes('data-aura-question') || query.includes('xl_player')) return [root];
    if (query.includes('radio') || query.startsWith('input')) return radios.filter(el => el.type === 'radio' && root.contains(el));
    return [];
  },
};
root.matches = () => false;

const {describeRadioGroups, snapshot} = await import('../src/content/detection.js');
const {execute} = await import('../src/content/actions.js');

test('repeated A–D lists are separate radio groups', () => {
  const flat = container('', []);
  const add = (title) => {
    flat.children.push(prompt(`Write the ${title} of the conditional statement.`), prompt('Choose the correct answer below.'));
    for (const letter of ['A','B','C','D']) flat.children.push(radio('answer', `${letter}. ${title}`));
  };
  add('converse'); add('inverse'); add('contrapositive');
  for (const child of flat.children) child.parentElement = flat;
  const info = describeRadioGroups(flat, radios.filter(el => flat.contains(el)));
  const groups = [...info.values()].map(item => item.group);
  assert.equal(new Set(groups).size, 3);
  assert.ok([...info.values()].some(item => /converse/i.test(item.context)));
  assert.ok([...info.values()].some(item => /inverse/i.test(item.context)));
  assert.ok([...info.values()].some(item => /contrapositive/i.test(item.context)));
});

test('one choice list stays one radio group', () => {
  const single = [];
  const box = container('', [prompt('Which number is even?'), ...['A','B','C','D'].map(letter => {
    const el = radio('only', `${letter}. ${letter === 'B' ? '4' : '3'}`);
    single.push(el);
    return el;
  })]);
  for (const child of box.children) child.parentElement = box;
  const info = describeRadioGroups(box, single);
  assert.equal(new Set([...info.values()].map(item => item.group)).size, 1);
});

test('fill selects one radio in each part even when the inputs share a name', async () => {
  const question = snapshot();
  const groups = [...new Set(question.fields.map(field => field.group))];
  assert.deepEqual(groups, ['part-1','part-2','part-3']);
  assert.match(question.fields.find(field => field.group === 'part-1').context, /Write the converse/i);
  assert.match(question.fields.find(field => field.group === 'part-2').context, /Write the inverse/i);
  assert.match(question.fields.find(field => field.group === 'part-3').context, /Write the contrapositive/i);
  const picks = groups.map(group => question.fields.find(field => field.group === group && field.label.startsWith('C.')));
  await execute({
    url:question.url, hash:question.hash, mode:'field', submit:false,
    solution:{answer:'C\nC\nC', explanation:'Swap, negate, then reverse.', confidence:.99, supported:true, limitation:'',
      actions:picks.map(field => ({kind:'radio', target:field.id, value:'C', destination:'', x:null, y:null}))},
  });
  const checked = radios.filter(el => el.checked);
  assert.equal(checked.length, 3);
  assert.equal(new Set(checked.map(el => el.name)).size, 3);
});
