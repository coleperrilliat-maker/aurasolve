import {readPlayer} from "./player.js";
import {controlKind,pickCheckAnswer} from "../shared/player-state.js";
import {saraChoices} from './sara.js';
import {fingerprint} from "../shared/policy.js";
import {preferContentRect} from "../shared/capture.js";
import {radioPartGroups} from "../shared/solution.js";
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
const fieldSelector = 'input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], [data-aura-editor], [data-aura-graph], [data-aura-draggable], [draggable="true"], [role="slider"]';
const dropSelector = '[data-aura-drop], [aria-dropeffect]:not([aria-dropeffect="none"])';
// Pearson leaves earlier parts' editor wrappers visible after disabling their inputs.
// Those are answer history, not unsupported controls for the current part.
export function writable(el) {
  if (el.matches?.('.xlFillin') || el.dataset?.auraEditor === 'dojo-select') return el.getAttribute('aria-disabled') !== 'true' && !el.classList?.contains('disabled') && !el.matches?.('.xlFillin.disabled, .dijitDisabled, .dijitSelectDisabled');
  if (el.disabled || el.readOnly || el.getAttribute('disabled') !== null || el.getAttribute('readonly') !== null ||
      el.closest('[aria-disabled="true"], [aria-readonly="true"], fieldset[disabled], .eqEditor.disabled, .inputcell.disabled, .inputcell.correct, .dijitDisabled, .dijitSelectDisabled, .xlFillin.disabled') ||
      el.matches?.('.correct, .dijitSelectDisabled, .dijitDisabled')) return false;
  const inputs = [...(el.querySelectorAll?.('input:not([type="hidden"]), textarea, select') || [])];
  return !inputs.length || inputs.some(input => !input.disabled && !input.readOnly && !input.closest('[aria-disabled="true"], [aria-readonly="true"], fieldset[disabled]'));
}
export function fieldContext(el) {
  let parent=el.parentElement;
  for(let depth=0;parent && depth<3;depth++,parent=parent.parentElement){
    const copy=parent.cloneNode(true);
    copy.querySelectorAll('input,textarea,select,[contenteditable],[data-aura-editor],.xlFillinContainer,#aurasolve-root').forEach(node=>node.replaceWith(document.createTextNode(' [answer] ')));
    const text=clean(copy.textContent);
    if(text.length>=8)return text.slice(0,500);
  }
  return '';
}
export function labelFor(el) {
  const editable = el.isContentEditable || el.matches?.('[data-aura-editor]');
  return clean(el.getAttribute("aria-label") || [...(el.labels || [])].map(l=>l.innerText).join(" ") || el.getAttribute("placeholder") || el.getAttribute("title") || (!editable && el.innerText) || el.name || el.id || 'Answer').slice(0,350);
}
const PROMPT_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, legend, [role="heading"], .prompt, .stem, .question-stem';
const CHOICE_LIST = 'fieldset, [role="radiogroup"], .xlMultipleChoice, .QuestionResponseMc, .part';
function follows(prompt, el) {
  try { return Boolean(prompt?.compareDocumentPosition?.(el) & 4); }
  catch { return false; }
}
function partPrompts(root) {
  if (!root?.querySelectorAll) return [];
  return [...root.querySelectorAll(PROMPT_SELECTOR)].filter(el => {
    if (!visible(el) || el.querySelector?.('input[type="radio"], input[type="checkbox"]')) return false;
    const text = clean(el.textContent || el.innerText || '');
    return text.length >= 8 && !/^[A-H][.)]\s/.test(text);
  });
}
function tightList(el) {
  let node = el?.parentElement;
  while (node && node !== document.documentElement) {
    const count = [...(node.querySelectorAll?.('input[type="radio"]') || [])].filter(radio => radio.type === 'radio').length;
    if (count > 1) return node;
    node = node.parentElement;
  }
  return null;
}
function choiceList(el) {
  const explicit = el.closest?.(CHOICE_LIST);
  const count = [...(explicit?.querySelectorAll?.('input[type="radio"]') || [])].filter(radio => radio.type === 'radio').length;
  return explicit && count > 1 ? explicit : tightList(el);
}
function scopedPrompts(el, prompts) {
  const list = choiceList(el);
  return prompts.filter(prompt => {
    if (!follows(prompt, el) || prompt.contains?.(el)) return false;
    if (!list) return true;
    if (list.contains(prompt)) return true;
    const parent = list.parentElement;
    return Boolean(parent?.contains(prompt) && !list.contains(prompt) && follows(prompt, list));
  });
}
function groupAnchor(el, prompts) {
  const list = choiceList(el);
  const prior = scopedPrompts(el, prompts);
  if (prior.length > 1) return prior[prior.length - 1];
  if (list) return list;
  if (prior.length === 1) return prior[0];
  return el?.name ? `name:${el.name}` : el;
}
function choiceOwner(el, radios) {
  let node = el?.parentElement;
  for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
    const inside = (radios || []).filter(radio => node.contains?.(radio));
    if (inside.length === 1) return {radio: inside[0], row: node};
  }
  return null;
}
export function choiceOwnerRadio(el, radios) {
  return choiceOwner(el, radios)?.radio || null;
}
function partContext(el, prompts) {
  const prior = prompts.filter(prompt => follows(prompt, el) && !prompt.contains?.(el));
  if (!prior.length) return '';
  const nearest = prior[prior.length - 1];
  let text = clean(nearest.textContent || nearest.innerText || '');
  if (/^choose the correct answer\b/i.test(text)) {
    const earlier = [...prior].reverse().find(prompt => !/^choose the correct answer\b/i.test(clean(prompt.textContent || prompt.innerText || '')));
    if (earlier) text = clean(`${earlier.textContent || earlier.innerText || ''} ${text}`);
  }
  return text.slice(0, 500);
}
export function describeRadioGroups(root, radios) {
  const prompts = partPrompts(root);
  const rows = radios.filter(Boolean).map(el => ({id: el, name: el.name || '', anchor: groupAnchor(el, prompts)}));
  const groups = radioPartGroups(rows);
  return new Map(radios.filter(Boolean).map(el => [el, {group: groups.get(el), context: partContext(el, prompts)}]));
}
export function radioPartKey(el) {
  if (!el || el.type !== 'radio') return '';
  const root = el.closest?.(rootSelector) || questionRoot() || el.parentElement || el;
  const radios = [...(root.querySelectorAll?.('input[type="radio"]') || [])].filter(radio => radio.type === 'radio' && visible(radio));
  const info = describeRadioGroups(root, radios.length ? radios : [el]);
  return info.get(el)?.group || (el.name ? `name:${el.name}` : '');
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
  let current=snapshot();
  if (current.fields.length) return {ready:true};
  // Some Pearson editors create the native input only after activation.
  // Activate only an answer widget inside the detected question.
  const root=questionRoot();
  const widgets=root ? [...root.querySelectorAll('span.eqEditor.inputField, span.eqEditor[widgetid], .acctable .inputcell[role="textbox"]')].filter(el=>visible(el) && writable(el)) : [];
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
  const drops = root ? [...root.querySelectorAll(dropSelector)].filter(el=>visible(el) && writable(el)).map(el=>({id:idFor(el),label:labelFor(el)})) : [];
  const radioInputs = root ? [...root.querySelectorAll('input[type="radio"]')].filter(el => el.type === "radio" && visible(el) && writable(el)) : [];
  const radioInfo = radioInputs.length ? describeRadioGroups(root, radioInputs) : new Map();
  if (root) for (const el of root.querySelectorAll(fieldSelector)) {
    const owned = el.type === 'radio' || el.type === 'checkbox' ? null : choiceOwner(el, radioInputs);
    if (!visible(el) || (!writable(el) && !owned)) continue;
    const editor = el.closest?.('[data-aura-editor]') || el.closest?.(editorSelector);
    if (editor && editor !== el) {
      if (editor.matches('[data-aura-editor]')) continue;
      // Hidden MathQuill textareas are keyboard proxies, not answer values.
      if (editor.matches('.mq-editable-field, .mathquill-editable')) {limitations.push('This math editor has no accessible value API.');continue;}
    }
    if (el.isContentEditable && el.parentElement?.closest('[contenteditable="true"], [contenteditable="plaintext-only"]')) continue;
    const radio = el.type === "radio" ? radioInfo.get(el) : null;
    const rowText = owned ? clean(owned.row?.innerText || owned.row?.textContent || '') : '';
    const base = {id:idFor(el),label:rowText && !el.getAttribute?.('aria-label') ? rowText.slice(0,180) : labelFor(el),context:radio?.context || rowText || fieldContext(el)};
    const choice = owned ? {choice:idFor(owned.radio)} : {};
    if (el.dataset?.auraEditor === 'dojo-select') {
      try {
        const options=JSON.parse(el.dataset.auraOptions);
        const label=el.matches('.xlFillin') ? (clean(el.getAttribute('aria-label')) || 'Reason') : base.label;
        fields.push({...base,label,kind:'select',adapter:'dojo-select',editorKey:el.dataset.auraEditorKey,options});
      } catch {limitations.push('Dropdown options could not be read.');}
    }
    else if (el.matches('[data-aura-editor]')) fields.push({...base,...choice,kind:'text',adapter:el.dataset.auraEditor,editorKey:el.dataset.auraEditorKey,format:el.dataset.auraEditor === 'mathquill' ? 'latex' : 'plain'});
    else if (el.matches('[role="slider"]')) {
      const min=Number(el.getAttribute('aria-valuemin')),max=Number(el.getAttribute('aria-valuemax'));
      const now=Number(el.getAttribute('aria-valuenow')),step=Number(el.getAttribute('aria-valuestep') || el.dataset?.step || 1);
      const orientation=el.getAttribute('aria-orientation') || 'horizontal';
      if(Number.isFinite(min) && Number.isFinite(max) && min<max && Number.isFinite(now) && Number.isFinite(step) && step>0 && orientation==='horizontal')
        fields.push({...base,kind:'point',adapter:'aria-number-line',bounds:{xMin:min,xMax:max,yMin:0,yMax:0},step});
      else limitations.push('This number-line slider does not expose usable bounds and a current value.');
    }
    else if (el.matches('[data-aura-graph]')) {
      const bounds = Object.fromEntries(["xMin","xMax","yMin","yMax"].map(key=>[key,Number(el.dataset[key])]));
      if (el.dataset.auraGraph === "point" && Object.values(bounds).every(Number.isFinite) && bounds.xMin < bounds.xMax && bounds.yMin < bounds.yMax) fields.push({...base,kind:"point",bounds});
      else limitations.push("Graph control has no supported coordinate adapter.");
    } else if (el.matches('[data-aura-draggable], [draggable="true"]')) {
      if(drops.length)fields.push({...base,kind:"drag"});
      else limitations.push('This drag item has no explicitly identified drop targets.');
    }
    else if (el.tagName === "SELECT" && !el.multiple) fields.push({...base,kind:"select",options:[...el.options].map(o=>({value:o.value,label:o.text,disabled:o.disabled}))});
    else if (el.type === "radio") fields.push({...base,kind:"radio",group:radio?.group || el.name || base.id});
    else if (el.type === "checkbox") fields.push({...base,kind:"checkbox"});
    else if (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && ["text","number",""].includes(el.type))) fields.push({...base,...choice,kind:"text"});
    else if (el.isContentEditable) fields.push({...base,...choice,kind:'text',adapter:'contenteditable',format:'plain'});
  }
  if (root) for (const el of root.querySelectorAll('span.eqEditor.inputField, span.eqEditor[widgetid], .mq-editable-field, .mathquill-editable, .acctable .inputcell[role="textbox"]')) {
    if (visible(el) && writable(el) && !el.matches('[data-aura-editor]') && !fields.some(f=>el===elementFor(f.id) || el.contains(elementFor(f.id)))) limitations.push('A Pearson math or table field needs a supported editor API.');
  }
  if (root) for (const el of root.querySelectorAll('.xlFillin:not(.disabled)')) {
    if (visible(el) && !el.matches('[data-aura-editor]') && !fields.some(f=>elementFor(f.id)===el)) limitations.push("A Pearson answer dropdown's choices could not be read, so it cannot be filled.");
  }
  if (!fields.length) for (const el of saraChoices(document,location.hostname,visible)) {
    fields.push({id:idFor(el),label:(el.innerText || el.textContent).trim(),kind:'radio',group:'sara-answer',adapter:'sara-choice'});
  }
  if (root?.querySelector('canvas, svg:not([data-aura-graph])') && !fields.some(f=>f.kind === 'point')) limitations.push("Canvas/SVG content is not read visually; complex graph actions are unsupported.");
  if (root?.querySelector('img:not([alt]), img[alt=""]')) limitations.push("An image has no description; the model may not have enough information.");
  const readable = root?.cloneNode?.(true);
  readable?.querySelectorAll('#aurasolve-root, .xlFillinContainer').forEach(el=>el.remove());
  readable?.querySelectorAll('img, svg, canvas, figure, object, embed').forEach((el,index)=>el.replaceWith(document.createTextNode(` [figure ${index + 1}] `)));
  readable?.querySelectorAll('[contenteditable], [data-aura-editor], textarea').forEach(el=>{el.textContent='';});
  const question = root ? clean((readable ? readable.textContent : root.innerText) + " " + [...root.querySelectorAll('math, img[alt], [aria-label]')].filter(el=>!el.closest?.('[data-aura-editor]')).map(el=>el.getAttribute('alt') || el.getAttribute('aria-label') || el.textContent).join(" ")).slice(0,16000) : "";
  const figures=root ? [...root.querySelectorAll('img,svg')].map(el=>el.tagName.toLowerCase()==='img'?{src:el.currentSrc || el.getAttribute('src'),alt:el.getAttribute('alt')}:{paths:el.querySelectorAll('path,rect,line,circle,polygon,polyline,text').length}) : [];
  const stableLabel=value=>clean(String(value || '').replace(/\b(selected|checked|unselected|unchecked)\b/ig,''));
  const hash = fingerprint(JSON.stringify({question:stableLabel(question),figures,fields:fields.map(({context,imageChoice,...field})=>({...field,label:stableLabel(field.label)})),drops}));
  const prompt = root?.cloneNode?.(true);
  prompt?.querySelectorAll('#aurasolve-root').forEach(el=>el.remove());
  prompt?.querySelectorAll('input, textarea, select, [contenteditable], [data-aura-editor], [role="textbox"], [role="alert"], [data-aura-feedback], .feedback, .answer-feedback').forEach(el=>el.remove());
  const promptHash = fingerprint(JSON.stringify({text:clean(prompt?.textContent || question),figures}));
  const pictureNodes = pictureChoices(root, fields);
  const imageBased = pictureNodes.length > 0;
  const visual = imageBased || /\b(figures?|diagrams?|graphs?|pictures?|images?|shown|draw the next)\b/i.test(question);
  const contentNodes = [...pictureNodes];
  for (const field of fields) {
    const el = elementFor(field.id);
    if (el) contentNodes.push(el.parentElement || el);
  }
  if (root) contentNodes.push(...[...root.querySelectorAll('p, h1, h2, h3, h4, [role="heading"], .prompt, .stem')].filter(el => painted(el)).slice(0, 8));
  const box = preferContentRect(unionRect([root]), unionRect(contentNodes));
  const selectedElement = elementFor(selected);
  const chosen = fields.find(f=>f.id === selected) || fields.find(f=>elementFor(f.id)?.contains?.(selectedElement));
  const scalar=fields.filter(f=>['text','select','point','drag'].includes(f.kind));
  const empty=scalar.find(f=>{const el=elementFor(f.id);return !(el.value ?? (el.isContentEditable ? el.textContent : '')).trim();});
  const autoSelected=(empty || scalar[0])?.id || null;
  return {player:readPlayer(document,visible),url:location.href,context:context(),question,fields,dropTargets:drops,selected:chosen?.id || autoSelected,selectionSource:chosen?'manual':autoSelected?'automatic':null,hash,limitations:[...new Set(limitations)],controls:{continue:findButtons('continue').length,submit:findButtons('submit').length,next:findButtons('next').length,similar:findButtons('similar').length},
    fallback:isFallback(root),promptHash,visual,imageBased,rect:box,viewport:globalThis.innerWidth || 0,viewportHeight:globalThis.innerHeight || 0,devicePixelRatio:globalThis.devicePixelRatio || 1,
    problemCount:[...document.querySelectorAll(rootSelector)].filter(visible).length};
}
function painted(el) {
  if (!el?.isConnected || el.closest?.('#aurasolve-root, nav, header, button, [role="navigation"]')) return false;
  let style;
  try { style = getComputedStyle(el); } catch { return false; }
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const box = el.getBoundingClientRect();
  return box.width >= 36 && box.height >= 36;
}
function pictureChoices(root, fields) {
  if (!root) return [];
  const pictures = [...root.querySelectorAll('img, svg, canvas, figure, object, embed, .xlFigure, [data-dojo-type*="figure"]')].filter(painted);
  for (const frame of root.querySelectorAll('iframe')) {
    const box = frame.getBoundingClientRect?.();
    if (painted(frame) && box && box.width <= 720 && box.height <= 520) pictures.push(frame);
  }
  for (const el of root.querySelectorAll('*')) {
    if (painted(el) && getComputedStyle(el).backgroundImage.includes('url(')) pictures.push(el);
  }
  for (const field of fields) {
    if (field.kind !== 'radio' && field.kind !== 'checkbox') continue;
    const el = elementFor(field.id);
    let node = el;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      if ([...node.querySelectorAll('img, svg, canvas, figure, object, embed, .xlFigure')].some(painted)) { pictures.push(node); field.imageChoice = true; break; }
    }
  }
  return pictures;
}
function unionRect(nodes) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, any = false;
  for (const el of nodes) {
    const box = el?.getBoundingClientRect?.();
    if (!box || box.width < 2 || box.height < 2) continue;
    any = true;
    left = Math.min(left, box.left); top = Math.min(top, box.top);
    right = Math.max(right, box.right); bottom = Math.max(bottom, box.bottom);
  }
  return any ? {x:left, y:top, width:right - left, height:bottom - top} : null;
}
export function revealQuestion() {
  const root = questionRoot();
  if (root) {
    const box = root.getBoundingClientRect();
    const fits = box.height > 0 && box.height <= (globalThis.innerHeight || box.height) - 24;
    root.scrollIntoView({block: fits ? 'center' : 'start', inline: 'nearest'});
  }
  return snapshot();
}
export function feedback() {
  const nodes = [...document.querySelectorAll('[data-aura-feedback], .feedback, .answer-feedback, [role="alert"], .feedbackDialog, .correctDialog, .responses, .xlFeedback, [role="dialog"], [role="alertdialog"], .dijitDialog')].filter(visible);
  const dialogs=nodes.filter(el=>el.matches?.('[role="dialog"],[role="alertdialog"],.dijitDialog,.feedbackDialog,.correctDialog') || el.querySelector?.('button,[role="button"]'));
  const text = clean((dialogs.length?dialogs:nodes).map(el=>el.innerText).join(" "));
  const modal=dialogs.length>0;
  const dismissible=dialogs.some(dialog=>[...dialog.querySelectorAll('button,[role="button"],input[type="button"],[data-dojo-attach-point="btnOk"]')].some(el=>visible(el) && /^(ok|okay)$/i.test(clean(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title')))));
  if (/\b(incorrect|wrong|try again|not correct)\b/i.test(text)) return {state:"incorrect",text,modal,dismissible};
  if (/\b(correct|well done|great job|excellent|fantastic|nice work)\b/i.test(text)) return {state:"correct",text,modal,dismissible};
  return {state:"unknown",text,modal,dismissible};
}
const controlSelector='button,input[type="submit"],input[type="button"],[role="button"],a.navButton,[command="checkanswer"],[command="continue"],[command="similarexercise"],[command="next"],[command="nextquestion"],[command="similarquestion"]';
export function findButtons(kind) {
  return [...document.querySelectorAll(controlSelector)].filter(el=>{
    if(!visible(el) || el.disabled || el.getAttribute('aria-disabled')==='true')return false;
    const nav=el.matches?.('button.navButton, a.navButton, .navButton');
    const dialog=Boolean(el.closest?.('.xlDialogButtonContainer, [role="dialog"], [role="alertdialog"], .dijitDialog, .feedbackDialog'));
    return controlKind([el.innerText,el.value,el.getAttribute('aria-label'),el.getAttribute('title')],el.getAttribute('command') || '',{nav,dialog})===kind;
  });
}
export function findButton(kind) {
  const buttons = findButtons(kind);
  if (kind === 'submit' || kind === 'next') {
    const chosen = pickCheckAnswer(buttons.map(el=>{
      const box=el.getBoundingClientRect?.() || {bottom:0,right:0};
      return {el,bottom:box.bottom,right:box.right,
        nav:Boolean(el.matches?.('button.navButton, a.navButton, button.navButton.gr-btn-primary, button.navButton.btn-primary')),
        dialog:Boolean(el.closest?.('.xlDialogButtonContainer, [role="dialog"], [role="alertdialog"], .dijitDialog, .feedbackDialog')),
        command:(el.getAttribute?.('command') || '').toLowerCase()};
    }));
    if (!chosen) throw new Error(kind==='submit'?'Check answer is not available. Nothing was submitted.':'Next is not available. Nothing was submitted.');
    return chosen.el;
  }
  if (buttons.length !== 1) throw new Error(`Could not identify exactly one ${kind} button. Continue manually.`);
  return buttons[0];
}

