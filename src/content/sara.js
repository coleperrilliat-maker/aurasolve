// SARA places letter answer buttons beside the question, outside its prompt.
export function saraChoices(doc, hostname, visible) {
  if (!/(^|\.)raydass\.com$/i.test(hostname || '')) return [];
  const candidates=[...doc.querySelectorAll('button, [role="button"], [role="radio"], a, div, span')].filter(el=>{
    if (!visible(el) || el.disabled || el.getAttribute('aria-disabled')==='true' || el.closest('nav,header,footer,[role="navigation"]')) return false;
    const text=(el.innerText || el.textContent || '').trim();
    return /^[A-E]$/.test(text) && (el.matches('button,[role="button"],[role="radio"],a[href]') || el.onclick || getComputedStyle(el).cursor==='pointer');
  });
  // Collapse nested label spans to their clickable parent; reject duplicate groups.
  const buttons=candidates.filter(el=>!candidates.some(parent=>parent!==el && parent.contains(el)));
  const letters=buttons.map(el=>(el.innerText || el.textContent).trim());
  if (buttons.length<4 || buttons.length>5 || new Set(letters).size!==buttons.length || !['ABCD','ABCDE'].includes([...letters].sort().join(''))) return [];
  return buttons;
}

export async function clickSaraChoice(el) {
  const before=el.className, color=getComputedStyle(el).backgroundColor;
  el.click();
  // SARA may show selection, feedback, or replace the question immediately.
  for(let i=0;i<10;i++) {
    if (!el.isConnected || el.getAttribute('aria-checked')==='true' || el.getAttribute('aria-pressed')==='true' || el.className!==before || getComputedStyle(el).backgroundColor!==color) return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Clicked the SARA answer, but could not confirm selection. Check the page before trying again.');
}
