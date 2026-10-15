// Injected into MAIN world. Keep this function self-contained: use only known
// editor APIs or visible, associated menu controls; never evaluate model code.
export function editorBridge(request = {op:'discover'}) {
  const dropdownSelector='.acctable .inputcell[role="listbox"],.dijitSelect,[role="combobox"],[aria-haspopup="listbox"]';
  const selector='.mq-editable-field,.mathquill-editable,span.eqEditor.inputField,span.eqEditor[widgetid],.acctable .inputcell[role="textbox"],'+dropdownSelector;
  const popupSelector='[role="listbox"],[role="menu"],.dijitMenu,.dijitPopup';
  const itemSelector='[role="option"],[role="menuitem"],.dijitMenuItem';
  const roots='[data-aura-question],[data-testid="question"],div[id*="xl_player_layout"],.question-content,#questionContent,#question-content,.questionContainer,.question-container,#problem,.problem-content,.section > .bd';
  const text=value=>String(value ?? '').replace(/\s+/g,' ').trim();
  const visible=el=>Boolean(el?.isConnected && el.getClientRects().length && getComputedStyle(el).visibility!=='hidden' && !el.closest('[hidden],[aria-hidden="true"]'));
  const disabled=el=>el.disabled || el.getAttribute('aria-disabled')==='true' || el.closest('[aria-disabled="true"],fieldset[disabled],.disabled,.dijitDisabled');
  const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
  // AMD Dojo builds need not expose window.dijit. Synchronous require reads an
  // already-loaded module only; do not load scripts or change loader settings.
  let registry=window.dijit?.registry || window.dijit;
  if(!registry && typeof window.require==='function')try{registry=window.require('dijit/registry');}catch{}
  const itemLabel=item=>text(item.getAttribute('aria-label') || (item.querySelector('.dijitMenuItemLabel') || item).textContent);
  function menuFor(el) {
    const widgetId=el.getAttribute('widgetid') || el.id;
    const ids=[el.getAttribute('aria-controls'),el.getAttribute('aria-owns'),el.dataset.auraMenuId,widgetId && widgetId+'_dropdown'].filter(Boolean).flatMap(id=>id.split(/\s+/));
    const menus=[...new Set(ids.map(id=>document.getElementById(id)).filter(Boolean))].filter(menu=>menu!==el && menu.querySelector(itemSelector));
    // An outer popup and its nested list are the same menu, not two candidates.
    const outer=menus.filter(menu=>!menus.some(other=>other!==menu && other.contains(menu)));
    return outer.length===1?outer[0]:null;
  }
  function itemsFor(el) {
    const menu=menuFor(el);
    return menu?[...menu.querySelectorAll(itemSelector)].filter(item=>!item.parentElement?.closest(itemSelector)):[];
  }
  function optionsFor(el) {
    return itemsFor(el).map((item,index)=>({
      value:item.getAttribute('data-value') ?? item.getAttribute('value') ?? `option:${index}`,
      label:itemLabel(item),disabled:Boolean(disabled(item))
    })).filter(option=>option.label);
  }
  function selectedLabel(el) {
    const node=el.querySelector('.dijitSelectLabel,.textbasecell span,[data-value-label]');
    return text(node?.textContent ?? (el.tagName==='INPUT'?el.value:el.textContent));
  }
  function selectedValue(el,options) {
    const items=itemsFor(el),live=optionsFor(el);
    const selected=items.map((item,i)=>item.getAttribute('aria-selected')==='true'?live[i]?.value:null).filter(v=>v!=null);
    if(selected.length===1)return selected[0];
    const raw=el.getAttribute('data-value') ?? (el.tagName==='INPUT'?el.value:null);
    if(raw!=null && options.some(o=>o.value===raw))return raw;
    const label=selectedLabel(el),matching=options.filter(o=>o.label===label);
    return matching.length===1?matching[0].value:null;
  }
  async function openMenu(el) {
    const before=new Set([...document.querySelectorAll(popupSelector)].filter(visible));
    if(!visible(menuFor(el)))el.click();
    for(let n=0;n<20;n++) {
      if(!menuFor(el)) {
        const added=[...document.querySelectorAll(popupSelector)].filter(menu=>menu!==el && visible(menu) && !before.has(menu) && menu.querySelector(itemSelector));
        const outer=added.filter(menu=>!added.some(other=>other!==menu && other.contains(menu)));
        if(outer.length===1){outer[0].id ||= 'aura-menu-'+crypto.randomUUID();el.dataset.auraMenuId=outer[0].id;}
      }
      if(visible(menuFor(el)) && optionsFor(el).length)return true;
      await pause();
    }
    return false;
  }
  function adapterFor(el) {
    if (el.matches('.mq-editable-field,.mathquill-editable')) {
      try {
        const mq=window.MathQuill?.getInterface?.(2)?.(el);
        if(mq && typeof mq.latex==='function' && typeof mq.focus==='function')
          return {name:'mathquill',read:()=>mq.latex(),write:value=>{mq.focus();mq.latex(value);}};
      }catch{}
    }
    const dropdown=el.matches(dropdownSelector) && el.tagName!=='SELECT';
    try {
      const widgetId=el.getAttribute('widgetid') || el.id;
      const widget=registry?.byNode?.(el) || (widgetId && registry?.byId?.(widgetId));
      if(widget && (typeof widget.getOptions==='function' || Array.isArray(widget.options)) && typeof widget.set==='function' && typeof widget.get==='function' && typeof widget._setValueAttr==='function') {
        const raw=typeof widget.getOptions==='function'?widget.getOptions():widget.options;
        if(Array.isArray(raw) && raw.length) {
          const options=raw.filter(o=>o.value!=null).map(o=>{
            const label=document.createElement('span');label.innerHTML=String(o.label ?? o.value);
            return {value:String(o.value),label:text(label.textContent),disabled:Boolean(o.disabled)};
          });
          return {name:'dojo-select',options,read:()=>String(widget.get('value')),write:async value=>{
            const matches=raw.filter(o=>String(o.value)===value && !o.disabled);
            if(matches.length!==1)throw new Error('The dropdown option is unavailable or ambiguous.');
            widget.focus?.();widget.set('value',matches[0].value);
            for(let n=0;n<20 && String(widget.get('value'))!==value;n++)await pause();
          }};
        }
      }
      if(!dropdown && widget && typeof widget._setValueAttr==='function' && typeof widget.set==='function' && typeof widget.get==='function' && ['string','number'].includes(typeof widget.get('value')))
        return {name:'dojo',read:()=>String(widget.get('value')),write:value=>{widget.focus?.();widget.set('value',value);}};
    }catch{}
    if(!dropdown || el.getAttribute('aria-multiselectable')==='true')return null;
    // Use a real backing select when the visible custom widget contains one.
    const native=el.querySelector('select:not([multiple])');
    if(native && !native.disabled) {
      const options=[...native.options].map(o=>({value:o.value,label:o.text,disabled:o.disabled || Boolean(o.closest('optgroup[disabled]'))}));
      return {name:'dom-select',options,read:()=>native.value,write:value=>{
        if(options.filter(o=>o.value===value && !o.disabled).length!==1)throw new Error('The dropdown option is unavailable or ambiguous.');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(native,value);
        native.dispatchEvent(new Event('input',{bubbles:true}));native.dispatchEvent(new Event('change',{bubbles:true}));
      }};
    }
    let options=optionsFor(el);
    if(options.length && new Set(options.map(o=>o.value)).size===options.length)el.dataset.auraDropdownOptions=JSON.stringify(options);
    else try{options=JSON.parse(el.dataset.auraDropdownOptions || '[]');}catch{options=[];}
    if(!options.length)return null;
    return {name:'dom-select',options,read:()=>selectedValue(el,options),write:async value=>{
      const option=options.find(o=>o.value===value && !o.disabled);
      if(!option)throw new Error('The dropdown option is unavailable.');
      if(selectedValue(el,options)===value)return;
      await openMenu(el);
      let item;
      for(let n=0;n<20;n++) {
        const live=optionsFor(el),matches=live.map((o,i)=>o.value===value && o.label===option.label && !o.disabled?i:-1).filter(i=>i>=0);
        if(matches.length===1){const candidate=itemsFor(el)[matches[0]];if(visible(candidate)){item=candidate;break;}}
        await pause();
      }
      if(!item)throw new Error('The dropdown changed or did not open. Read the question again.');
      item.click();
      for(let n=0;n<20 && selectedValue(el,options)!==value;n++)await pause();
    }};
  }
  if(request.op==='prepare')return (async()=>{
    if(document.hidden)throw new Error('The question tab is hidden.');
    const prior=document.activeElement;
    for(const el of document.querySelectorAll(dropdownSelector)) {
      if(el.tagName==='SELECT' || !el.closest(roots) || !visible(el) || disabled(el))continue;
      const adapter=adapterFor(el);
      if(adapter && adapter.name!=='dom-select')continue;
      if(el.querySelector('select:not([multiple])'))continue;
      const wasOpen=visible(menuFor(el));
      try {
        // Also handles popups unmounted and recreated for every opening.
        // Never associate an unrelated menu that was already open.
        if(await openMenu(el))adapterFor(el);
      }finally {
        if(!wasOpen) {
          const target=document.activeElement || el;
          for(const type of ['keydown','keyup'])target.dispatchEvent(new KeyboardEvent(type,{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));
          if(visible(menuFor(el)) && el.getAttribute('aria-expanded')==='true')el.click();
        }
      }
    }
    prior?.focus?.({preventScroll:true});
    return true;
  })();
  if(request.op==='discover') {
    for(const el of document.querySelectorAll(selector)) {
      if(el.tagName==='SELECT')continue;
      const adapter=adapterFor(el);
      if(!adapter){for(const attr of ['data-aura-editor','data-aura-editor-key','data-aura-options'])el.removeAttribute(attr);continue;}
      el.dataset.auraEditor=adapter.name;
      if(adapter.options)el.dataset.auraOptions=JSON.stringify(adapter.options);else el.removeAttribute('data-aura-options');
      el.dataset.auraEditorKey ||= crypto.randomUUID();
    }
    return true;
  }
  if(request.op!=='write' || typeof request.key!=='string' || typeof request.value!=='string' || request.value.length>4000)throw new Error('Invalid editor request.');
  if(document.hidden)throw new Error('The question tab is hidden.');
  const targets=[...document.querySelectorAll(selector)].filter(el=>el.dataset.auraEditorKey===request.key);
  if(targets.length!==1)throw new Error('The answer control changed. Generate a new answer.');
  const el=targets[0],adapter=adapterFor(el);
  if(!visible(el) || disabled(el) || (el.readOnly && !adapter?.options))throw new Error('The answer control is unavailable.');
  if(!adapter || adapter.name!==request.adapter)throw new Error('This answer control needs a dedicated adapter.');
  const written=adapter.write(request.value);
  const finish=async()=>{
    const normalize=value=>String(value).replace(/\s+/g,'');
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
    await pause();
    if(!el.isConnected || (adapter.options?adapter.read()!==request.value:normalize(adapter.read())!==normalize(request.value)))throw new Error('The answer control did not retain the answer. Review it manually.');
    return {filled:true};
  };
  return written?.then?written.then(finish):finish();
}
