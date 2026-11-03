import {snapshot,questionRoot,visible} from './detection.js';
// Read-only control inventory. No cookies, storage, input values, or page scripts.
export function inspectControls() {
  const root=questionRoot();
  const describe=el=>({tag:el.tagName,id:el.id || '',className:typeof el.className==='string'?el.className:'',role:el.getAttribute('role'),type:el.getAttribute('type'),widgetid:el.getAttribute('widgetid'),ariaControls:el.getAttribute('aria-controls'),ariaOwns:el.getAttribute('aria-owns'),ariaHasPopup:el.getAttribute('aria-haspopup'),ariaExpanded:el.getAttribute('aria-expanded'),ariaValueMin:el.getAttribute('aria-valuemin'),ariaValueMax:el.getAttribute('aria-valuemax'),ariaValueNow:el.getAttribute('aria-valuenow'),draggable:el.getAttribute('draggable'),dropEffect:el.getAttribute('aria-dropeffect'),adapter:el.getAttribute('data-aura-editor')});
  const selectors='input:not([type="password"]),select,textarea,[role="combobox"],[role="listbox"],[role="option"],[role="menu"],[role="menuitem"],[role="slider"],[role="button"],button,[widgetid],[aria-haspopup],[draggable="true"],[aria-dropeffect],canvas,svg,[contenteditable="true"]';
  const controls=[...(root || document).querySelectorAll(selectors)].filter(el=>!el.closest('#aurasolve-root')).slice(0,160).map(el=>({
    ...describe(el),visible:visible(el),disabled:Boolean(el.disabled),
    label:(el.getAttribute('aria-label') || el.getAttribute('title') || (el.matches('button,[role="button"],[role="option"]')?el.textContent:'') || '').trim().slice(0,200),
    options:el.tagName==='SELECT'?[...el.options].map(o=>({value:o.value,label:o.text,disabled:o.disabled})):undefined,
    ancestors:[el.parentElement,el.parentElement?.parentElement].filter(Boolean).map(describe)
  }));
  const s=snapshot();
  return {page:location.origin+location.pathname,root:root?describe(root):null,question:s.question,fields:s.fields,limitations:s.limitations,visual:s.visual,graphTool:s.graphTool,buttons:s.controls,controls,graph:graphInventory()};
}

// Layout of any graphing surface in this frame, including popups outside the question.
function graphInventory() {
  const box=el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};};
  const name=el=>`${el.tagName.toLowerCase()}${el.id?'#'+el.id:''}${typeof el.className==='string'&&el.className.trim()?'.'+el.className.trim().split(/\s+/).slice(0,4).join('.'):''}`;
  const shown=el=>{const r=el.getBoundingClientRect();return r.width>0 && r.height>0 && !el.closest('#aurasolve-root');};
  const surfaces=[...document.querySelectorAll('svg,canvas,img,object,embed')].filter(el=>shown(el) && el.getBoundingClientRect().width>=150 && el.getBoundingClientRect().height>=150).slice(0,12).map(el=>({
    el:name(el),box:box(el),path:[el.parentElement,el.parentElement?.parentElement,el.parentElement?.parentElement?.parentElement].filter(Boolean).map(name),
    src:el.tagName==='IMG'?String(el.currentSrc || el.src || '').slice(0,200):undefined,
    parts:el.tagName==='svg'?Object.fromEntries(['path','line','circle','rect','text','g','polyline'].map(tag=>[tag,el.querySelectorAll(tag).length])):undefined
  }));
  const labels=[];
  const walker=document.createTreeWalker(document.body || document.documentElement,NodeFilter.SHOW_TEXT);
  while(walker.nextNode() && labels.length<120){
    const node=walker.currentNode,text=node.textContent.trim();
    if(!/^[\u2212-]?\d+(?:\.\d+)?$|^[xy]$|^[A-Z]$/.test(text) || !node.parentElement || !shown(node.parentElement))continue;
    const range=document.createRange();range.selectNodeContents(node);const r=range.getBoundingClientRect();
    if(r.width && r.height)labels.push({text,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),el:name(node.parentElement)});
  }
  const tools=[...document.querySelectorAll('button,[role="button"],[title],[aria-label],input[type="image"],img[alt]')].filter(shown).slice(0,120).map(el=>({
    el:name(el),box:box(el),title:el.getAttribute('title') || '',aria:el.getAttribute('aria-label') || '',alt:el.getAttribute('alt') || '',
    pressed:el.getAttribute('aria-pressed') || '',text:(el.textContent || '').trim().slice(0,40)
  }));
  const dialogs=[...document.querySelectorAll('[role="dialog"],.modal,.dijitDialog,[class*="dialog" i],[class*="popup" i]')].filter(shown).slice(0,6).map(el=>({el:name(el),box:box(el)}));
  return {viewport:{w:innerWidth,h:innerHeight,dpr:devicePixelRatio},surfaces,labels,tools,dialogs};
}
