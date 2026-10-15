// Runs in the page's MAIN world. Only known, live editor APIs are supported;
// never evaluate model text or infer an editor from its appearance alone.
export function editorBridge(request = {op: "discover"}) {
  const dropdownSelector='.acctable .inputcell[role="listbox"], .dijitSelect, [role="listbox"][aria-haspopup], [role="combobox"], [aria-haspopup="listbox"]';
  const selector = `math-field, [data-wiris-editor], .wrs_editor, .mq-editable-field, .mathquill-editable, span.eqEditor.inputField, span.eqEditor[widgetid], .acctable .inputcell[role="textbox"], ${dropdownSelector}`;
  function pageNodes(selector) {
    const found=[], seen=new Set();
    const visit=node=>{
      if(!node || typeof node.querySelectorAll!=='function' || seen.has(node))return;
      seen.add(node);
      for(const el of node.querySelectorAll(selector)) if(!found.includes(el)) found.push(el);
      for(const el of node.querySelectorAll('*')){
        if(el.shadowRoot && !el.matches?.('math-field, .mq-editable-field, .mathquill-editable, span.eqEditor')) visit(el.shadowRoot);
      }
    };
    visit(document);
    return found;
  }
  function assignControl(input, value) {
    const proto=input.tagName==='TEXTAREA'?globalThis.HTMLTextAreaElement?.prototype:globalThis.HTMLInputElement?.prototype;
    const setter=proto && Object.getOwnPropertyDescriptor(proto,'value')?.set;
    if(setter)setter.call(input,value);
    else input.value=value;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function adapterFor(el) {
    if (el.localName==='math-field' || el.matches?.('math-field')) {
      if (typeof el.setValue==='function' && (typeof el.getValue==='function' || 'value' in el))
        return {name:'mathlive', read:()=>typeof el.getValue==='function'?el.getValue('latex'):String(el.value ?? ''), write:value=>{el.focus?.();el.setValue(value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}};
    }
    const wiris=el.wirisEditor || el.editorInstance;
    if (el.matches?.('[data-wiris-editor], .wrs_editor') && wiris && typeof wiris.setMathML==='function' && typeof wiris.getMathML==='function')
      return {name:'wiris', read:()=>wiris.getMathML(), write:value=>{wiris.setMathML(value);}};
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
    if (el.matches?.('span.eqEditor.inputField, span.eqEditor[widgetid]')) {
      const input=el.querySelector?.('input.focusNode, textarea, input:not([type="hidden"])');
      if (input && !input.disabled && !input.readOnly) return {
        name:'pearson-input',
        read:()=>String(input.value ?? ''),
        write:value=>{
          input.focus?.();
          assignControl(input, value);
          if (String(input.value)!==String(value) && typeof document.execCommand==='function') {
            input.select?.();
            document.execCommand('insertText', false, value);
            input.dispatchEvent(new Event('input',{bubbles:true}));
            input.dispatchEvent(new Event('change',{bubbles:true}));
          }
        }
      };
    }
    // Pearson also exposes answer dropdowns without a global Dojo registry.
    // Prefer an explicit ARIA/Dojo link. For old widgets without one, bind the
    // control to the sole visible popup created by clicking that control.
    if (el.matches(dropdownSelector)) {
      const itemSelector='[role="option"],[role="menuitem"],.dijitMenuItem';
      const rawItems=menu=>[...menu.querySelectorAll(itemSelector)]
        .filter(item=>!item.parentElement?.closest(itemSelector));
      const linkedMenus=()=>{
        const ids=[el.getAttribute('aria-controls'),el.getAttribute('aria-owns'),
          ...[(el.getAttribute('widgetid') || el.id)].filter(Boolean).flatMap(id=>[id+'_dropdown',id+'_menu'])]
          .filter(Boolean).flatMap(id=>id.split(/\s+/));
        let menus=[...new Set(ids.map(id=>document.getElementById(id)).filter(menu=>menu && rawItems(menu).length))];
        if(menus.length)return menus;
        if(el.dataset.auraMenuKey) {
          menus=[...document.querySelectorAll('[data-aura-menu-key]')].filter(menu=>menu.dataset.auraMenuKey===el.dataset.auraMenuKey && rawItems(menu).length);
          if(menus.length)return menus;
        }
        const visibleMenus=[...document.querySelectorAll('[role="listbox"],[role="menu"],.dijitMenu,.dijitComboBoxMenuPopup,.dijitPopup')]
          .filter(menu=>menu!==el && menu.getClientRects().length && getComputedStyle(menu).visibility!=='hidden' && rawItems(menu).length);
        const innermost=visibleMenus.filter(menu=>!visibleMenus.some(child=>child!==menu && menu.contains(child)));
        if(innermost.length===1) {
          const key=el.dataset.auraMenuKey || crypto.randomUUID();
          el.dataset.auraMenuKey=key;innermost[0].dataset.auraMenuKey=key;
          return innermost;
        }
        return [];
      };
      const menuItems=()=>{
        const menus=linkedMenus();
        if(menus.length!==1)return [];
        return rawItems(menus[0]);
      };
      const label=item=>(item.querySelector('.dijitMenuItemLabel') || item).textContent.trim();
      const disabled=item=>item.getAttribute('aria-disabled')==='true' || item.classList.contains('dijitDisabled');
      const read=()=>{
        const labelNode=el.querySelector('.dijitSelectLabel,[data-dojo-attach-point*="containerNode"],.textbasecell span');
        return String(el.value ?? el.getAttribute('aria-valuetext') ?? labelNode?.textContent ?? el.textContent).trim();
      };
      const open=()=>{
        const trigger=el.querySelector('.dijitArrowButtonInner,.dijitArrowButton,[data-dojo-attach-point*="titleNode"]') || el;
        trigger.click();
      };
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
        read,
        write:async value=>{
          if(!options.some(o=>o.value===value && !o.disabled))throw new Error('The dropdown option is unavailable.');
          open();
          let item;
          for(let attempt=0;attempt<20;attempt++){
            item=menuItems().find(item=>label(item)===value && !disabled(item) && item.getClientRects().length);
            if(item)break;
            await new Promise(resolve=>setTimeout(resolve,50));
          }
          if(!item)throw new Error('Could not open this answer dropdown. Inspect this page to report its control.');
          item.click();
          for(let attempt=0;attempt<20;attempt++){
            if(read()===value)return;
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
    for(const el of pageNodes(dropdownSelector)){
      if(!el.closest(roots) || !el.getClientRects().length || el.closest('[hidden],[aria-disabled="true"],.disabled,.dijitDisabled') || adapterFor(el))continue;
      (el.querySelector('.dijitArrowButtonInner,.dijitArrowButton,[data-dojo-attach-point*="titleNode"]') || el).click();
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
    for (const el of pageNodes(selector)) {
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
  const targets = pageNodes(selector).filter(el=>el.dataset.auraEditorKey === request.key);
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
