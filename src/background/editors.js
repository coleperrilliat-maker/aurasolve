// Runs in the page's MAIN world. Only known, live editor APIs are supported;
// never evaluate model text or infer an editor from its appearance alone.
// Chrome serializes this function alone, so every helper it uses lives inside it.
export function editorBridge(request = {op: "discover"}) {
  function reasonKey(value) {
    const spoken = [
      [/left parenthesis/gi, '('], [/right parenthesis/gi, ')'],
      [/left bracket/gi, '['], [/right bracket/gi, ']']
    ];
    let text = String(value || '')
      .replace(/[\u00a0\u2007\u202f]/g, ' ')
      .replace(/[\u2212\u2013\u2014]/g, '-')
      .replace(/[\u2245\u224c\u2263]/g, '≅');
    for (const [pattern, symbol] of spoken) text = text.replace(pattern, symbol);
    return text.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\[\s+/g, '[').replace(/\s+\]/g, ']').trim().toLowerCase();
  }
  const dropdownSelector='.xlFillin:not(.disabled), .acctable .inputcell[role="listbox"]:not(.disabled):not(.correct), .acctable table.dijitSelect[role="listbox"]:not(.dijitDisabled):not(.dijitSelectDisabled), .acctable select:not([disabled]), .dijitSelect, [role="listbox"][aria-haspopup], [role="combobox"], [aria-haspopup="listbox"]';
  const arrowSelector='.xlFillinArrow, .dijitArrowButtonInner, .dijitArrowButton, .dijitDownArrowButton, [data-dojo-attach-point*="titleNode"]';
  const selector = `.mq-editable-field, .mathquill-editable, span.eqEditor.inputField, span.eqEditor[widgetid], .acctable .inputcell[role="textbox"], ${dropdownSelector}`;
  // The open reason list is a Dojo popup under body, not inside .xlFillin.
  // #FL1_menu holds tr[role=option]. tr#FL1_blank is the empty choice.
  // The reason words live on a nested equation label, and the option tr's
  // own aria-label is only a space. Press that tr, not the closed box.
  const clean=value=>String(value || '').replace(/[\u00a0\u2007\u202f]/g,' ').replace(/\s+/g,' ').trim();
  const placeholder=text=>!text || /^(empty selection|choose|select)$/i.test(text);
  // An equation node carries the spoken label and the visible symbols as
  // separate children. Reading the parent text glues them into one name.
  function singleEquation(root) {
    if(!root?.querySelector)return '';
    const spoken=root.querySelector('.eqAccessibleLabel');
    if(spoken)return clean(spoken.textContent);
    const visual=root.querySelector('.eqDocument');
    if(visual)return clean(visual.textContent);
    return '';
  }
  function reasonLabel(item) {
    const equation=singleEquation(item);
    if(!placeholder(equation))return equation;
    const own=clean(item?.getAttribute?.('aria-label'));
    if(!placeholder(own))return own;
    const nodes=item?.querySelectorAll ? [...item.querySelectorAll('[aria-label]')] : [];
    const named=nodes.map(node=>{
      if(node.querySelector?.('.eqAccessibleLabel, .eqDocument') || node.classList?.contains?.('eqAccessibleLabel') || node.classList?.contains?.('eqDocument'))return '';
      if(node.getAttribute?.('aria-hidden')==='true' || node.hidden)return '';
      return clean(node.getAttribute?.('aria-label'));
    }).find(text=>!placeholder(text));
    if(named)return named;
    const cell=item?.querySelector?.('.dijitMenuItemLabel');
    if(cell?.querySelector?.('.eqAccessibleLabel, .eqDocument') || item?.querySelector?.('.eqAccessibleLabel, .eqDocument'))return '';
    return clean(cell?.innerText || cell?.textContent || item?.innerText || item?.textContent || '');
  }
  function menuFor(el) {
    const button=el.querySelector?.('[aria-owns]');
    const owned=button?.getAttribute('aria-owns') || '';
    const widgetId=el.getAttribute?.('widgetid') || button?.id || '';
    const popup=widgetId ? document.querySelector?.(`[dijitpopupparent="${widgetId}"]`) : null;
    return document.getElementById(owned) || popup?.querySelector?.('[role="listbox"], table.xlFillinMenu') || popup || document.getElementById(widgetId ? `${widgetId}_menu` : '') || null;
  }
  function reasonRows(el) {
    const menu=menuFor(el);
    const popup=menu ? [...menu.querySelectorAll('tr[role="option"]')].filter(row=>(row.tagName || 'TR')==='TR' && row.getAttribute?.('role')==='option') : [];
    if(popup.length)return popup;
    const nested=[...el.querySelectorAll('.xlFillinContainer > div')];
    if(nested.length)return nested;
    return [...el.querySelectorAll('.xlFillinItem')].filter(node=>!node.hasAttribute?.('aria-haspopup') && !node.classList?.contains('dijitDownArrowButton'));
  }
  function reasonOptions(el) {
    const rows=reasonRows(el).filter(row=>!/_blank$/i.test(row.id || '') && !placeholder(reasonLabel(row)));
    const options=rows.map(row=>({value:row.id || reasonLabel(row),label:reasonLabel(row),disabled:false})).filter(option=>option.label);
    return new Set(options.map(option=>option.value)).size===options.length ? options : [];
  }
  function questionStamp() {
    const page=globalThis.location?.href || '';
    const root=document.querySelector?.('[data-aura-question]');
    return `${page}\n${clean(root?.innerText || '')}`;
  }
  function pearsonFillin(el) {
    const live=reasonOptions(el);
    const stamp=questionStamp();
    let options=live;
    if(live.length){
      el.dataset.auraDropdownOptions=JSON.stringify(live);
      el.dataset.auraOptionStamp=stamp;
    } else if(el.dataset.auraOptionStamp===stamp){
      try{options=JSON.parse(el.dataset.auraDropdownOptions || '[]');}catch{options=[];}
    } else {
      delete el.dataset.auraDropdownOptions;
      delete el.dataset.auraOptionStamp;
      options=[];
    }
    if(!options.length)return null;
    const boxText=()=>{
      const button=el.querySelector('.dijitDownArrowButton, [aria-haspopup="listbox"]');
      const source=button || el.querySelector('.xlFillinInputValueAriaLabelNode');
      const equation=singleEquation(source);
      if(!placeholder(equation))return equation;
      if(source?.querySelector?.('.eqAccessibleLabel, .eqDocument'))return '';
      return clean(String(source?.innerText || source?.textContent || '').replace(/▼/g,''));
    };
    const read=()=>{
      const shown=boxText();
      if(placeholder(shown))return '';
      return options.find(option=>reasonKey(option.label)===reasonKey(shown))?.label || '';
    };
    const optionFor=value=>{
      const byId=options.filter(candidate=>candidate.value===value && !candidate.disabled);
      if(byId.length===1)return byId[0];
      const byLabel=options.filter(candidate=>reasonKey(candidate.label)===reasonKey(value) && !candidate.disabled);
      return byLabel.length===1 ? byLabel[0] : null;
    };
    const wait=()=>new Promise(resolve=>setTimeout(resolve,50));
    const visible=node=>Boolean(node?.getClientRects?.().length && getComputedStyle(node).visibility!=='hidden' && getComputedStyle(node).display!=='none');
    const widgetId=el.getAttribute?.('widgetid') || el.querySelector?.('[aria-owns]')?.id || 'This dropdown';
    const kept=option=>Boolean(option) && !visible(menuFor(el)) && reasonKey(read())===reasonKey(option.label);
    const openerOf=()=>el.querySelector('[aria-haspopup="listbox"]') || el.querySelector('.xlFillinArrow') || el;
    const openerPoint=()=>{
      const opener=openerOf();
      const rect=opener.getBoundingClientRect?.();
      if(!rect || rect.width<1 || rect.height<1)return null;
      return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};
    };
    const reveal=async reopen=>{
      const opener=openerOf();
      const expectsMenu=Boolean(el.querySelector?.('[aria-owns]') || el.getAttribute?.('widgetid'));
      if(!expectsMenu){opener.click?.();return;}
      if(reopen && visible(menuFor(el))){
        opener.click?.();
        for(let attempt=0;attempt<10 && visible(menuFor(el));attempt++)await wait();
      }
      if(!visible(menuFor(el)))opener.click?.();
      for(let attempt=0;attempt<20 && !visible(menuFor(el));attempt++)await wait();
      if(!visible(menuFor(el)))throw new Error(`${widgetId} did not open.`);
    };
    const matchingRow=option=>reasonRows(el).find(candidate=>!/_blank$/i.test(candidate.id || '') && visible(candidate) && (candidate.id===option.value || reasonKey(reasonLabel(candidate))===reasonKey(option.label)));
    const clickPoint=row=>{
      const labelled=row.querySelector?.('.dijitMenuItemLabel');
      const cell=labelled?.getBoundingClientRect ? labelled : row;
      const rect=cell.getBoundingClientRect?.();
      if(!rect || rect.width<1 || rect.height<1)return null;
      const points=[[rect.left+rect.width/2, rect.top+rect.height/2],[rect.left+Math.min(8, rect.width/2), rect.top+rect.height/2]];
      if(typeof document.elementFromPoint!=='function')return {x:points[0][0], y:points[0][1]};
      for(const [x,y] of points){
        const hit=document.elementFromPoint(x,y);
        if(hit && (hit===row || row.contains?.(hit) || cell.contains?.(hit)) && !/_blank$/i.test(hit.closest?.('tr')?.id || hit.id || ''))return {x,y};
      }
      return null;
    };
    const status=option=>{
      if(kept(option))return {filled:true,widgetId,label:option.label};
      const raw=boxText();
      const menu=visible(menuFor(el)) ? 'open' : 'closed';
      const seen=placeholder(raw) ? 'nothing' : raw;
      return {filled:false,widgetId,observed:raw,menu,error:`${widgetId} did not keep "${option?.label || 'the reason'}". The box shows "${seen}". The menu is ${menu}.`};
    };
    return {name:'dojo-select',options,read,settled:value=>status(optionFor(value)),aim:async (value,settings={})=>{
      const option=optionFor(value);
      if(!option)throw new Error('The dropdown option is unavailable.');
      const base={aimed:true,href:globalThis.location?.href || '',widgetId,label:option.label};
      if(kept(option))return {...base,selected:true};
      // A script click does not open this menu. Report the closed box so the
      // real pointer can open it, then aim at the reason on the next read.
      if(settings.trust===true && !visible(menuFor(el))){
        const point=openerPoint();
        if(!point)throw new Error(`${widgetId} did not open.`);
        return {...base,selected:false,needsOpen:true,...point};
      }
      await reveal(settings.reopen===true);
      const row=matchingRow(option);
      if(!row){
        if(settings.trust===true)return {...base,selected:false,pending:true};
        throw new Error(`${widgetId} opened, but "${option.label}" was not on it.`);
      }
      const point=clickPoint(row);
      if(!point)throw new Error(`${widgetId} opened, but "${option.label}" could not be clicked.`);
      return {...base,selected:false,needsOpen:false,...point};
    },write:async value=>{
      const option=optionFor(value);
      if(!option)throw new Error('The dropdown option is unavailable.');
      const press=node=>{
        if(!node)return;
        const rect=node.getBoundingClientRect?.();
        const clientX=rect?rect.left+rect.width/2:0, clientY=rect?rect.top+rect.height/2:0;
        const init={bubbles:true,cancelable:true,composed:true,view:window,button:0,clientX,clientY,detail:1};
        for(const type of ['pointerdown','mousedown','pointerup','mouseup','click']){
          const Ctor=type.startsWith('pointer')?globalThis.PointerEvent:globalThis.MouseEvent;
          if(typeof Ctor!=='function')continue;
          try{node.dispatchEvent(new Ctor(type,{...init,buttons:type.endsWith('down')?1:0}));}catch{}
        }
        try{node.click?.();}catch{}
      };
      await reveal(false);
      const row=matchingRow(option);
      if(!row)throw new Error(`${widgetId} opened, but "${option.label}" was not on it.`);
      press(row.querySelector?.('.dijitMenuItemLabel') || row);
      for(let attempt=0;attempt<20 && !kept(option);attempt++)await wait();
      if(!kept(option))throw new Error(status(option).error);
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
  // Closed Pearson menus whose choices only exist after a real click opens them.
  if (request.op === 'lazyMenus') {
    const stamp=questionStamp(), menus=[];
    for (const el of document.querySelectorAll('.xlFillin:not(.disabled)')) {
      if(!el.getClientRects().length || reasonOptions(el).length)continue;
      if(el.dataset.auraOptionStamp===stamp && el.dataset.auraDropdownOptions && el.dataset.auraDropdownOptions!=='[]')continue;
      const opener=el.querySelector('[aria-haspopup="listbox"]') || el.querySelector('.xlFillinArrow') || el;
      const rect=opener.getBoundingClientRect?.();
      if(!rect || rect.width<1 || rect.height<1)continue;
      el.dataset.auraLazyKey ||= crypto.randomUUID();
      menus.push({key:el.dataset.auraLazyKey,x:rect.left+rect.width/2,y:rect.top+rect.height/2,href:globalThis.location?.href || ''});
    }
    return menus;
  }
  if (request.op === 'readMenu') {
    if(typeof request.key!=='string')throw new Error('Invalid menu request.');
    const el=[...document.querySelectorAll('.xlFillin')].find(node=>node.dataset.auraLazyKey===request.key);
    if(!el)return {found:false,count:0,open:false};
    const options=reasonOptions(el);
    if(options.length){
      el.dataset.auraDropdownOptions=JSON.stringify(options);
      el.dataset.auraOptionStamp=questionStamp();
    }
    const menu=menuFor(el);
    return {found:true,count:options.length,open:Boolean(menu?.getClientRects?.().length)};
  }
  if (request.op === 'discover') return (async()=>{
    for (const el of document.querySelectorAll('.xlFillin:not(.disabled)')) {
      if(!el.matches?.('.xlFillin') || reasonOptions(el).length)continue;
      if(el.dataset.auraOptionStamp===questionStamp() && el.dataset.auraDropdownOptions && el.dataset.auraDropdownOptions!=='[]')continue;
      const opener=el.querySelector('.xlFillinArrow') || el.querySelector('[aria-haspopup="listbox"]');
      if(!opener)continue;
      const wasOpen=Boolean(menuFor(el)?.getClientRects?.().length);
      opener.click?.();
      let saved=[];
      for(let attempt=0;attempt<15 && !saved.length;attempt++){
        saved=reasonOptions(el);
        if(!saved.length)await new Promise(resolve=>setTimeout(resolve,50));
      }
      if(saved.length)el.dataset.auraDropdownOptions=JSON.stringify(saved);
      if(!wasOpen)opener.click?.();
    }
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
  })();
  function boundEditor(request) {
    if (typeof request.key !== 'string' || typeof request.value !== 'string' || request.value.length > 4000)
      throw new Error('Invalid editor request.');
    if (document.hidden) throw new Error('The question tab is hidden.');
    const targets = [...document.querySelectorAll(selector)].filter(el=>el.dataset.auraEditorKey === request.key);
    if (targets.length !== 1) throw new Error('The math editor changed. Generate a new answer.');
    const el = targets[0];
    if (!el.isConnected || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden' || el.closest('[hidden], [aria-hidden="true"], [aria-disabled="true"], .disabled') || el.disabled || el.readOnly)
      throw new Error('The math editor is unavailable.');
    const adapter = adapterFor(el);
    if (!adapter || adapter.name !== request.adapter) throw new Error('This math editor needs a dedicated adapter.');
    return {el, adapter};
  }
  if (request.op === 'aim' || request.op === 'shown') {
    const {adapter} = boundEditor(request);
    if (request.op === 'shown') {
      if (typeof adapter.settled === 'function') return adapter.settled(request.value);
      const normalize = value => String(value).replace(/\s+/g,'');
      const shown = normalize(adapter.read());
      const expected = normalize(request.value);
      const label = normalize(adapter.options?.find(option=>normalize(option.value)===expected)?.label || '');
      if (shown === expected || (label && shown === label)) return {filled:true};
      return {filled:false, error:`The reason was not clicked. The box still shows "${adapter.read() || 'nothing'}".`};
    }
    if (typeof adapter.aim !== 'function') return {aimed:false};
    return adapter.aim(request.value, {reopen: request.reopen === true, trust: request.trust === true});
  }
  if (request.op !== 'write')
    throw new Error('Invalid editor request.');
  const {el, adapter} = boundEditor(request);
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
