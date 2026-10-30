import test from 'node:test';
import assert from 'node:assert/strict';

function control(text) {
  return {
    innerText: text,
    value: '',
    isConnected: true,
    disabled: false,
    clicked: false,
    getClientRects: () => [{}],
    closest: () => null,
    matches: () => false,
    getAttribute: () => null,
    querySelectorAll: () => [],
    click() { this.clicked = true; }
  };
}
const ok = control('OK');
const dialog = control("That's incorrect. Observe the pattern of change in the first three figures. OK");
dialog.querySelectorAll = () => [ok];
const page = control(`${'Which figure is incorrect? '.repeat(40)}That's incorrect.`);
page.querySelectorAll = () => [ok];
globalThis.getComputedStyle = () => ({visibility: 'visible'});
globalThis.document = {hidden: false, querySelectorAll: () => [page, dialog]};
const {findIncorrectDialog, dismissFeedback} = await import('../src/content/actions.js');

test('the incorrect card is the dialog that contains OK, not the whole page', () => {
  assert.equal(findIncorrectDialog(), dialog);
});

test('trying again clicks that OK button', () => {
  assert.deepEqual(dismissFeedback(), {clicked: true});
  assert.equal(ok.clicked, true);
});
