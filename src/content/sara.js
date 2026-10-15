// SARA places letter answer buttons beside the question, outside its prompt.
const letterOf=el=>(el.innerText || el.textContent || '').replace(/\s+/g,' ').trim().toUpperCase();
const uniquePad=group=>{
  const letters=group.map(letterOf);
  return group.length>=4 && group.length<=5 && new Set(letters).size===group.length && ['ABCD','ABCDE'].includes([...letters].sort().join(''));
};
function compactPad(groups) {
  return groups.reduce((best,group)=>{
    const area=els=>{
      const rects=els.map(el=>typeof el.getBoundingClientRect==='function'?el.getBoundingClientRect():{left:0,top:0,right:0,bottom:0});
      const width=Math.max(1,Math.max(...rects.map(r=>r.right))-Math.min(...rects.map(r=>r.left)));
      const height=Math.max(1,Math.max(...rects.map(r=>r.bottom))-Math.min(...rects.map(r=>r.top)));
      return width+height;
    };
    return area(group)<area(best)?group:best;
  });
}
export function saraChoices(doc, hostname, visible) {
  if (!/(^|\.)raydass\.com$/i.test(hostname || '')) return [];
  const candidates=[...doc.querySelectorAll('button, [role="button"], [role="radio"], a, div, span')].filter(el=>{
    if (!visible(el) || el.disabled || el.getAttribute('aria-disabled')==='true' || el.closest('nav,header,footer,[role="navigation"]')) return false;
    return /^[A-E]$/.test(letterOf(el)) && (el.matches('button,[role="button"],[role="radio"],a[href]') || el.onclick || getComputedStyle(el).cursor==='pointer');
  });
  // Collapse nested label spans to their clickable parent; keep one compact ABCD pad if extras appear in the prompt.
  const buttons=candidates.filter(el=>!candidates.some(parent=>parent!==el && parent.contains(el)));
  if (uniquePad(buttons)) return buttons;
  const groups=[];
  for (const el of buttons) {
    let node=el.parentElement;
    while (node && node!==doc.body && node!==doc.documentElement) {
      const inside=buttons.filter(b=>node.contains(b));
      if (uniquePad(inside) && !groups.some(group=>group.length===inside.length && group.every((item,i)=>item===inside[i]))) groups.push(inside);
      node=node.parentElement;
    }
  }
  return groups.length?compactPad(groups):[];
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
