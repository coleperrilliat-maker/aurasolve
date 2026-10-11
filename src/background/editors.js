// Runs in the page's MAIN world. Only known, live editor APIs are supported;
// never evaluate model text or infer an editor from its appearance alone.
export function editorBridge(request = {op: "discover"}) {
  const selector = '.mq-editable-field, .mathquill-editable, span.eqEditor.inputField, .acctable .inputcell[role="textbox"]';
  function adapterFor(el) {
    if (el.matches('.mq-editable-field, .mathquill-editable')) {
      try {
        const mq = window.MathQuill?.getInterface?.(2)?.(el);
        if (mq && typeof mq.latex === 'function' && typeof mq.focus === 'function')
          return {name:'mathquill', read:()=>mq.latex(), write:value=>{mq.focus();mq.latex(value);}};
      } catch {}
    }
    try {
      const widget = window.dijit?.byNode?.(el) || (el.id && window.dijit?.byId?.(el.id));
      // Dojo's generic set() would silently create a property on an unsupported
      // widget. Require its actual value setter and a scalar value reader.
      if (widget && typeof widget._setValueAttr === 'function' && typeof widget.set === 'function' && typeof widget.get === 'function' && ['string','number'].includes(typeof widget.get('value')))
        return {name:'dojo',read:()=>String(widget.get('value')),write:value=>{widget.focus?.();widget.set('value',value);}};
    } catch {}
    return null;
  }
  if (request.op === 'discover') {
    for (const el of document.querySelectorAll(selector)) {
      const adapter = adapterFor(el);
      if (!adapter) {el.removeAttribute('data-aura-editor');el.removeAttribute('data-aura-editor-key');continue;}
      el.dataset.auraEditor = adapter.name;
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
  adapter.write(request.value);
  const normalize = value => String(value).replace(/\s+/g,'');
  if (normalize(adapter.read()) !== normalize(request.value))
    throw new Error('The math editor did not retain the answer. Review it manually.');
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  return {filled:true};
}
