import {sendExtension} from '../shared/messaging.js';
import {questionRoot,snapshot,visible,writable,queryDeep,fieldValueNow} from './detection.js';
import {fillBlocker,mathFillAllowed,meaningfulValue,placeMathButton,sameEntry,whenReady} from '../shared/math-question.js';
import {BUILD_VERSION} from '../shared/version.js';

const debug = (state, detail) => console.debug('[AuraSolve Fill Math]', state, detail || '');

export function createUI() {
  const host=document.createElement('div');host.id='aurasolve-root';host.dataset.auraVersion=BUILD_VERSION;
  host.style.cssText='position:fixed;z-index:2147483646;margin:0;padding:0;width:max-content;background:transparent;pointer-events:auto';
  const shadow=host.attachShadow({mode:'closed'});
  shadow.innerHTML=`<style>
    :host{font:12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}[hidden]{display:none!important}
    button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 8px;border:1px solid #0666f5;border-radius:7px;background:#fff;color:#0666f5;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
    button:hover{background:#eef5ff}button:focus-visible{outline:3px solid #9fc5ff;outline-offset:3px}
    button:disabled{cursor:wait;opacity:.72}button[data-state="error"]{border-color:#b91c1c;color:#b91c1c}
    svg{width:12px;height:12px;display:block;flex:none}
    .spinner{width:12px;height:12px;border:2px solid #9fc5ff;border-top-color:#0666f5;border-radius:50%;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    p{margin:6px 0 0;max-width:240px;color:#334155;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff;border:1px solid #dbe7ff;border-radius:7px;padding:6px 8px}
  </style><button type="button" data-state="ready" aria-label="Fill Math"><svg viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="M2 2h8v1.4H4.7L8 6 4.7 8.6H10V10H2V8.6l3.6-2.6L2 3.4V2z"/></svg><span class="label">Fill Math</span></button><p role="status" aria-live="polite" hidden></p>`;
  const button=shadow.querySelector('button'),label=shadow.querySelector('.label'),notice=shadow.querySelector('p'),icon=shadow.querySelector('svg');
  let running=false,mode='ready',seen='';
  function setState(next, message='') {
    mode=next;
    button.dataset.state=next;
    button.setAttribute('aria-busy', next==='solving' || next==='filling' ? 'true' : 'false');
    button.setAttribute('aria-label', `Fill Math: ${next}`);
    button.disabled=next==='solving' || next==='filling';
    label.textContent={ready:'Fill Math',solving:'Solving',filling:'Filling',complete:'Complete',error:'Error'}[next] || 'Fill Math';
    button.title=`AuraSolve ${BUILD_VERSION} — ${label.textContent}`;
    icon.hidden=next==='solving' || next==='filling';
    let spinner=shadow.querySelector('.spinner');
    if(next==='solving' || next==='filling'){
      if(!spinner){spinner=document.createElement('span');spinner.className='spinner';button.prepend(spinner);}
    } else spinner?.remove();
    notice.hidden=!message;notice.textContent=message;
    debug(next, message);
    if(host.isConnected) place(questionRoot());
  }
  function within(root, el) {
    for (let node=el; node; node=node instanceof ShadowRoot ? node.host : node.parentNode) if (node===root) return true;
    return false;
  }
  function blockers(root) {
    const navigation=/^(check answer|check|continue|next(?: question)?|similar question|submit|save|save best score)$/i;
    return queryDeep(document, 'p,li,h1,h2,h3,h4,figcaption,input,textarea,select,button,[role="button"],canvas,svg,img,math,math-field,.mq-editable-field,[data-aura-graph],nav,[role="navigation"]')
      .filter(el=>visible(el) && !within(host, el) && (within(root, el) || el.closest('nav,[role="navigation"]') || navigation.test((el.innerText || el.getAttribute('aria-label') || '').trim())))
      .map(el=>el.getBoundingClientRect()).filter(box=>box.width>2 && box.height>2);
  }
  function place(root) {
    if(!root){host.hidden=true;return;}
    const bounds=root.getBoundingClientRect();
    if(bounds.width<40 || bounds.bottom<0 || bounds.top>innerHeight){host.hidden=true;return;}
    const size=host.getBoundingClientRect();
    const spot=placeMathButton(bounds, blockers(root), {width:Math.max(96, size.width || 96),height:Math.max(28, size.height || 28)}, {width:innerWidth,height:innerHeight});
    if(!spot){host.hidden=true;debug('hidden','No open 12px gap remained near the question.');return;}
    host.hidden=false;
    const left=`${Math.round(spot.left)}px`, top=`${Math.round(spot.top)}px`;
    if(host.style.left!==left || host.style.top!==top){host.style.left=left;host.style.top=top;}
  }
  function mount() {
    const root=questionRoot(), current=snapshot();
    const lazy=Boolean(root && queryDeep(root, 'span.eqEditor, math-field, .mq-editable-field, .mathquill-editable, [data-wiris-editor], .wrs_editor, .acctable .inputcell, .dijitSelect, [role="listbox"], [role="combobox"], [aria-haspopup="listbox"]').some(el=>visible(el) && writable(el)));
    const frame=[...document.querySelectorAll('iframe')].find(el=>el.getBoundingClientRect().width>400 && el.getBoundingClientRect().height>250);
    const eligible=mathFillAllowed(current) && root && root!==document.body && root!==document.documentElement && !(frame && !current.fields.length && !lazy);
    if(!eligible){if(host.isConnected)host.remove();return;}
    if(!host.isConnected) document.documentElement.append(host);
    if(!running && seen!==current.hash){seen=current.hash; if(mode!=='ready') setState('ready');}
    place(root);
  }
  mount();
  let scheduled=false;
  const refresh=()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;mount();});};
  const observer=new MutationObserver(refresh);
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class','style','aria-hidden','disabled']});
  document.addEventListener('scroll', refresh, true);
  window.addEventListener('resize', refresh);
  button.onclick=async()=>{
    if(running)return;
    running=true;
    let finished=false;
    try{
      const root=questionRoot();
      const box=root?.getBoundingClientRect();
      if(root && box && (box.top<0 || box.bottom>innerHeight)) root.scrollIntoView({block:'center',inline:'nearest'});
      setState('solving');
      await sendExtension({type:'prepareField'});
      let ready=snapshot();
      const lazy=queryDeep(questionRoot() || document, 'span.eqEditor, math-field, .mq-editable-field, .mathquill-editable, [data-wiris-editor], .wrs_editor').some(el=>visible(el) && writable(el));
      if(!ready.fields.length && lazy){
        const appeared=await whenReady(()=>snapshot().fields.length>0, notify=>{
          const watch=new MutationObserver(()=>notify());
          watch.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden','disabled','aria-disabled']});
          return ()=>watch.disconnect();
        });
        ready=snapshot();
        if(!appeared || !ready.fields.length) throw new Error('The math input did not finish loading.');
      }
      if(!mathFillAllowed(ready)) throw new Error('Fill Math is only available on math questions. Nothing was filled.');
      if(!ready.fields.length) throw new Error(fillBlocker(ready.limitations));
      debug('fields', {count:ready.fields.length, adapters:ready.fields.map(field=>field.adapter || field.kind)});
      const result=await sendExtension({type:'solve',mode:'field',mathFill:true});
      if(!result?.solution?.supported || result.solution.confidence<.85 || !result.solution.actions?.length)
        throw new Error(result?.solution?.limitation || 'Could not verify a math answer for this question.');
      const latest=snapshot();
      if(latest.hash!==ready.hash) throw new Error('The question changed. Generate a new answer first.');
      const occupied=result.solution.actions.filter(action=>{
        const field=latest.fields.find(item=>item.id===action.target);
        return field && meaningfulValue(fieldValueNow(field)) && !sameEntry(action.value, fieldValueNow(field), field.kind==='text'?'text':'');
      });
      if(occupied.length && globalThis.confirm?.('An answer is already entered. Replace it with the solved math answer?')===false){
        setState('ready','Left the existing answer unchanged.');finished=true;return;
      }
      setState('filling');
      const filled=await sendExtension({type:'apply',planId:result.planId});
      if(filled?.submitted) throw new Error('Fill Math does not submit answers. Review the page before continuing.');
      if(!filled?.filled) throw new Error('The math answer was not verified in the input.');
      const after=snapshot();
      for(const action of result.solution.actions){
        const field=after.fields.find(item=>item.id===action.target);
        if(!field || field.editorKey || !['text','select'].includes(action.kind)) continue;
        if(!sameEntry(action.value, fieldValueNow(field), field.kind==='text' && action.value!=='' ? 'text' : ''))
          throw new Error(`The ${field.label || 'math'} input did not keep the answer.`);
      }
      const unsupported=fillBlocker(after.limitations);
      setState('complete', unsupported && /graph|canvas|editor|WIRIS|MathLive|drag/i.test(unsupported) ? `Verified the supported inputs. ${unsupported}` : 'Verified in the math input. Review it before submitting.');
      finished=true;
    }catch(error){
      if(!finished) setState('error', error.message || 'The math answer could not be filled.');
    }finally{running=false;}
  };
  return {open:()=>button.focus(),veil:hidden=>{host.style.visibility=hidden?'hidden':'';}};
}
