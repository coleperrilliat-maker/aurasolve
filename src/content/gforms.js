import {sendExtension} from '../shared/messaging.js';
import {fetchOverlay} from '../shared/overlay.js';
import {matchOption, selectionLooksActive, classifyFormControls, parseFormDate, parseFormTime} from '../shared/form-answer.js';

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

const TEXT_FIELD = 'input[type="text"], input[type="email"], input[type="number"], input[type="url"], input:not([type])';

// Checkbox choices are their own nested role="listitem", so the question is
// the nearest listitem that has a heading, not simply the closest one.
export function questionItem(node) {
  let el = node?.nodeType === 1 ? node : node?.parentElement;
  let found = null;
  while (el) {
    const item = el.closest?.('[role="listitem"]');
    if (!item) break;
    found = found || item;
    if (item.querySelector('[role="heading"]')) return item;
    el = item.parentElement;
  }
  return found;
}

function rowLabel(group, index) {
  return clean(group.getAttribute('aria-label') || group.querySelector('[role="presentation"], div')?.innerText) || `Row ${index + 1}`;
}

function gridGroups(item) {
  const radios = [...item.querySelectorAll('[role="radiogroup"]')];
  if (radios.length > 1) return {multi: false, groups: radios, control: '[role="radio"]'};
  const boxes = [...item.querySelectorAll('[role="group"]')].filter(group => group.querySelector('[role="checkbox"]'));
  if (boxes.length > 1) return {multi: true, groups: boxes, control: '[role="checkbox"]'};
  return null;
}

function dateFields(item) {
  const native = item.querySelector('input[type="date"]');
  const part = pattern => [...item.querySelectorAll('input')].find(el => pattern.test(el.getAttribute('aria-label') || ''));
  return {native, month: part(/month/i), day: part(/day/i), year: part(/year/i)};
}

function timeFields(item) {
  const part = pattern => [...item.querySelectorAll('input')].find(el => pattern.test(el.getAttribute('aria-label') || ''));
  return {native: item.querySelector('input[type="time"]'), hour: part(/hour/i), minute: part(/minute/i), meridiem: item.querySelector('[role="listbox"]')};
}

function questionImages(item) {
  const seen = new Set(), out = [];
  let count = 0;
  for (const img of item.querySelectorAll('img')) {
    const src = img.currentSrc || img.src || img.dataset.src || '';
    if (!/^https?:/.test(src) || seen.has(src) || out.length >= 10) continue;
    if (img.naturalWidth && img.naturalWidth < 16 && img.naturalHeight < 16) continue;
    seen.add(src);
    const control = img.closest('label')?.querySelector('[role="radio"], [role="checkbox"]');
    out.push({label: control ? `Picture for option "${optionLabel(control)}"` : `Question image ${++count}`, src});
  }
  return out;
}

export function readQuestion(item) {
  const title = clean(item.querySelector('[role="heading"]')?.innerText).replace(/\s*\*$/, '');
  const description = clean(item.querySelector('[role="heading"]')?.parentElement?.nextElementSibling?.innerText);
  const radios = [...item.querySelectorAll('[role="radio"]')];
  const boxes = [...item.querySelectorAll('[role="checkbox"]')];
  const listbox = item.querySelector('[role="listbox"]');
  const date = dateFields(item);
  const time = timeFields(item);
  const isDate = Boolean(date.native || (date.month && date.day) || (date.year && date.month));
  const isTime = Boolean(time.native || (time.hour && time.minute));
  const text = item.querySelector(TEXT_FIELD);
  const area = item.querySelector('textarea');
  const grid = gridGroups(item);
  const images = questionImages(item);
  const classified = classifyFormControls({
    title,
    radios: radios.map(optionLabel),
    boxes: boxes.map(optionLabel),
    listbox: listbox && !isTime ? [...listbox.querySelectorAll('[role="option"]')].map(el => clean(el.dataset.value)).filter(Boolean) : [],
    text: Boolean(text),
    area: Boolean(area),
    radiogroups: item.querySelectorAll('[role="radiogroup"]').length,
    grid: grid && {multi: grid.multi, rows: grid.groups.map(rowLabel), columns: [...grid.groups[0].querySelectorAll(grid.control)].map(optionLabel)},
    date: isDate,
    time: isTime,
    images: images.length,
  });
  if (!classified) return null;
  const {kind, options, rows} = classified;
  const rect = item.getBoundingClientRect();
  // Never read window.top geometry here. In a cross-origin LMS iframe that
  // throws a SecurityError and used to abort every highlight.
  return {
    kind, title: classified.title, description, options, rows, images,
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
  if (question.kind === 'grid' || question.kind === 'checkgrid') {
    const grid = gridGroups(item);
    const rows = Array.isArray(answer?.rows) ? answer.rows : [];
    if (!grid || !rows.length) throw new Error('AuraSolve didn\'t return an answer.');
    const labels = grid.groups.map(rowLabel);
    for (const entry of rows) {
      const group = grid.groups[labels.indexOf(matchOption(labels, entry?.row))];
      if (!group) continue;
      const cells = [...group.querySelectorAll(grid.control)];
      const names = cells.map(optionLabel);
      const wanted = new Set((entry.choices || []).map(choice => matchOption(names, choice)).filter(Boolean));
      cells.forEach((cell, index) => {
        const on = cell.getAttribute('aria-checked') === 'true';
        if (grid.multi ? on !== wanted.has(names[index]) : (!on && wanted.has(names[index]))) cell.click();
      });
    }
    return;
  }
  if (question.kind === 'date') {
    const date = parseFormDate(answer?.text);
    if (!date) throw new Error('AuraSolve didn\'t return a date.');
    const fields = dateFields(item);
    if (fields.native) { typeInto(fields.native, date.iso); return; }
    if (fields.month) typeInto(fields.month, String(date.month).padStart(2, '0'));
    if (fields.day) typeInto(fields.day, String(date.day).padStart(2, '0'));
    if (fields.year) typeInto(fields.year, String(date.year));
    return;
  }
  if (question.kind === 'time') {
    const time = parseFormTime(answer?.text);
    if (!time) throw new Error('AuraSolve didn\'t return a time.');
    const fields = timeFields(item);
    const minute = String(time.minute).padStart(2, '0');
    if (fields.native) { typeInto(fields.native, `${String(time.hour).padStart(2, '0')}:${minute}`); return; }
    typeInto(fields.hour, String(fields.meridiem ? time.hour12 : time.hour).padStart(2, '0'));
    typeInto(fields.minute, minute);
    if (fields.meridiem) {
      fields.meridiem.click();
      await pause(350);
      const wanted = time.pm ? /^p/i : /^a/i;
      [...item.querySelectorAll('[role="option"]')].filter(el => wanted.test(clean(el.dataset.value || el.innerText))).at(-1)?.click();
    }
    return;
  }
  const field = item.querySelector(question.kind === 'paragraph' ? 'textarea' : TEXT_FIELD);
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
  const item = questionItem(node);
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
    if (focus?.matches?.('input, textarea, [contenteditable="true"]') && questionItem(focus)?.contains(selection.anchorNode)) return;
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
  const item = questionItem(event.target);
  if (!item || event.target.closest?.('input, textarea, [role="radio"], [role="checkbox"], [role="listbox"], button, a')) return;
  // Image-only questions have no title text to highlight, so double-clicking
  // the question's own picture or heading works too.
  const picture = event.target.tagName === 'IMG' && !event.target.closest('label');
  if (picture || item.querySelector('[role="heading"]')?.contains(event.target) || event.target.closest?.('[role="heading"]')) {
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
