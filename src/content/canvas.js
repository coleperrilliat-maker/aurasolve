import {sendExtension} from '../shared/messaging.js';
import {matchOption, selectionLooksActive} from '../shared/form-answer.js';
import {asFormAnswer, createQuizCache} from './quiz-cache.js';

// Canvas classic quizzes: highlight a question and fill its radios, checkboxes,
// dropdowns, or text boxes. No on-page button, and nothing scrolls the page.
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const busy = new WeakSet();
let lastKey = '';
let highlight = false;

const QUESTION = '.question_holder, .display_question, .question';
const cache = createQuizCache();
const nodes = new Map();
let primed = false;
let tries = 0;

export function questionRoots() {
  const holders = [...document.querySelectorAll('.question_holder')];
  if (holders.length) return holders;
  const named = [...document.querySelectorAll('[name^="question_"]')];
  const seen = new Set();
  const roots = [];
  for (const el of named) {
    const id = el.name?.match(/question_\d+/)?.[0];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    roots.push(el.closest('.question_holder, .display_question, .question') || el.parentElement);
  }
  return roots.filter(Boolean);
}

export function questionBlock(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  return el?.closest?.('.question_holder') || el?.closest?.(QUESTION) || null;
}

function choiceText(input) {
  const label = input.id ? input.ownerDocument?.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
  return clean(label?.innerText || input.closest('.answer, .answer_group')?.innerText || input.getAttribute('aria-label') || '');
}

function selectOptions(select) {
  return [...select.options].map(option => clean(option.text || option.value)).filter(value => value && !/^(select|\[ select \])$/i.test(value));
}

function selectLabel(select, index) {
  let text = '';
  let node = select.previousSibling;
  for (let hops = 0; node && hops < 4 && text.length < 80; hops++, node = node.previousSibling) text = `${node.textContent || ''}${text}`;
  return clean(text) || clean(select.getAttribute('aria-label')) || `Dropdown ${index + 1}`;
}

function textFields(root) {
  // Short-answer boxes live inside .answers. Only skip a text field that is
  // sitting in a multiple-choice row next to a radio or checkbox.
  return [...root.querySelectorAll('input.question_input, input[type="text"], input[type="number"], input:not([type]), textarea')].filter(el => {
    const type = String(el.type || '').toLowerCase();
    if (['radio', 'checkbox', 'hidden', 'button', 'submit', 'file', 'image'].includes(type)) return false;
    const choice = el.closest('.answer');
    if (choice?.querySelector('input[type="radio"], input[type="checkbox"]')) return false;
    return true;
  });
}

export function readCanvas(root) {
  const title = clean(root.querySelector('.question_text, .question_text.user_content')?.innerText || root.innerText).slice(0, 4000);
  if (!title) return null;
  const usable = el => el && el.type !== 'hidden' && !el.closest('[hidden]');
  const radios = [...root.querySelectorAll('input[type="radio"]')].filter(usable);
  const boxes = [...root.querySelectorAll('input[type="checkbox"]')].filter(usable);
  const selects = [...root.querySelectorAll('select')].filter(el => usable(el) && selectOptions(el).length);
  const texts = textFields(root);
  const rect = root.getBoundingClientRect();
  const base = {
    title,
    description: '',
    fullTab: false,
    rect: {x: Math.max(0, rect.left), y: Math.max(0, rect.top), width: Math.max(40, rect.width), height: Math.max(40, rect.height)},
    devicePixelRatio: globalThis.devicePixelRatio || 1,
    images: [],
    rows: [],
  };
  if (radios.length) return {...base, kind: 'radio', options: radios.map(choiceText), controls: radios};
  if (boxes.length) return {...base, kind: 'checkbox', options: boxes.map(choiceText), controls: boxes};
  if (selects.length) return {...base, kind: 'dropdown', options: [], controls: selects};
  if (texts.length) return {...base, kind: texts.some(el => el.tagName === 'TEXTAREA') && texts.length === 1 ? 'paragraph' : 'text', options: [], controls: texts};
  return null;
}

function typeInto(el, value) {
  el.focus({preventScroll: true});
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  setter ? setter.call(el, value) : (el.value = value);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
  el.blur();
}

function setChecked(input, on) {
  if (input.checked === on) return;
  input.click();
  if (input.checked !== on) {
    input.checked = on;
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
  }
}

function chooseSelect(select, wanted) {
  const options = [...select.options];
  const labels = options.map(option => clean(option.text || option.value));
  const pick = matchOption(labels, wanted);
  const option = options.find((item, index) => labels[index] === pick);
  if (!option) throw new Error('AuraSolve couldn\'t match its answer to a dropdown.');
  select.value = option.value;
  select.dispatchEvent(new Event('input', {bubbles: true}));
  select.dispatchEvent(new Event('change', {bubbles: true}));
}

async function solveOne(question) {
  const {answer} = await sendExtension({type: 'formSolve', question});
  return answer || {};
}

