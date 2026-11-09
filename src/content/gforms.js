import {sendExtension} from '../shared/messaging.js';
import {fetchOverlay} from '../shared/overlay.js';
import {matchOption} from '../shared/form-answer.js';

// Google Forms: highlight any text in a question and AuraSolve answers that
// whole question in place. There is no on-page button.
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const busy = new WeakSet();
let enabled = true;

function readQuestion(item) {
  const title = clean(item.querySelector('[role="heading"]')?.innerText).replace(/\s*\*$/, '');
  const description = clean(item.querySelector('[role="heading"]')?.parentElement?.nextElementSibling?.innerText);
  const radios = [...item.querySelectorAll('[role="radio"]')];
  const boxes = [...item.querySelectorAll('[role="checkbox"]')];
  const listbox = item.querySelector('[role="listbox"]');
  const text = item.querySelector('input[type="text"], input[type="email"], input[type="number"], input[type="url"], input:not([type])');
  const area = item.querySelector('textarea');
  // Grids put several radio rows in one question; those aren't handled yet.
  if (item.querySelectorAll('[role="radiogroup"], [role="group"]').length > 1) return null;
  let kind = null, options = [];
  if (radios.length) { kind = 'radio'; options = radios.map(el => el.dataset.value ?? el.getAttribute('aria-label')); }
  else if (boxes.length) { kind = 'checkbox'; options = boxes.map(el => el.dataset.answerValue ?? el.getAttribute('aria-label')); }
  else if (listbox) { kind = 'dropdown'; options = [...listbox.querySelectorAll('[role="option"]')].map(el => el.dataset.value).filter(Boolean); }
  else if (area) kind = 'paragraph';
  else if (text) kind = 'text';
  if (!kind || !title) return null;
  options = options.map(clean).filter(value => value && !/^(choose|other:?)$/i.test(value));
  const rect = item.getBoundingClientRect();
  const hasImage = [...item.querySelectorAll('img')].some(img => img.naturalWidth > 60 && img.getBoundingClientRect().width > 40);
  return {
    kind, title, description, options, hasImage,
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

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fill(item, question, answer) {
  const choices = Array.isArray(answer?.choices) ? answer.choices : [];
  if (question.kind === 'radio') {
    const radios = [...item.querySelectorAll('[role="radio"]')];
    const pick = matchOption(radios.map(el => clean(el.dataset.value ?? el.getAttribute('aria-label'))), choices[0]);
    const target = radios.find(el => clean(el.dataset.value ?? el.getAttribute('aria-label')) === pick);
    if (!target) throw new Error('AuraSolve couldn\'t match its answer to a choice.');
    if (target.getAttribute('aria-checked') !== 'true') target.click();
    return;
  }
  if (question.kind === 'checkbox') {
    const boxes = [...item.querySelectorAll('[role="checkbox"]')];
    const labels = boxes.map(el => clean(el.dataset.answerValue ?? el.getAttribute('aria-label')));
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
  const question = readQuestion(item);
  if (!question) return;
  busy.add(item);
  try {
    const {answer: result} = await sendExtension({type: 'formSolve', question});
    await fill(item, question, result);
    getSelection()?.removeAllRanges();
  } catch (error) {
    notice(error.message || 'AuraSolve couldn\'t answer that question.');
  } finally {
    busy.delete(item);
  }
}

let timer = null;
function onSelect(event) {
  if (!enabled) return;
  if (event.target?.closest?.('input, textarea, [role="listbox"]')) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !clean(selection.toString())) return;
    const node = selection.anchorNode?.nodeType === 1 ? selection.anchorNode : selection.anchorNode?.parentElement;
    const item = node?.closest?.('[role="listitem"]');
    if (item && item.contains(selection.focusNode)) answer(item);
  }, 250);
}

export async function startForms() {
  enabled = (await fetchOverlay()).formsHighlight;
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'overlayChanged' && message.settings) enabled = message.settings.formsHighlight !== false;
  });
  document.addEventListener('mouseup', onSelect, true);
  document.addEventListener('keyup', event => { if (event.shiftKey) onSelect(event); }, true);
}
