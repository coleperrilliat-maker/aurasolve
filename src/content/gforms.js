import {sendExtension} from '../shared/messaging.js';
import {fetchOverlay} from '../shared/overlay.js';
import {matchOption, selectionLooksActive, classifyFormControls} from '../shared/form-answer.js';

// Google Forms: highlight anything in a question (even a space between words)
// and AuraSolve answers that whole question. No on-page button.
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const busy = new WeakSet();
let enabled = true;
let lastKey = '';

function inFrame() {
  try { return globalThis !== globalThis.top; }
  catch { return true; }
}

function optionLabel(el) {
  return clean(el.dataset.value ?? el.dataset.answerValue ?? el.getAttribute('aria-label') ?? el.innerText);
}

export function readQuestion(item) {
  const title = clean(item.querySelector('[role="heading"]')?.innerText).replace(/\s*\*$/, '');
  const description = clean(item.querySelector('[role="heading"]')?.parentElement?.nextElementSibling?.innerText);
  const radios = [...item.querySelectorAll('[role="radio"]')];
  const boxes = [...item.querySelectorAll('[role="checkbox"]')];
  const listbox = item.querySelector('[role="listbox"]');
  const text = item.querySelector('input[type="text"], input[type="email"], input[type="number"], input[type="url"], input:not([type])');
  const area = item.querySelector('textarea');
  const classified = classifyFormControls({
    title,
    radios: radios.map(optionLabel),
    boxes: boxes.map(optionLabel),
    listbox: listbox ? [...listbox.querySelectorAll('[role="option"]')].map(el => clean(el.dataset.value)).filter(Boolean) : [],
    text: Boolean(text),
    area: Boolean(area),
    radiogroups: item.querySelectorAll('[role="radiogroup"]').length,
  });
  if (!classified) return null;
  const {kind, options} = classified;
  const rect = item.getBoundingClientRect();
  // Never read window.top geometry here. In a cross-origin LMS iframe that
  // throws a SecurityError and used to abort every highlight.
  return {
    kind, title: classified.title, description, options,
    hasImage: true,
    // LMS embeds are always iframes; send the whole tab so the crop can't miss.
    fullTab: inFrame(),
    rect: {
      x: Math.max(0, rect.left),
      y: Math.max(0, rect.top),
      width: Math.max(40, Math.min(innerWidth, rect.right) - Math.max(0, rect.left)),
      height: Math.max(40, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)),
    },
    devicePixelRatio,
  };
}

function typeInto(el, value) {
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  setter ? setter.call(el, value) : (el.value = value);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
  el.blur();
}

async function fill(item, question, answer) {
  const choices = Array.isArray(answer?.choices) ? answer.choices : [];
  if (question.kind === 'radio') {
    const radios = [...item.querySelectorAll('[role="radio"]')];
    const labels = radios.map(optionLabel);
    const pick = matchOption(labels, choices[0]);
    const target = radios.find((el, index) => labels[index] === pick);
    if (!target) throw new Error('AuraSolve couldn\'t match its answer to a choice.');
    if (target.getAttribute('aria-checked') !== 'true') target.click();
    return;
  }
  if (question.kind === 'checkbox') {
    const boxes = [...item.querySelectorAll('[role="checkbox"]')];
    const labels = boxes.map(optionLabel);
    const wanted = new Set(choices.map(choice => matchOption(labels, choice)).filter(Boolean));
    if (!wanted.size) throw new Error('AuraSolve couldn\'t match its answer to a choice.');
    boxes.forEach((el, index) => {
      if ((el.getAttribute('aria-checked') === 'true') !== wanted.has(labels[index])) el.click();
    });
    return;
  }
  if (question.kind === 'dropdown') {
    const listbox = item.querySelector('[role="listbox"]');
    const options = () => [...item.querySelectorAll('[role="option"]')].filter(el => el.dataset.value);
    const pick = matchOption(options().map(el => clean(el.dataset.value)), choices[0]);
    if (!pick) throw new Error('AuraSolve couldn\'t match its answer to a choice.');
    listbox.click();
    await pause(350);
    const target = options().filter(el => clean(el.dataset.value) === pick).at(-1);
    target?.click();
    return;
  }
  const field = item.querySelector(question.kind === 'paragraph' ? 'textarea' : 'input[type="text"], input[type="email"], input[type="number"], input[type="url"], input:not([type])');
  if (!field || !clean(answer?.text)) throw new Error('AuraSolve didn\'t return an answer.');
  typeInto(field, String(answer.text).trim());
}

