import test from 'node:test';
import assert from 'node:assert/strict';
import {editorBridge} from '../src/background/editors.js';
import {actionsInDisplayOrder} from '../src/content/actions.js';

const spoken = 'ASA Postulate left parenthesis Step 1 right parenthesis';
const visual = 'ASA Postulate (Step 1)';

function equation(parts) {
  const spokenNode = parts.spoken == null ? null : {textContent: parts.spoken, classList: {contains: name => name === 'eqAccessibleLabel'}, getAttribute: () => null, querySelector: () => null};
  const visualNode = parts.visual == null ? null : {textContent: parts.visual, classList: {contains: name => name === 'eqDocument'}, getAttribute: () => 'true', querySelector: () => null};
  return {
    querySelector(selector) {
      if (selector.includes('eqAccessibleLabel') && !selector.includes('eqDocument')) return spokenNode;
      if (selector.includes('eqDocument') && !selector.includes('eqAccessibleLabel')) return visualNode;
      if (selector.includes('eqAccessibleLabel') && selector.includes('eqDocument')) return spokenNode || visualNode;
      if (selector.includes('dijitMenuItemLabel')) return this;
      return null;
    },
    querySelectorAll: () => [],
    innerText: `${parts.spoken || ''}${parts.visual || ''}`,
    textContent: `${parts.spoken || ''}${parts.visual || ''}`
  };
}

function harness() {
  let open = false;
  let question = 'Prove the first pair of triangles.';
  let choice = {id: 'FL1-0', spoken, visual};
  const button = equation({visual});
  button.id = 'FL1';
  button.innerText = '\u00a0';
  button.textContent = '\u00a0';
  button.classList = {contains: () => true};
  button.hasAttribute = () => true;
  button.getAttribute = key => key === 'aria-owns' ? 'FL1_menu' : null;
  button.getBoundingClientRect = () => ({left: 30, top: 70, width: 160, height: 22});
  button.click = () => { open = !open; };
  const rowFor = () => {
    const body = equation(choice);
    return {
      id: choice.id, tagName: 'TR', classList: {contains: () => false},
      getAttribute: key => key === 'role' ? 'option' : key === 'aria-label' ? ' ' : null,
      querySelector: selector => body.querySelector(selector),
      querySelectorAll: () => [],
      innerText: body.innerText, textContent: body.textContent,
      contains: () => true,
      getClientRects: () => open ? [{}] : [],
      getBoundingClientRect: () => ({left: 30, top: 100, width: 220, height: 24})
    };
  };
  const menu = {
    getClientRects: () => open ? [{}] : [],
    querySelectorAll: selector => selector.includes('tr') && choice ? [rowFor()] : []
  };
  const el = {
    dataset: {}, isConnected: true, disabled: false, readOnly: false,
    matches: selector => selector.includes('.xlFillin'), getClientRects: () => [{}], closest: () => null,
    removeAttribute() {}, dispatchEvent() {},
    getAttribute: key => key === 'widgetid' ? 'FL1' : null,
    querySelector(selector) {
      if (selector.includes('[aria-owns]') || selector.includes('aria-haspopup') || selector.includes('dijitDownArrowButton') || selector.includes('xlFillinArrow')) return button;
      if (selector.includes('xlFillinInputValueAriaLabelNode')) return {textContent: 'empty selection'};
      return null;
    },
    querySelectorAll: () => []
  };
  globalThis.location = {href: 'https://tdx.acs.pearson.com/Player/Player.aspx?q=1'};
  globalThis.document = {
    hidden: false,
    querySelectorAll: () => [el],
    querySelector: selector => selector.includes('data-aura-question') ? {innerText: question} : null,
    getElementById: id => id === 'FL1_menu' ? menu : null,
    elementFromPoint: () => rowFor(),
    createElement: () => ({textContent: ''})
  };
  globalThis.getComputedStyle = () => ({visibility: 'visible', display: 'block'});
  globalThis.window = {};
  return {
    el, button,
    setOpen(value) { open = value; },
    setQuestion(text, href) { question = text; globalThis.location = {href}; },
    setChoice(next) { choice = next; },
    showVisual() {
      button.innerText = choice.visual;
      button.textContent = choice.visual;
      button.querySelector = equation({visual: choice.visual}).querySelector;
    }
  };
}