function pack(id, read) {
  if (read.kind === 'dropdown' && read.controls.length) {
    return {id, kind: 'dropdowns', title: read.title, options: [], blanks: read.controls.map((select, index) => ({label: selectLabel(select, index), options: selectOptions(select)}))};
  }
  if (read.kind === 'text' || read.kind === 'paragraph') {
    return {id, kind: read.kind, title: read.title, options: [], blanks: read.controls.map((_, index) => ({label: read.controls.length === 1 ? 'Answer' : `Blank ${index + 1}`, options: []}))};
  }
  return {id, kind: read.kind, title: read.title, options: read.options || [], blanks: []};
}

function collect() {
  nodes.clear();
  const payload = [];
  questionRoots().forEach((root, index) => {
    const read = readCanvas(root);
    if (!read) return;
    const id = root.id || `c${index}`;
    nodes.set(id, root);
    payload.push(pack(id, read));
  });
  return payload;
}

function prime() {
  if (primed || !highlight) return;
  const questions = collect();
  if (!questions.length && tries++ < 8) { setTimeout(prime, 400); return; }
  if (!questions.length) return;
  primed = true;
  cache.prime(questions);
}

function idFor(root) {
  for (const [id, node] of nodes) if (node === root) return id;
  return null;
}

async function answer(root) {
  if (busy.has(root)) return;
  busy.add(root);
  try {
    const read = readCanvas(root);
    if (!read) return;
    const {controls, ...question} = read;
    const cached = await cache.get(idFor(root) || '');
    if (question.kind === 'radio' || question.kind === 'checkbox') {
      const result = cached ? asFormAnswer(cached) : await solveOne(question);
      const choices = Array.isArray(result.choices) ? result.choices : [];
      const labels = controls.map(choiceText);
      if (question.kind === 'radio') {
        const pick = matchOption(labels, choices[0]);
        const target = controls.find((el, index) => labels[index] === pick);
        if (!target) throw new Error('AuraSolve couldn\'t match its answer to a choice.');
        setChecked(target, true);
      } else {
        const wanted = new Set(choices.map(choice => matchOption(labels, choice)).filter(Boolean));
        if (!wanted.size) throw new Error('AuraSolve couldn\'t match its answer to a choice.');
        controls.forEach((el, index) => setChecked(el, wanted.has(labels[index])));
      }
    } else if (question.kind === 'dropdown') {
      const blanks = cached?.blanks || [];
      for (let index = 0; index < controls.length; index++) {
        const select = controls[index];
        const options = selectOptions(select);
        const picked = blanks[index] || (controls.length === 1 ? cached?.choices?.[0] : '');
        const result = picked ? {choices: [picked]} : await solveOne({
          ...question,
          kind: 'dropdown',
          title: `${question.title}\nFill only this dropdown: ${selectLabel(select, index)}`,
          options,
        });
        chooseSelect(select, result.choices?.[0]);
        await pause(40);
      }
    } else {
      const blanks = cached?.blanks || [];
      for (let index = 0; index < controls.length; index++) {
        const text = blanks[index] || (index === 0 ? (cached?.text || cached?.choices?.[0]) : '');
        const result = text ? {text} : await solveOne({
          ...question,
          title: controls.length === 1 ? question.title : `${question.title}\nAnswer only blank ${index + 1} of ${controls.length}.`,
        });
        if (!clean(result.text)) throw new Error('AuraSolve didn\'t return an answer.');
        typeInto(controls[index], String(result.text).trim());
      }
    }
    getSelection()?.removeAllRanges();
  } catch (error) {
    console.warn('AuraSolve:', error.message);
  } finally {
    busy.delete(root);
    lastKey = '';
  }
}

let timer = null;
function onSelect() {
  if (!highlight) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const selection = getSelection();
    if (!selectionLooksActive(selection)) return;
    const node = selection.anchorNode;
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    if (!el || el.closest('input, textarea, select')) return;
    const root = questionBlock(node);
    if (!root || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return;
    const key = `${selection.toString()}\0${clean(root.querySelector('.question_text')?.innerText).slice(0, 180)}`;
    if (key === lastKey) return;
    lastKey = key;
    answer(root);
  }, 220);
}

export function startCanvas() {
  globalThis.__auraCanvasStop?.();
  let href = location.href;
  const drop = () => { if (location.href === href) return; href = location.href; highlight = false; };
  const onMessage = message => {
    if (message?.type !== 'highlightChanged') return;
    highlight = Boolean(message.on);
    if (highlight) prime();
  };
  sendExtension({type: 'highlightHere'}).then(data => {
    highlight = Boolean(data?.on);
    if (highlight) prime();
  }).catch(() => {});
  window.addEventListener('hashchange', drop);
  window.addEventListener('popstate', drop);
  const keyup = event => { if (event.key === 'Shift' || event.shiftKey) onSelect(); };
  document.addEventListener('mouseup', onSelect, true);
  document.addEventListener('pointerup', onSelect, true);
  document.addEventListener('selectionchange', onSelect);
  document.addEventListener('keyup', keyup, true);
  try { chrome.runtime.onMessage.addListener(onMessage); } catch {}
  globalThis.__auraCanvasStop = () => {
    document.removeEventListener('mouseup', onSelect, true);
    document.removeEventListener('pointerup', onSelect, true);
    document.removeEventListener('selectionchange', onSelect);
    document.removeEventListener('keyup', keyup, true);
    window.removeEventListener('hashchange', drop);
    window.removeEventListener('popstate', drop);
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch {}
  };
}
