import {fingerprint} from "../shared/policy.js";
const ids = new WeakMap(), elements = new Map();
let sequence = 0, selected = null;
export const visible = el => Boolean(el?.isConnected && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" && !el.closest('[aria-hidden="true"], [hidden], #aurasolve-root'));
export function idFor(el) {
  if (!ids.has(el)) { const id = `a${++sequence}`; ids.set(el,id); elements.set(id,el); }
  return ids.get(el);
}
export const elementFor = id => elements.get(id);
const clean = value => String(value || "").replace(/\s+/g," ").trim();
const editorSelector = '[data-aura-editor], .mq-editable-field, .mathquill-editable, span.eqEditor.inputField, span.eqEditor[widgetid]';
const fieldSelector = 'input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], [data-aura-editor], [data-aura-graph], [data-aura-draggable]';
export function labelFor(el) {
  const editable = el.isContentEditable || el.matches?.('[data-aura-editor]');
  return clean(el.getAttribute("aria-label") || [...(el.labels || [])].map(l=>l.innerText).join(" ") || el.getAttribute("placeholder") || el.getAttribute("title") || (!editable && el.innerText) || el.name || el.id || 'Answer').slice(0,350);
}
// Pearson's split player puts the prompt in #top and the inputs in #bottom.
// Read their common layout container, not either panel separately.
const rootSelector = '[data-aura-question], [data-testid="question"], [id^="xl_player_layout_TopBottomLayout_"], .question-content, #questionContent, #question-content, .questionContainer, .question-container, #problem, .problem-content';
export function questionRoot() {
  const active = selected && elementFor(selected);
  const nearest = active?.closest(rootSelector);
  if (nearest && visible(nearest)) return nearest;
  const matches = [...document.querySelectorAll(rootSelector)].filter(visible);
  const roots = matches.filter(el=>!matches.some(parent=>parent!==el && parent.contains?.(el)));
  if (roots.length === 1) return roots[0];
  return roots.length ? null : fallbackRoot(active);
}
// Sites without a known layout: use the smallest container holding every visible answer control plus some prompt text.
function fallbackRoot(active) {
  const fields = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"], input[type="text"], input[type="number"], input:not([type]), textarea, select, [contenteditable="true"]')]
    .filter(el => visible(el) && !el.closest('nav, header, footer, [role="navigation"], [role="search"], form[action*="search" i]') &&
      !/search|login|user ?name|email|password/i.test([el.type, el.name, el.id, el.placeholder, el.getAttribute('aria-label')].join(" ")));
  if (!fields.length) return document.querySelector('main, [role="main"]') || document.body;
  const anchor = active && fields.includes(active) ? active : fields[0];
  let node = anchor.parentElement;
  while (node && node !== document.body && !fields.every(f => node.contains(f))) node = node.parentElement;
  while (node && node !== document.body && clean(node.innerText).length < 40) node = node.parentElement;
  return node && node !== document.documentElement ? node : null;
}
export const isFallback = root => Boolean(root?.matches && !root.matches(rootSelector));
export function trackSelection() {
  const remember = event => {
    if (event.composedPath().some(el=>el?.id === "aurasolve-root")) return;
    const editor = event.target.closest?.(editorSelector);
    const el = editor?.matches('[data-aura-editor]') ? editor : event.target.closest?.(fieldSelector) || editor;
    if (el) selected = idFor(el);
  };
  document.addEventListener("focusin",remember,true);
  document.addEventListener("pointerdown",remember,true);
}
export async function prepareField() {
  let current=snapshot();
  if (current.fields.length) return {ready:true};
  // Some Pearson editors create the native input only after activation.
  // Activate only an answer widget inside the detected question.
  const root=questionRoot();
  const widgets=root ? [...root.querySelectorAll('span.eqEditor.inputField, span.eqEditor[widgetid], .acctable .inputcell[role="textbox"]')].filter(el=>visible(el) && !el.disabled && el.getAttribute('aria-disabled')!=='true' && !el.classList.contains('disabled')) : [];
  if (widgets.length) {
    widgets[0].focus?.();widgets[0].click();
    await new Promise(resolve=>setTimeout(resolve,120));
    current=snapshot();
  }
  return {ready:current.fields.length>0};
}
export function context() {
  const labels = [...document.querySelectorAll('h1, h2, [role="heading"], .assignment-title, #assignmentTitle, .breadcrumb, [data-activity-type], [data-graded]')].filter(visible).map(el=>clean(el.innerText || el.getAttribute('data-activity-type')));
  if (document.querySelector('[data-graded="true"]')) labels.push("graded");
  return `${location.pathname} ${document.title} ${labels.join(" ")}`.slice(0,6000);
}
export function snapshot() {
  for (const [id,el] of elements) if (!el.isConnected) elements.delete(id);
  const root = questionRoot();
  const fields = [], limitations = [];
  if (root) for (const el of root.querySelectorAll(fieldSelector)) {
    if (!visible(el) || el.disabled || el.readOnly || el.getAttribute('aria-disabled') === 'true') continue;
    const editor = el.closest?.(editorSelector);
    if (editor && editor !== el) {
      if (editor.matches('[data-aura-editor]')) continue;
      // Hidden MathQuill textareas are keyboard proxies, not answer values.
      if (editor.matches('.mq-editable-field, .mathquill-editable')) {limitations.push('This math editor has no accessible value API.');continue;}
    }
    if (el.isContentEditable && el.parentElement?.closest('[contenteditable="true"], [contenteditable="plaintext-only"]')) continue;
    const base = {id:idFor(el),label:labelFor(el)};
    if (el.matches('[data-aura-editor]')) fields.push({...base,kind:'text',adapter:el.dataset.auraEditor,editorKey:el.dataset.auraEditorKey,format:el.dataset.auraEditor === 'mathquill' ? 'latex' : 'plain'});
    else if (el.matches('[data-aura-graph]')) {
      const bounds = Object.fromEntries(["xMin","xMax","yMin","yMax"].map(key=>[key,Number(el.dataset[key])]));
      if (el.dataset.auraGraph === "point" && Object.values(bounds).every(Number.isFinite) && bounds.xMin < bounds.xMax && bounds.yMin < bounds.yMax) fields.push({...base,kind:"point",bounds});
      else limitations.push("Graph control has no supported coordinate adapter.");
    } else if (el.matches('[data-aura-draggable]')) fields.push({...base,kind:"drag"});
    else if (el.tagName === "SELECT" && !el.multiple) fields.push({...base,kind:"select",options:[...el.options].map(o=>({value:o.value,label:o.text,disabled:o.disabled}))});
    else if (el.type === "radio") fields.push({...base,kind:"radio",group:el.name || base.id});
    else if (el.type === "checkbox") fields.push({...base,kind:"checkbox"});
    else if (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && ["text","number",""].includes(el.type))) fields.push({...base,kind:"text"});
    else if (el.isContentEditable) fields.push({...base,kind:'text',adapter:'contenteditable',format:'plain'});
  }
  if (root) for (const el of root.querySelectorAll('span.eqEditor.inputField, span.eqEditor[widgetid], .mq-editable-field, .mathquill-editable, .acctable .inputcell[role="textbox"]')) {
    if (visible(el) && !el.matches('[data-aura-editor]') && !fields.some(f=>el===elementFor(f.id) || el.contains(elementFor(f.id)))) limitations.push('A Pearson math or table field needs a supported editor API.');
  }
  const drops = root ? [...root.querySelectorAll('[data-aura-drop]')].filter(visible).map(el=>({id:idFor(el),label:labelFor(el)})) : [];
  if (root?.querySelector('canvas, svg:not([data-aura-graph])') && !fields.some(f=>f.kind === 'point')) limitations.push("Canvas/SVG content is not read visually; complex graph actions are unsupported.");
  if (root?.querySelector('img:not([alt]), img[alt=""]')) limitations.push("An image has no description; the model may not have enough information.");
  const readable = root?.cloneNode?.(true);
  readable?.querySelectorAll('[contenteditable], [data-aura-editor], textarea').forEach(el=>{el.textContent='';});
  const question = root ? clean((readable ? readable.textContent : root.innerText) + " " + [...root.querySelectorAll('math, img[alt], [aria-label]')].filter(el=>!el.closest?.('[data-aura-editor]')).map(el=>el.getAttribute('alt') || el.getAttribute('aria-label') || el.textContent).join(" ")).slice(0,16000) : "";
  const hash = fingerprint(JSON.stringify({question,fields,drops}));
  const prompt = root?.cloneNode?.(true);
  prompt?.querySelectorAll('input, textarea, select, [contenteditable], [data-aura-editor], [role="textbox"], [role="alert"], [data-aura-feedback], .feedback, .answer-feedback').forEach(el=>el.remove());
  const promptHash = fingerprint(clean(prompt?.textContent || question));
  const visual = Boolean(root?.querySelector('img, svg, canvas, figure') || /\b(figure|diagram|graph|picture|image|shown)\b/i.test(question));
  const box = root?.getBoundingClientRect?.();
  const selectedElement = elementFor(selected);
  const chosen = fields.find(f=>f.id === selected) || fields.find(f=>elementFor(f.id)?.contains?.(selectedElement));
  const scalar=fields.filter(f=>['text','select','point','drag'].includes(f.kind));
  const empty=scalar.find(f=>{const el=elementFor(f.id);return !(el.value ?? (el.isContentEditable ? el.textContent : '')).trim();});
  const autoSelected=(empty || scalar[0])?.id || null;
  return {url:location.href,context:context(),question,fields,dropTargets:drops,selected:chosen?.id || autoSelected,hash,limitations:[...new Set(limitations)],controls:{submit:findButtons('submit').length,next:findButtons('next').length},
    fallback:isFallback(root),promptHash,visual,rect:box?{x:box.left,y:box.top,width:box.width,height:box.height}:null,viewport:globalThis.innerWidth || 0,
    problemCount:[...document.querySelectorAll(rootSelector)].filter(visible).length};
}
export function feedback() {
  const nodes = [...document.querySelectorAll('[data-aura-feedback], .feedback, .answer-feedback, [role="alert"], .feedbackDialog, .correctDialog, .responses, .xlFeedback')].filter(visible);
  const text = clean(nodes.map(el=>el.innerText).join(" "));
  if (/\b(incorrect|wrong|try again|not correct)\b/i.test(text)) return {state:"incorrect",text};
  if (/\b(correct|well done|great job)\b/i.test(text)) return {state:"correct",text};
  return {state:"unknown",text};
}
export function findButtons(kind) {
  const patterns = kind === "submit" ? /^(check answer|check my answer|submit answer|submit|check)$/i : /^(next|next question|next problem|continue)$/i;
  const command = kind === 'submit' ? 'checkanswer' : 'next';
  return [...document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')].filter(el=>visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && (el.getAttribute('command')?.toLowerCase() === command || patterns.test(clean(el.innerText || el.value || el.getAttribute('aria-label')))));
}
export function findButton(kind) {
  const buttons = findButtons(kind);
  if (buttons.length !== 1) throw new Error(`Could not identify exactly one ${kind} button. Continue manually.`);
  return buttons[0];
}

