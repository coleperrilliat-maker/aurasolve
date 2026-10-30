import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {editorBridge} from '../src/background/editors.js';

test('serialized editorBridge verifies a Pearson selection without module globals', async () => {
  const button = {
    id: 'FL1', innerText: 'Reflexive Property of \u224c', textContent: 'Reflexive Property of \u224c',
    classList: {contains: () => true}, hasAttribute: () => true,
    getAttribute: key => key === 'aria-owns' ? 'FL1_menu' : null,
    getBoundingClientRect: () => ({left: 0, top: 0, width: 10, height: 10}), click() {}
  };
  const row = (id, text) => ({
    id, tagName: 'TR', textContent: text, classList: {contains: () => false},
    getAttribute: key => key === 'role' ? 'option' : key === 'aria-label' ? ' ' : null,
    querySelector: () => null, querySelectorAll: () => [],
    getClientRects: () => [], getBoundingClientRect: () => ({left: 0, top: 0, width: 10, height: 10})
  });
  const menu = {
    getClientRects: () => [],
    querySelectorAll: selector => selector.includes('tr') ? [row('FL1-0', 'Reflexive Property of \u2245'), row('FL1-1', 'Vertical Angles Theorem')] : []
  };
  const aria = {textContent: 'Reflexive Property of \u2245'};
  const el = {
    dataset: {}, isConnected: true, disabled: false, readOnly: false,
    matches: selector => selector.includes('.xlFillin'), getClientRects: () => [{}], closest: () => null,
    removeAttribute() {}, dispatchEvent() {},
    getAttribute: key => key === 'widgetid' ? 'FL1' : null,
    querySelector(selector) {
      if (selector.includes('[aria-owns]') || selector.includes('aria-haspopup') || selector.includes('dijitDownArrowButton') || selector.includes('xlFillinArrow')) return button;
      if (selector.includes('xlFillinInputValueAriaLabelNode')) return aria;
      return null;
    },
    querySelectorAll: () => []
  };
  const context = vm.createContext({
    document: {
      hidden: false,
      querySelectorAll: () => [el],
      querySelector: () => null,
      getElementById: id => id === 'FL1_menu' ? menu : null,
      createElement: () => ({textContent: ''})
    },
    getComputedStyle: () => ({visibility: 'visible', display: 'block'}),
    crypto: {randomUUID: () => 'isolated-key'}
  });
  assert.equal(Object.hasOwn(context, 'reasonKey'), false);
  const bridge = vm.runInContext(`(${editorBridge.toString()})`, context);
  await bridge();
  const request = value => ({op: 'shown', key: el.dataset.auraEditorKey, adapter: 'dojo-select', value});
  assert.equal((await bridge(request('FL1-0'))).filled, true);
  button.innerText = 'Vertical\u00a0Angles Theorem';
  assert.equal((await bridge(request('FL1-1'))).filled, true);
  button.innerText = 'Reflexive Property of =';
  assert.equal((await bridge(request('FL1-0'))).filled, false);
  button.innerText = '\u00a0';
  const stale = await bridge(request('FL1-0'));
  assert.equal(stale.filled, false);
  assert.match(stale.error, /shows "nothing"/);
  assert.match(stale.error, /menu is closed/);
});
