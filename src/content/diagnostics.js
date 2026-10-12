import {snapshot,questionRoot,visible} from './detection.js';
// Read-only control inventory. No cookies, storage, input values, or page scripts.
export function inspectControls() {
  const root=questionRoot();
  const describe=el=>({tag:el.tagName,id:el.id || '',className:typeof el.className==='string'?el.className:'',role:el.getAttribute('role'),type:el.getAttribute('type'),widgetid:el.getAttribute('widgetid'),ariaControls:el.getAttribute('aria-controls'),ariaOwns:el.getAttribute('aria-owns'),ariaValueMin:el.getAttribute('aria-valuemin'),ariaValueMax:el.getAttribute('aria-valuemax'),ariaValueNow:el.getAttribute('aria-valuenow'),draggable:el.getAttribute('draggable'),dropEffect:el.getAttribute('aria-dropeffect'),adapter:el.getAttribute('data-aura-editor')});
  const selectors='input:not([type="password"]),select,textarea,[role="combobox"],[role="listbox"],[role="option"],[role="slider"],[role="button"],button,[widgetid],[draggable="true"],[aria-dropeffect],canvas,svg,[contenteditable="true"]';
  const controls=[...(root || document).querySelectorAll(selectors)].filter(el=>!el.closest('#aurasolve-root')).slice(0,160).map(el=>({
    ...describe(el),visible:visible(el),disabled:Boolean(el.disabled),
    label:(el.getAttribute('aria-label') || el.getAttribute('title') || (el.matches('button,[role="button"],[role="option"]')?el.textContent:'') || '').trim().slice(0,200),
    options:el.tagName==='SELECT'?[...el.options].map(o=>({value:o.value,label:o.text,disabled:o.disabled})):undefined,
    ancestors:[el.parentElement,el.parentElement?.parentElement].filter(Boolean).map(describe)
  }));
  const s=snapshot();
  return {page:location.origin+location.pathname,root:root?describe(root):null,question:s.question,fields:s.fields,limitations:s.limitations,visual:s.visual,buttons:s.controls,controls};
}
