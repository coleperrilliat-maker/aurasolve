import {readPlayer} from "./player.js";
import {controlKind} from "../shared/player-state.js";
import {saraChoices} from './sara.js';
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
const fieldSelector = 'input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], [data-aura-editor], [data-aura-graph], [data-aura-draggable], [role="radio"], [role="checkbox"]';
// Pearson leaves earlier parts' editor wrappers visible after disabling their inputs.
// Those are answer history, not unsupported controls for the current part.
export function writable(el) {
  const dropdown=['dojo-select','dom-select'].includes(el.dataset?.auraEditor);
  if (el.disabled || (!dropdown && (el.readOnly || el.getAttribute('readonly') !== null)) || el.getAttribute('disabled') !== null ||
      el.closest('[aria-disabled="true"], [aria-readonly="true"], fieldset[disabled], .eqEditor.disabled, .inputcell.disabled, .dijitDisabled')) return false;
  // A select's readonly text input is its display, not a locked answer.
  if(dropdown)return true;
  const inputs = [...(el.querySelectorAll?.('input:not([type="hidden"]), textarea, select') || [])];
  return !inputs.length || inputs.some(input => !input.disabled && !input.readOnly && !input.closest('[aria-disabled="true"], [aria-readonly="true"], fieldset[disabled]'));
}
export function fieldContext(el) {
  const row=el.closest('tr,[role="row"]');
  if(row){
    const table=row.closest('table,[role="table"],[role="grid"]');
    const headers=table?[...table.querySelectorAll('th,[role="columnheader"]')].map(cell=>clean(cell.textContent)).filter(Boolean).join(' | '):'';
    const cells=[...row.children].map(cell=>{
      const copy=cell.cloneNode(true);
      copy.querySelectorAll(fieldSelector).forEach(node=>node.replaceWith(document.createTextNode(' [answer] ')));
      return clean(copy.textContent);
    });
    const cell=el.closest('td,th,[role="cell"],[role="gridcell"]');
    return clean(`${headers?`Columns: ${headers}. `:''}Row: ${cells.join(' | ')}. This blank: column ${cell?[...row.children].indexOf(cell)+1:'unknown'}.`).slice(0,1000);
  }
  let parent=el.parentElement;
  for(let depth=0;parent && depth<3;depth++,parent=parent.parentElement){
    const copy=parent.cloneNode(true);
    copy.querySelectorAll('input,textarea,select,[contenteditable],[data-aura-editor],#aurasolve-root').forEach(node=>node.replaceWith(document.createTextNode(' [answer] ')));
    const text=clean(copy.textContent);
    if(text.length>=8)return text.slice(0,500);
  }
  return '';
}
export function labelFor(el) {
  const editable = el.isContentEditable || el.matches?.('[data-aura-editor]');
  const labelledBy=(el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent || '').join(' ').trim();
  return clean(el.getAttribute("aria-label") || labelledBy || [...(el.labels || [])].map(l=>l.innerText).join(" ") || el.getAttribute("placeholder") || el.getAttribute("title") || (!editable && el.innerText) || el.name || el.id || 'Answer').slice(0,350);
}
// Pearson's split player puts the prompt in #top and the inputs in #bottom.
// Read their common layout container, not either panel separately.
const rootSelector = '[data-aura-question], [data-testid="question"], div[id*="xl_player_layout"], .question-content, #questionContent, #question-content, .questionContainer, .question-container, #problem, .problem-content';
export function questionRoot() {
  const active = selected && elementFor(selected);
  const nearest = active?.closest(rootSelector);
  if (nearest && visible(nearest)) return nearest;
  const matches = [...document.querySelectorAll(rootSelector)].filter(visible);
  const roots = matches.filter(el=>!matches.some(parent=>parent!==el && parent.contains?.(el)));
  if (roots.length === 1) return roots[0];
  if (roots.length) return null;
  // Mastering's question body is separate from its navigation and toolbars.
  if (/(^|\.)(pearson\.com|mathxl\.com|mymathlab\.com)$/.test(location.hostname)) {
    const parts=[...document.querySelectorAll('.section > .bd')].filter(el=>visible(el) && el.querySelector(fieldSelector));
    if (parts.length===1) return parts[0];
  }
  return fallbackRoot(active);
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
  // Some Pearson editors create the native input only after activation.
  // Activate only an answer widget inside the detected question.
  const root=questionRoot();
  const widgets=root ? [...root.querySelectorAll('span.eqEditor.inputField, span.eqEditor[widgetid], .acctable .inputcell[role="textbox"]')].filter(el=>visible(el) && writable(el)) : [];
  const prior=document.activeElement;
  for (const widget of widgets) {
    if(widget.matches('[data-aura-editor]') || [...widget.querySelectorAll('input,textarea,[contenteditable]')].some(el=>visible(el) && writable(el)))continue;
    widget.focus?.();widget.click();
    for(let attempt=0;attempt<8;attempt++) {
      if([...widget.querySelectorAll('input,textarea,[contenteditable]')].some(el=>visible(el) && writable(el)))break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
  }
  prior?.focus?.({preventScroll:true});
  return {ready:snapshot().fields.length>0};
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
    if (!visible(el) || !writable(el)) continue;
    if(el.parentElement?.closest('[data-aura-editor]'))continue;
    const editor = el.closest?.('[data-aura-editor]') || el.closest?.(editorSelector);
    if (editor && editor !== el) {
      if (editor.matches('[data-aura-editor]')) continue;
      // Hidden MathQuill textareas are keyboard proxies, not answer values.
      if (editor.matches('.mq-editable-field, .mathquill-editable')) {limitations.push('This math editor has no accessible value API.');continue;}
    }
    if (el.isContentEditable && el.parentElement?.closest('[contenteditable="true"], [contenteditable="plaintext-only"]')) continue;
    const base = {id:idFor(el),label:labelFor(el),context:fieldContext(el)};
    if (['dojo-select','dom-select'].includes(el.dataset?.auraEditor)) {
      try {fields.push({...base,kind:'select',adapter:el.dataset.auraEditor,editorKey:el.dataset.auraEditorKey,options:JSON.parse(el.dataset.auraOptions)});} catch {limitations.push('Dropdown options could not be read.');}
    }
    else if (el.matches('[data-aura-editor]')) fields.push({...base,kind:'text',adapter:el.dataset.auraEditor,editorKey:el.dataset.auraEditorKey,format:el.dataset.auraEditor === 'mathquill' ? 'latex' : 'plain'});
    else if (el.matches('[data-aura-graph]')) {
      const bounds = Object.fromEntries(["xMin","xMax","yMin","yMax"].map(key=>[key,Number(el.dataset[key])]));
      if (el.dataset.auraGraph === "point" && Object.values(bounds).every(Number.isFinite) && bounds.xMin < bounds.xMax && bounds.yMin < bounds.yMax) fields.push({...base,kind:"point",bounds});
      else limitations.push("Graph control has no supported coordinate adapter.");
    } else if (el.matches('[data-aura-draggable]')) fields.push({...base,kind:"drag"});
    else if (el.tagName === "SELECT") fields.push({...base,kind:el.multiple?'multiselect':'select',options:[...el.options].map(o=>({value:o.value,label:o.text,disabled:o.disabled || Boolean(o.closest('optgroup[disabled]'))}))});
    else if (el.type === "radio" || el.getAttribute('role')==='radio') {
      if(el.querySelector?.('input[type="radio"]'))continue;
      const group=el.closest('[role="radiogroup"]');
      fields.push({...base,kind:'radio',group:group?idFor(group):`${el.form?idFor(el.form):'question'}:${el.name || base.id}`,...(el.type!=='radio'?{adapter:'aria-choice'}:{})});
    }
    else if (el.type === "checkbox" || el.getAttribute('role')==='checkbox') {
      if(el.querySelector?.('input[type="checkbox"]'))continue;
      fields.push({...base,kind:'checkbox',...(el.type!=='checkbox'?{adapter:'aria-choice'}:{})});
    }
    else if (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && ["text","number",""].includes(el.type))) fields.push({...base,kind:"text"});
    else if (el.isContentEditable) fields.push({...base,kind:'text',adapter:'contenteditable',format:'plain'});
  }
  if (root) for (const el of root.querySelectorAll('span.eqEditor.inputField, span.eqEditor[widgetid], .mq-editable-field, .mathquill-editable, .acctable .inputcell[role="textbox"]')) {
    if (visible(el) && writable(el) && !el.matches('[data-aura-editor]') && !fields.some(f=>el===elementFor(f.id) || el.contains(elementFor(f.id)))) limitations.push('A Pearson math or table field needs a supported editor API.');
  }
  if(root)for(const el of root.querySelectorAll('.acctable .inputcell[role="listbox"],.dijitSelect,[role="combobox"],[aria-haspopup="listbox"]')) {
    if(visible(el) && !el.disabled && !el.closest('[aria-disabled="true"],.disabled,.dijitDisabled,[data-aura-editor]') && !el.matches('select') && !fields.some(f=>el.contains(elementFor(f.id))))limitations.push('An answer dropdown has no readable options yet.');
  }
  if (!fields.length) for (const el of saraChoices(document,location.hostname,visible)) {
    fields.push({id:idFor(el),label:(el.innerText || el.textContent).trim(),kind:'radio',group:'sara-answer',adapter:'sara-choice'});
  }
  const drops = root ? [...root.querySelectorAll('[data-aura-drop]')].filter(visible).map(el=>({id:idFor(el),label:labelFor(el)})) : [];
  if (root?.querySelector('canvas, svg:not([data-aura-graph])') && !fields.some(f=>f.kind === 'point')) limitations.push('A diagram needs a screenshot to read.');
  if(root && !fields.some(f=>f.kind==='point') && ((!fields.length && /\b(click|tap) (?:to enlarge|inside|in) (?:the )?graph\b/i.test(root.innerText)) || root.querySelector('canvas[tabindex], [role="application"][aria-label*="graph" i]')))limitations.push('Drawing into this graph requires a graph-tool adapter; reading its screenshot does not fill it.');
  if (root?.querySelector('img:not([alt]), img[alt=""]')) limitations.push("An image has no description; the model may not have enough information.");
  const readable = root?.cloneNode?.(true);
  readable?.querySelectorAll('#aurasolve-root').forEach(el=>el.remove());
  readable?.querySelectorAll('[contenteditable], [data-aura-editor], textarea').forEach(el=>{el.textContent='';});
  const question = root ? clean((readable ? readable.textContent : root.innerText) + " " + [...root.querySelectorAll('math, img[alt], [aria-label]')].filter(el=>!el.closest?.('[data-aura-editor]')).map(el=>el.getAttribute('alt') || el.getAttribute('aria-label') || el.textContent).join(" ")).slice(0,16000) : "";
  const figures=root ? [...root.querySelectorAll('img,svg')].map(el=>el.tagName.toLowerCase()==='img'?{src:el.currentSrc || el.getAttribute('src'),alt:el.getAttribute('alt')}:{svg:el.outerHTML?.slice(0,24000)}) : [];
  const hash = fingerprint(JSON.stringify({question,figures,fields:fields.map(({context,...field})=>field),drops}));
  const prompt = root?.cloneNode?.(true);
  prompt?.querySelectorAll('#aurasolve-root').forEach(el=>el.remove());
  prompt?.querySelectorAll('input, textarea, select, [contenteditable], [data-aura-editor], [role="textbox"], [role="alert"], [data-aura-feedback], .feedback, .answer-feedback').forEach(el=>el.remove());
  const promptHash = fingerprint(JSON.stringify({text:clean(prompt?.textContent || question),figures}));
  const visual = Boolean(root?.querySelector('img, svg, canvas, figure, object, embed') || fields.some(f=>f.kind==='radio' || f.kind==='checkbox') || (root && [...root.querySelectorAll('*')].some(el=>visible(el) && getComputedStyle(el).backgroundImage.includes('url('))) || /\b(figure|diagram|graph|picture|image|shown)\b/i.test(question));
  const box = root?.getBoundingClientRect?.();
  const selectedElement = elementFor(selected);
  const chosen = fields.find(f=>f.id === selected) || fields.find(f=>elementFor(f.id)?.contains?.(selectedElement));
  const scalar=fields.filter(f=>['text','select','point','drag'].includes(f.kind));
  const empty=scalar.find(f=>{const el=elementFor(f.id);return !(el.value ?? (el.isContentEditable ? el.textContent : '')).trim();});
  const autoSelected=(empty || scalar[0])?.id || null;
  const unmappedControls=[...new Set(limitations.filter(l=>/editor.*API|field needs|dropdown.*options|graph.*adapter/i.test(l)))];
  return {player:readPlayer(document,visible),url:location.href,context:context(),question,fields,unmappedControls,dropTargets:drops,selected:chosen?.id || autoSelected,selectionSource:chosen?'manual':autoSelected?'automatic':null,hash,limitations:[...new Set(limitations)],controls:{continue:findButtons('continue').length,submit:findButtons('submit').length,next:findButtons('next').length,similar:findButtons('similar').length},
    fallback:isFallback(root),promptHash,visual,rect:box?{x:box.left,y:box.top,width:box.width,height:box.height}:null,viewport:globalThis.innerWidth || 0,
    problemCount:[...document.querySelectorAll(rootSelector)].filter(visible).length};
}
export function feedback() {
  const nodes = [...document.querySelectorAll('[data-aura-feedback], .feedback, .answer-feedback, [role="alert"], .feedbackDialog, .correctDialog, .responses, .xlFeedback, [role="dialog"], [role="alertdialog"], .dijitDialog')].filter(visible);
  const dialogs=nodes.filter(el=>el.matches?.('[role="dialog"],[role="alertdialog"],.dijitDialog,.feedbackDialog,.correctDialog') || el.querySelector?.('button,[role="button"]'));
  const text = clean((dialogs.length?dialogs:nodes).map(el=>el.innerText).join(" "));
  const modal=dialogs.length>0;
  if (/\b(incorrect|wrong|try again|not correct)\b/i.test(text)) return {state:"incorrect",text,modal};
  if (/\b(correct|well done|great job|excellent|fantastic|nice work)\b/i.test(text)) return {state:"correct",text,modal};
  return {state:"unknown",text,modal};
}
export function findButtons(kind) {
  return [...document.querySelectorAll('button,input[type="submit"],input[type="button"],[role="button"]')].filter(el=>
    visible(el) && !el.disabled && el.getAttribute('aria-disabled')!=='true' &&
    controlKind([el.innerText,el.value,el.getAttribute('aria-label'),el.getAttribute('title')],el.getAttribute('command') || '')===kind);

}
export function findButton(kind) {
  const buttons = findButtons(kind);
  if (buttons.length !== 1) throw new Error(`Could not identify exactly one ${kind} button. Continue manually.`);
  return buttons[0];
}

