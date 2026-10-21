// Runs in the page's MAIN world. Only known, live editor APIs are supported;
// never evaluate model text or infer an editor from its appearance alone.
export function editorBridge(request = {op: "discover"}) {
  const dropdownSelector='.xlFillin:not(.disabled), .acctable .inputcell[role="listbox"]:not(.disabled):not(.correct), .acctable table.dijitSelect[role="listbox"]:not(.dijitDisabled):not(.dijitSelectDisabled), .acctable select:not([disabled]), .dijitSelect, [role="listbox"][aria-haspopup], [role="combobox"], [aria-haspopup="listbox"]';
  const arrowSelector='.xlFillinArrow, .dijitArrowButtonInner, .dijitArrowButton, .dijitDownArrowButton, [data-dojo-attach-point*="titleNode"]';
  const selector = `.mq-editable-field, .mathquill-editable, span.eqEditor.inputField, span.eqEditor[widgetid], .acctable .inputcell[role="textbox"], ${dropdownSelector}`;
  // Pearson proof menus keep every choice in .xlFillinContainer, even while
  // closed. The option id (FL1-0) is the value; the nested aria-label is the
  // reason text. Open the arrow, click that id, then confirm the shown label.
  function pearsonFillin(el) {
    const clean=value=>String(value || '').replace(/\s+/g,' ').trim();
    const optionLabel=item=>{
      const nodes=item.querySelectorAll? [...item.querySelectorAll('[aria-label]')] : [];
      const named=nodes.map(node=>clean(node.getAttribute?.('aria-label'))).find(Boolean);
      return named || clean(item.getAttribute?.('aria-label') || (item.querySelector?.('.dijitMenuItemLabel') || item).textContent);
    };
    const usable=item=>item.getAttribute('aria-disabled')!=='true' && !item.classList.contains('answered') && !String(item.id || '').endsWith('_blank') && optionLabel(item) && !/^(choose|select)$/i.test(optionLabel(item));
    const collect=()=>{
      const nested=[...el.querySelectorAll('.xlFillinContainer > div')].filter(usable);
      if(nested.length)return nested;
      const inside=[...el.querySelectorAll('.xlFillinItem')].filter(usable);
      if(inside.length)return inside;
      const menus=[...document.querySelectorAll('.xlFillinContainer')].filter(node=>node.getClientRects().length && getComputedStyle(node).visibility!=='hidden');
      return menus.length===1?[...menus[0].querySelectorAll(':scope > div, .xlFillinItem')].filter(usable):[];
    };
    const labelNode=()=>el.querySelector('.xlFillinInputValueAriaLabelNode');
    const read=()=>{
      const node=labelNode();
      const text=clean(node?.textContent || '');
      const named=clean(node?.getAttribute?.('aria-label') || '');
      if(options.some(option=>option.label===text || option.value===text))return text;
      if(options.some(option=>option.label===named || option.value===named))return named;
      return '';
    };
    const found=collect();
    let options=found.length?found.map(item=>({value:item.id || optionLabel(item),label:optionLabel(item),disabled:false})):null;
    if(!options){try{options=JSON.parse(el.dataset.auraDropdownOptions || '[]');}catch{options=[];}}
    if(!options.length || new Set(options.map(option=>option.value)).size!==options.length)return null;
    el.dataset.auraDropdownOptions=JSON.stringify(options);
    return {name:'dojo-select',options,read,write:async value=>{
      const option=options.find(candidate=>(candidate.value===value || candidate.label===value) && !candidate.disabled);
      if(!option)throw new Error('The dropdown option is unavailable.');
      const visible=node=>Boolean(node?.getClientRects?.().length && getComputedStyle(node).display!=='none' && getComputedStyle(node).visibility!=='hidden');
      const ownText=node=>{
        if(!node)return '';
        const text=clean(node.textContent || '');
        if(text && !node.querySelector?.('.xlFillinItem'))return text;
        return clean(node.getAttribute?.('aria-label') || '');
      };
      // The dark first row is an empty choice. It is there so the closed box
      // does not reveal the answer. Never treat it as a reason.
      const blank=node=>!node || /_blank$/i.test(node.id || '') || node.classList?.contains('xlFillinItemBlank') || !ownText(node) && node.id!==option.value;
      const isRow=node=>!blank(node) && (node.id===option.value || ownText(node)===option.label);
      const wait=()=>new Promise(resolve=>setTimeout(resolve,50));
      const openRow=()=>{
        const menus=[...el.querySelectorAll('.xlFillinContainer'),...document.querySelectorAll('.xlFillinContainer')].filter(visible);
        const fromMenus=menus.flatMap(menu=>[...menu.querySelectorAll('.xlFillinItem, :scope > div')]);
        const pool=(fromMenus.length?fromMenus:collect()).map(node=>node.closest?.('.xlFillinItem') || node);
        const rows=[...new Set(pool)].filter(node=>visible(node) && isRow(node));
        return rows.find(node=>node.id===option.value) || rows[0] || null;
      };
      const posted=()=>el.querySelector('input.hiddenInput')?.value || '';
      const selected=()=>read()===option.label || read()===option.value || posted()===option.value;
      // Press the reason row itself. A press on the inner text hits the blank
      // bar Pearson paints across the top of the open list.
      const press=node=>{
        if(!node)return;
        const rect=node.getBoundingClientRect?.();
        const clientX=rect?rect.left+Math.max(rect.width/2,1):0, clientY=rect?rect.top+Math.max(rect.height/2,1):0;
        const init={bubbles:true,cancelable:true,composed:true,view:window,button:0,clientX,clientY,detail:1};
        for(const type of ['pointerdown','mousedown','pointerup','mouseup','click']){
          const Ctor=type.startsWith('pointer')?globalThis.PointerEvent:globalThis.MouseEvent;
          if(typeof Ctor!=='function')continue;
          try{node.dispatchEvent(new Ctor(type,{...init,buttons:type.endsWith('down')?1:0}));}catch{}
        }
        try{node.click?.();}catch{}
      };
      const key=name=>{
        const target=document.activeElement && document.activeElement!==document.body ? document.activeElement : el;
        if(typeof KeyboardEvent!=='function')return;
        try{target.dispatchEvent(new KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true}));}catch{}
        try{target.dispatchEvent(new KeyboardEvent('keyup',{key:name,bubbles:true}));}catch{}
      };
      (el.querySelector('.xlFillinArrow') || el).click?.();
      let row;
      for(let attempt=0;attempt<20 && !row;attempt++){row=openRow();if(!row)await wait();}
      if(!row)throw new Error('The reason list opened, but that reason was not on it.');
      press(row);
      for(let attempt=0;attempt<12 && !selected();attempt++)await wait();
      if(!selected()){
        const menu=row.closest?.('.xlFillinContainer') || [...el.querySelectorAll('.xlFillinContainer')].find(visible);
        const choices=[...(menu?.querySelectorAll('.xlFillinItem, :scope > div') || [])].filter(node=>visible(node) && !blank(node));
        const darkness=node=>{
          const color=String(getComputedStyle(node).backgroundColor || '');
          const parts=color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          return parts?Number(parts[1])+Number(parts[2])+Number(parts[3]):765;
        };
        for(let step=0;step<=choices.length && !selected();step++){
          const highlighted=[...choices].sort((a,b)=>darkness(a)-darkness(b))[0];
          if(highlighted && (highlighted.id===option.value || ownText(highlighted)===option.label)){press(highlighted);key('Enter');break;}
          key('ArrowDown');
          await wait();
        }
      }
      for(let attempt=0;attempt<12 && !selected();attempt++)await wait();
      if(!selected())throw new Error(`The reason was not clicked. The box still shows "${read() || 'nothing'}".`);
    }};
  }
  function adapterFor(el) {
    if (el.matches?.('.xlFillin')) {
      const fillin = pearsonFillin(el);
      if (fillin) return fillin;
    }
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
    // Prefer an explicit ARIA/Dojo link. For old widgets without one, bind the
    // control to the sole visible popup created by clicking that control.
    if (el.matches(dropdownSelector)) {
      const itemSelector='[role="option"],[role="menuitem"],tr.dijitMenuItem,.dijitMenuItem';
      const rawItems=menu=>[...menu.querySelectorAll(itemSelector)]
        .filter(item=>!item.parentElement?.closest(itemSelector) && !String(item.id || '').endsWith('_blank'));
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
        const trigger=el.querySelector(arrowSelector) || el;
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
    for(const el of document.querySelectorAll(dropdownSelector)){
      if(!el.closest(roots) || !el.getClientRects().length || el.closest('[hidden],[aria-disabled="true"],.disabled,.dijitDisabled') || adapterFor(el))continue;
      (el.querySelector(arrowSelector) || el).click();
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
      if (el.closest('.xlFillin') && !el.matches('.xlFillin')) continue;
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
  const failed=error=>({filled:false,error:error instanceof Error ? error.message : String(error)});
  try {
  const written=adapter.write(request.value);
  const finish=()=>{
  const normalize = value => String(value).replace(/\s+/g,'');
  const shown = normalize(adapter.read());
  const expected = normalize(request.value);
  const label = normalize(adapter.options?.find(option=>normalize(option.value)===expected)?.label || '');
  if (shown !== expected && !(label && shown === label))
    throw new Error('The math editor did not retain the answer. Review it manually.');
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  return {filled:true};
  };
  return written?.then ? written.then(finish, failed) : finish();
  } catch (error) { return failed(error); }
}
