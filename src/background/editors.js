// Runs in the page's MAIN world. Only known, live editor APIs are supported;
// never evaluate model text or infer an editor from its appearance alone.
export function editorBridge(request = {op: "discover"}) {
  const selector = '.mq-editable-field, .mathquill-editable, span.eqEditor.inputField, span.eqEditor[widgetid], .acctable .inputcell[role="textbox"], .acctable .inputcell[role="listbox"], .dijitSelect, [role="combobox"][widgetid]';
  function adapterFor(el) {
    if (el.matches('.mq-editable-field, .mathquill-editable')) {
      try {
        const mq = window.MathQuill?.getInterface?.(2)?.(el);
        if (mq && typeof mq.latex === 'function' && typeof mq.focus === 'function')
          return {name:'mathquill', read:()=>mq.latex(), write:value=>{mq.focus();mq.latex(value);}};
      } catch {}
    }
    try {
      const registry=window.dijit?.registry || window.dijit;
      const widgetId=el.getAttribute('widgetid') || el.id;
      const widget = registry?.byNode?.(el) || (widgetId && registry?.byId?.(widgetId));
      if (widget && (typeof widget.getOptions === 'function' || Array.isArray(widget.options)) && typeof widget.set === 'function' && typeof widget.get === 'function' && typeof widget._setValueAttr === 'function') {
        const options = typeof widget.getOptions === 'function' ? widget.getOptions() : widget.options;
        if (Array.isArray(options) && options.length) return {
          name:'dojo-select',
          options:options.filter(o=>o.value != null).map(o=>{
            const label=document.createElement('span');label.innerHTML=String(o.label ?? o.value);
            return {value:String(o.value),label:label.textContent || '',disabled:Boolean(o.disabled)};
          }),
          read:()=>String(widget.get('value')),
          write:value=>{if (!options.some(o=>String(o.value)===value && !o.disabled)) throw new Error('The dropdown option is unavailable.');widget.focus?.();widget.set('value',value);}
        };
      }
      // Dojo's generic set() would silently create a property on an unsupported
      // widget. Require its actual value setter and a scalar value reader.
      if (widget && typeof widget._setValueAttr === 'function' && typeof widget.set === 'function' && typeof widget.get === 'function' && ['string','number'].includes(typeof widget.get('value')))
        return {name:'dojo',read:()=>String(widget.get('value')),write:value=>{widget.focus?.();widget.set('value',value);}};
    } catch {}
    // Pearson also exposes answer dropdowns without a global Dojo registry.
    // Only use a menu explicitly linked to this control, never a page-wide menu.
    if (el.matches('.acctable .inputcell[role="listbox"], .dijitSelect, [role="combobox"][widgetid]')) {
      const menuItems=()=>{
        const ids=[el.getAttribute('aria-controls'),el.getAttribute('aria-owns'),
          (el.getAttribute('widgetid') || el.id) && (el.getAttribute('widgetid') || el.id)+'_dropdown']
          .filter(Boolean).flatMap(id=>id.split(/\s+/));
        const menus=[...new Set(ids.map(id=>document.getElementById(id)).filter(Boolean))];
        if(menus.length!==1)return [];
        return [...menus[0].querySelectorAll('[role="option"],[role="menuitem"],.dijitMenuItem')]
          .filter(item=>!item.parentElement?.closest('[role="option"],[role="menuitem"],.dijitMenuItem'));
      };
      const label=item=>(item.querySelector('.dijitMenuItemLabel') || item).textContent.trim();
      const disabled=item=>item.getAttribute('aria-disabled')==='true' || item.classList.contains('dijitDisabled');
      const items=menuItems(),labels=items.map(label);
      let options=[];
      if(items.length && labels.every(Boolean) && new Set(labels).size===labels.length) {
        options=items.map(item=>({value:label(item),label:label(item),disabled:disabled(item)}));
        el.dataset.auraDropdownOptions=JSON.stringify(options);
      } else {
        try {options=JSON.parse(el.dataset.auraDropdownOptions || '[]');} catch {}
      }
      if(options.length)return {
        name:'dojo-select',options,
        read:()=>(el.querySelector('.dijitSelectLabel,.textbasecell span') || el).textContent.trim(),
        write:async value=>{
          if(!options.some(o=>o.value===value && !o.disabled))throw new Error('The dropdown option is unavailable.');
          el.click();
          let item;
          for(let attempt=0;attempt<20;attempt++){
            item=menuItems().find(item=>label(item)===value && !disabled(item) && item.getClientRects().length);
            if(item)break;
            await new Promise(resolve=>setTimeout(resolve,50));
          }
          if(!item)throw new Error('Could not open this answer dropdown. Inspect this page to report its control.');
          item.click();
          for(let attempt=0;attempt<20;attempt++){
            if((el.querySelector('.dijitSelectLabel,.textbasecell span') || el).textContent.trim()===value)return;
            await new Promise(resolve=>setTimeout(resolve,50));
          }
        }
      };
    }

    return null;
  }
  if(request.op==='prepare')return (async()=>{
    if(document.hidden)throw new Error('The question tab is hidden.');
    const prior=document.activeElement;
    const roots='[data-aura-question],[data-testid="question"],div[id*="xl_player_layout"],.question-content,#questionContent,#question-content,.questionContainer,.question-container,#problem,.problem-content';
    for(const el of document.querySelectorAll('.acctable .inputcell[role="listbox"],.dijitSelect,[role="combobox"][widgetid]')){
      if(!el.closest(roots) || !el.getClientRects().length || el.closest('[hidden],[aria-disabled="true"],.disabled,.dijitDisabled') || adapterFor(el))continue;
      el.click();
      for(let attempt=0;attempt<20;attempt++){
        if(adapterFor(el))break;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      const target=document.activeElement || el;
      target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));
      target.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}));
    }
    prior?.focus?.({preventScroll:true});
    return true;
  })();
  if (request.op === 'discover') {
    for (const el of document.querySelectorAll(selector)) {
      const adapter = adapterFor(el);
      if (!adapter) {el.removeAttribute('data-aura-editor');el.removeAttribute('data-aura-editor-key');el.removeAttribute('data-aura-options');continue;}
      el.dataset.auraEditor = adapter.name;
      if (adapter.options) el.dataset.auraOptions=JSON.stringify(adapter.options);
      else el.removeAttribute('data-aura-options');
      el.dataset.auraEditorKey ||= crypto.randomUUID();
    }
    return true;
  }
  if (request.op !== 'write' || typeof request.key !== 'string' || typeof request.value !== 'string' || request.value.length > 4000)
    throw new Error('Invalid editor request.');
  if (document.hidden) throw new Error('The question tab is hidden.');
  const targets = [...document.querySelectorAll(selector)].filter(el=>el.dataset.auraEditorKey === request.key);
  if (targets.length !== 1) throw new Error('The math editor changed. Generate a new answer.');
  const el = targets[0];
  if (!el.isConnected || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden' || el.closest('[hidden], [aria-hidden="true"], [aria-disabled="true"], .disabled') || el.disabled || el.readOnly)
    throw new Error('The math editor is unavailable.');
  const adapter = adapterFor(el);
  if (!adapter || adapter.name !== request.adapter) throw new Error('This math editor needs a dedicated adapter.');
  const written=adapter.write(request.value);
  const finish=()=>{
  const normalize = value => String(value).replace(/\s+/g,'');
  if (normalize(adapter.read()) !== normalize(request.value))
    throw new Error('The math editor did not retain the answer. Review it manually.');
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  return {filled:true};
  };
  return written?.then ? written.then(finish) : finish();
}