test('an equation option keeps one label and readback accepts the visible parentheses', async () => {
  const page = harness();
  await editorBridge();
  const options = JSON.parse(page.el.dataset.auraOptions);
  assert.equal(options[0].label, spoken);
  assert.equal(options[0].value, 'FL1-0');
  assert.equal(options[0].label.includes(visual), false);
  page.showVisual();
  page.setOpen(false);
  const verified = await editorBridge({op: 'shown', key: page.el.dataset.auraEditorKey, adapter: 'dojo-select', value: 'FL1-0'});
  assert.equal(verified.filled, true);
  page.button.innerText = 'SAS Postulate (Step 1)';
  page.button.textContent = 'SAS Postulate (Step 1)';
  page.button.querySelector = () => null;
  const missed = await editorBridge({op: 'shown', key: page.el.dataset.auraEditorKey, adapter: 'dojo-select', value: 'FL1-0'});
  assert.equal(missed.filled, false);
  assert.match(missed.error, /SAS Postulate \(Step 1\)/);
  assert.match(missed.error, /menu is closed/);
  assert.doesNotMatch(missed.error, /shows "nothing"/);
});

test('a postulate menu with no choices until it is clicked is opened once and its choices are kept', async () => {
  const page = harness();
  page.setChoice(null);
  await editorBridge();
  assert.equal(page.el.dataset.auraOptions, undefined);
  const lazy = await editorBridge({op: 'lazyMenus'});
  assert.equal(lazy.length, 1);
  assert.equal(lazy[0].x, 110);
  page.setChoice({id: 'FL1-3', spoken: 'AAS Theorem', visual: 'AAS Theorem'});
  page.setOpen(true);
  const read = await editorBridge({op: 'readMenu', key: lazy[0].key});
  assert.deepEqual(read, {found: true, count: 1, open: true});
  page.setChoice(null);
  page.setOpen(false);
  await editorBridge();
  assert.deepEqual(JSON.parse(page.el.dataset.auraOptions).map(option => option.value), ['FL1-3']);
  assert.deepEqual(await editorBridge({op: 'lazyMenus'}), []);
});

test('the next question reuses FL1 and the fill stops without Next when selection does not stick', async () => {
  const page = harness();
  const fields = [{id: 'a1'}, {id: 'a2'}];
  const actions = actionsInDisplayOrder([
    {kind: 'select', target: 'a2', value: 'FL1-0'},
    {kind: 'select', target: 'a1', value: 'FL1-0'}
  ], fields);
  assert.deepEqual(actions.map(action => action.target), ['a1', 'a2']);
  let next = false;
  const fill = async (question, href, choice, stick) => {
    page.setQuestion(question, href);
    page.setChoice(choice);
    page.button.innerText = '\u00a0';
    page.button.textContent = '\u00a0';
    page.button.querySelector = equation({}).querySelector;
    page.setOpen(false);
    await editorBridge();
    const aim = await editorBridge({op: 'aim', key: page.el.dataset.auraEditorKey, adapter: 'dojo-select', value: 'FL1-0', trust: true});
    assert.equal(aim.needsOpen, true);
    page.setOpen(true);
    const row = await editorBridge({op: 'aim', key: page.el.dataset.auraEditorKey, adapter: 'dojo-select', value: 'FL1-0', trust: true});
    assert.equal(row.label, choice.spoken);
    assert.notEqual(row.label, `${choice.spoken}${choice.visual}`);
    if (stick) {
      page.showVisual();
      page.setOpen(false);
    }
    return editorBridge({op: 'shown', key: page.el.dataset.auraEditorKey, adapter: 'dojo-select', value: 'FL1-0'});
  };
  const first = await fill('Prove the first pair of triangles.', 'https://tdx.acs.pearson.com/Player/Player.aspx?q=1', {id: 'FL1-0', spoken, visual}, true);
  assert.equal(first.filled, true);
  const second = await fill('Prove the second pair of triangles.', 'https://tdx.acs.pearson.com/Player/Player.aspx?q=2', {
    id: 'FL1-0',
    spoken: 'HL Theorem',
    visual: 'HL Theorem'
  }, false);
  assert.equal(second.filled, false);
  assert.match(second.error, /HL Theorem/);
  assert.match(second.error, /shows "nothing"/);
  if (first.filled && second.filled) next = true;
  assert.equal(next, false);
  assert.equal(JSON.parse(page.el.dataset.auraOptions)[0].label, 'HL Theorem');
});
