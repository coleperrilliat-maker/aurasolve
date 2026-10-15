import {questionRoot,visible} from './detection.js';
// Supplement the viewport screenshot with a few rendered question figures.
// No remote fetches: origin-protected canvases/images fall back to the screenshot.
export async function captureFigures() {
  const root=questionRoot();if(!root)return [];
  const candidates=[...root.querySelectorAll('img,svg,canvas')].filter(el=>{
    if(!visible(el) || el.closest('#aurasolve-root,[data-aura-editor]') || el.parentElement?.closest('svg'))return false;
    const r=el.getBoundingClientRect();
    return r.width>=100 && r.height>=70;
  });
  const images=[];let total=0;
  for(const el of candidates) {
    if(images.length>=3)break;
    const r=el.getBoundingClientRect();
    // Small diagrams benefit from a close-up. Large, fully visible ones are
    // already readable in the overview; do not pay for a redundant image.
    let clipped=r.top<0 || r.left<0 || r.bottom>innerHeight || r.right>innerWidth;
    for(let p=el.parentElement;p && p!==root.parentElement;p=p.parentElement) {
      const style=getComputedStyle(p),box=p.getBoundingClientRect();
      if(/auto|scroll|hidden|clip/.test(style.overflow+style.overflowX+style.overflowY) && (r.top<box.top || r.left<box.left || r.bottom>box.bottom || r.right>box.right))clipped=true;
    }
    if(!clipped && r.width>=500 && r.height>=300)continue;
    let image=el,url=null;
    try {
      if(el.tagName.toLowerCase()==='svg') {
        const copy=el.cloneNode(true);
        copy.setAttribute('xmlns','http://www.w3.org/2000/svg');copy.setAttribute('width',String(r.width));copy.setAttribute('height',String(r.height));
        // Computed presentation survives stylesheet-based graph labels/strokes.
        const originals=[el,...el.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')];
        originals.forEach((node,i)=>{const css=getComputedStyle(node);for(const key of ['fill','stroke','stroke-width','font-family','font-size','font-weight','text-anchor','opacity'])copies[i].style.setProperty(key,css.getPropertyValue(key));});
        copy.querySelectorAll('script,foreignObject').forEach(node=>node.remove());
        url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml'}));
        image=new Image();image.src=url;
        await Promise.race([image.decode(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Figure timed out')),1500))]);
      }
      const width=el.naturalWidth || el.width?.baseVal?.value || el.width || r.width;
      const height=el.naturalHeight || el.height?.baseVal?.value || el.height || r.height;
      const scale=Math.min(el.tagName.toLowerCase()==='svg'?2:1,1024/width,1024/height);
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const data=canvas.toDataURL('image/jpeg',.9);
      if(data.length>600000 || total+data.length>1200000)continue;
      total+=data.length;images.push({label:el.getAttribute('alt') || el.getAttribute('aria-label') || `Question figure ${candidates.indexOf(el)+1}`,image:data});
    }catch{/* Cross-origin or undecodable figure: the viewport remains authoritative. */}
    finally{if(url)URL.revokeObjectURL(url);}
  }
  return images;
}
