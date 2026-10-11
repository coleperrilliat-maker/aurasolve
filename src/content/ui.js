import {sendExtension} from '../shared/messaging.js';
import {questionRoot,snapshot,visible} from './detection.js';
import {BUILD_VERSION} from '../shared/version.js';

export function promptBox(root) {
  const named=root.querySelector('#top, [id$="_top"], [data-testid="question-text"], .question-text');
  if(named && visible(named))return named;
  // Split Pearson layouts may give their prompt panel a generated ID. Find
  // the smallest visible prose block, excluding the diagram and answer inputs.
  const blocks=[...root.querySelectorAll('p,div')].filter(el=>visible(el) &&
    !el.closest('#aurasolve-root') && !el.querySelector('input,select,textarea,svg,canvas,img,iframe') &&
    (el.textContent || '').trim().length>=35);
  const leaves=blocks.filter(el=>!blocks.some(child=>child!==el && el.contains(child)));
  return leaves[0] || root;
}

export function createUI() {
  const host=document.createElement('div');host.id='aurasolve-root';host.dataset.auraVersion=BUILD_VERSION;
  host.style.cssText='display:block;float:right;position:relative;z-index:2147483646;margin:6px 10px 8px 12px;padding:0;background:transparent;box-sizing:border-box;max-width:calc(100% - 32px)';
  const shadow=host.attachShadow({mode:'closed'});
  shadow.innerHTML=`<style>
    :host{font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}[hidden]{display:none!important}
    button{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-width:104px;height:30px;padding:0 12px;border:0;border-radius:7px;background:#0666f5;color:white;font:400 12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:none;cursor:pointer;transition:background .15s}
    button:hover{background:#0055d5}button:focus-visible{outline:3px solid #9fc5ff;outline-offset:3px}button:disabled{cursor:wait;background:#327fed}
    .spinner{width:13px;height:13px;border:2px solid #ffffff60;border-top-color:white;border-radius:50%;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    p{margin:8px 0 0;color:#475569;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:540px}
  </style><button type="button" title="AuraSolve ${BUILD_VERSION}" aria-busy="false">Fill answers</button><p role="status" aria-live="polite" hidden></p>`;
  const button=shadow.querySelector('button'),notice=shadow.querySelector('p');
  let running=false;
  function mount(){
    const root=questionRoot(), current=snapshot();
    const sara=current.fields.some(field=>field.adapter==='sara-choice');
    const lazy=root && [...root.querySelectorAll('span.eqEditor.inputField, span.eqEditor[widgetid], .dijitSelect, [role="combobox"][widgetid], .mq-editable-field')].some(visible);
    const answering=Boolean(root && current.question && (sara || (!current.fallback && (current.fields.length || lazy))));
    if(!answering){if(host.isConnected)host.remove();return;}
    if(host.isConnected && root.contains(host))return;
    const frame=[...document.querySelectorAll('iframe')].find(el=>el.getBoundingClientRect().width>400 && el.getBoundingClientRect().height>250);
    // The question may live in a child frame. Do not put a second toolbar
    // above that iframe in its parent document.
    if(frame)return;
    if(root && root!==document.body && root!==document.documentElement){
      const prompt=promptBox(root);
      prompt.prepend(host);
    } else if(window===window.top)(document.querySelector('main,[role="main"]') || document.body)?.prepend(host);
  }
  mount();
  let scheduled=false;
  const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;mount();});});
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class','style','aria-hidden','disabled']});
  button.onclick=async()=>{
    if(running)return;
    running=true;button.disabled=true;button.setAttribute('aria-busy','true');button.innerHTML='<span class="spinner" aria-hidden="true"></span>Filling…';notice.hidden=true;
    try{
      await sendExtension({type:'prepareField'});
      const result=await sendExtension({type:'solve',mode:'field'});
      if(!result.solution.supported || result.solution.confidence<.85 || !result.solution.actions.length)throw new Error(result.solution.limitation || 'Could not fill this answer. Open AuraSolve and choose Explain now.');
      await sendExtension({type:'apply',planId:result.planId});
    }catch(error){notice.textContent=error.message;notice.hidden=false;}
    finally{running=false;button.disabled=false;button.setAttribute('aria-busy','false');button.textContent='Fill answers';}
  };
  return {open:()=>button.focus(),veil:hidden=>{host.style.visibility=hidden?'hidden':'';}};
}