let tip = null;
function notice(message, {sticky = false} = {}) {
  tip?.remove();
  tip = document.createElement('div');
  tip.dataset.auraTip = '1';
  tip.textContent = message;
  Object.assign(tip.style, {position: 'fixed', right: '16px', bottom: '16px', zIndex: 2147483647, maxWidth: '320px', padding: '10px 14px', borderRadius: '10px', background: '#1d2433', color: '#fff', font: '13px/1.4 -apple-system,Segoe UI,sans-serif', boxShadow: '0 8px 24px rgba(0,0,0,.2)', pointerEvents: 'none'});
  document.documentElement.append(tip);
  const mine = tip;
  if (!sticky) setTimeout(() => mine.remove(), 4500);
}

async function answer(item) {
  if (busy.has(item)) return;
  busy.add(item);
  notice('AuraSolve is answering…', {sticky: true});
  try {
    item.scrollIntoView({block: 'center', inline: 'nearest'});
    await pause(120);
    const question = readQuestion(item);
    if (!question) { tip?.remove(); return; }
    const {answer: result} = await sendExtension({type: 'formSolve', question});
    await fill(item, question, result);
    getSelection()?.removeAllRanges();
    tip?.remove();
  } catch (error) {
    notice(error.message || 'AuraSolve couldn\'t answer that question.');
  } finally {
    busy.delete(item);
  }
}

export function questionFromSelection(selection, root = document) {
  if (!selectionLooksActive(selection)) return null;
  let range;
  try { range = selection.getRangeAt(0); } catch { return null; }
  if (!range || range.collapsed) return null;
  const node = range.commonAncestorContainer;
  const el = node.nodeType === 1 ? node : node.parentElement;
  const item = el?.closest?.('[role="listitem"]');
  if (!item || !root.contains(item)) return null;
  if (!item.contains(selection.anchorNode) || !item.contains(selection.focusNode)) return null;
  return item;
}

let timer = null;
function onSelect() {
  if (!enabled) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const selection = getSelection();
    if (!selectionLooksActive(selection)) return;
    const focus = document.activeElement;
    if (focus?.matches?.('input, textarea, [contenteditable="true"]') && focus.closest('[role="listitem"]')?.contains(selection.anchorNode)) return;
    const item = questionFromSelection(selection);
    if (!item) return;
    const key = `${selection.toString()}\0${item.querySelector('[role="heading"]')?.innerText || ''}`;
    if (key === lastKey) return;
    lastKey = key;
    answer(item);
  }, 220);
}

function showReady() {
  const pill = document.createElement('div');
  pill.dataset.auraTip = '1';
  pill.textContent = 'AuraSolve on · highlight text or double-click a question';
  Object.assign(pill.style, {position: 'fixed', left: '16px', bottom: '16px', zIndex: 2147483646, padding: '8px 12px', borderRadius: '999px', background: '#0666f5', color: '#fff', font: '600 12px/1.2 -apple-system,Segoe UI,sans-serif', boxShadow: '0 8px 24px rgba(6,102,245,.35)', pointerEvents: 'none'});
  document.documentElement.append(pill);
  setTimeout(() => pill.remove(), 12000);
}

function onDoubleClick(event) {
  if (!enabled) return;
  const item = event.target?.closest?.('[role="listitem"]');
  if (!item || event.target.closest?.('input, textarea, [role="radio"], [role="checkbox"], [role="listbox"], button, a')) return;
  if (item.querySelector('[role="heading"]')?.contains(event.target) || event.target.closest?.('[role="heading"]')) {
    lastKey = '';
    answer(item);
  }
}

export async function startForms() {
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'overlayChanged' && message.settings) enabled = message.settings.formsHighlight !== false;
  });
  document.addEventListener('mouseup', onSelect, true);
  document.addEventListener('pointerup', onSelect, true);
  document.addEventListener('selectionchange', onSelect);
  document.addEventListener('dblclick', onDoubleClick, true);
  document.addEventListener('keyup', event => { if (event.key === 'Shift' || event.shiftKey) onSelect(); }, true);
  showReady();
  try { enabled = (await fetchOverlay()).formsHighlight !== false; }
  catch { enabled = true; }
  if (!enabled) tip?.remove();
}
