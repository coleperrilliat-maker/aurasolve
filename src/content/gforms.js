import {sendExtension} from '../shared/messaging.js';
import {fetchOverlay} from '../shared/overlay.js';
import {matchOption, selectionLooksActive, classifyFormControls} from '../shared/form-answer.js';

// Google Forms: highlight anything in a question (even a space between words)
// and AuraSolve answers that whole question. No on-page button.
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const busy = new WeakSet();
let enabled = true;

function optionLabel(el) {
  return clean(el.dataset.value ?? el.dataset.answerValue ?? el.getAttribute('aria-label') ?? el.innerText);
}

function hasVisual(item) {
  if ([...item.querySelectorAll('img, picture, canvas, svg, video')].some(el => {
    const box = el.getBoundingClientRect();
    return box.width > 40 && box.height > 40;
  })) return true;
  return [...item.querySelectorAll('*')].some(el => {
    try {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === 'none') return false;
      const box = el.getBoundingClientRect();
      return /url\(/i.test(bg) && box.width > 40 && box.height > 40;
    } catch { return false; }
  });
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
  return {
    kind, title, description, options,
    // Always send a crop. Diagrams are often the only way to answer, and Google
    // Forms sometimes hides the <img> until it's on screen.
    hasImage: true,
    visual: hasVisual(item),
    rect: {x: Math.max(0, rect.left), y: Math.max(0, rect.top), width: Math.min(innerWidth, rect.right) - Math.max(0, rect.left), height: Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)},
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
function notice(message) {
  tip?.remove();
  tip = document.createElement('div');
  tip.textContent = message;
  Object.assign(tip.style, {position: 'fixed', right: '16px', bottom: '16px', zIndex: 2147483647, maxWidth: '320px', padding: '10px 14px', borderRadius: '10px', background: '#1d2433', color: '#fff', font: '13px/1.4 -apple-system,Segoe UI,sans-serif', boxShadow: '0 8px 24px rgba(0,0,0,.2)'});
  document.documentElement.append(tip);
  const mine = tip;
  setTimeout(() => mine.remove(), 4500);
}

async function answer(item) {
  if (busy.has(item)) return;
  busy.add(item);
  try {
    item.scrollIntoView({block: 'center', inline: 'nearest'});
    await pause(120);
    const question = readQuestion(item);
    if (!question) return;
    const {answer: result} = await sendExtension({type: 'formSolve', question});
    await fill(item, question, result);
    getSelection()?.removeAllRanges();
  } catch (error) {
    notice(error.message || 'AuraSolve couldn\'t answer that question.');
  } finally {
    busy.delete(item);
  }
}

// A space between words is a real selection even though trim() makes it empty.
export function questionFromSelection(selection, root = document) {
  if (!selectionLooksActive(selection)) return null;
  const range = selection.getRangeAt(0);
  if (!range || range.collapsed) return null;
  const node = range.commonAncestorContainer;
  const el = node.nodeType === 1 ? node : node.parentElement;
  const item = el?.closest?.('[role="listitem"]');
  if (!item || !root.contains(item)) return null;
  // The highlight must live inside this question, not across two of them.
  if (!item.contains(selection.anchorNode) || !item.contains(selection.focusNode)) return null;
  return item;
}

let timer = null;
function onSelect(event) {
  if (!enabled) return;
  if (event.target?.closest?.('input, textarea, [role="listbox"], [contenteditable="true"]')) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const item = questionFromSelection(getSelection());
    if (item) answer(item);
  }, 180);
}

export async function startForms() {
  enabled = (await fetchOverlay()).formsHighlight !== false;
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'overlayChanged' && message.settings) enabled = message.settings.formsHighlight !== false;
  });
  document.addEventListener('mouseup', onSelect, true);
  document.addEventListener('keyup', event => { if (event.key === 'Shift' || event.shiftKey) onSelect(event); }, true);
}
