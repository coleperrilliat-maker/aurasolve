import {sendExtension} from '../shared/messaging.js';
import {questionRoot,snapshot,visible} from './detection.js';
import {BUILD_VERSION} from '../shared/version.js';
import {DEFAULT_OVERLAY, OVERLAY_KEY, normalizeOverlay, readOverlay, writeOverlay} from '../shared/overlay.js';

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

function placeHost(host, settings, root) {
  const fixed = settings.zone.startsWith('fixed-') || settings.zone === 'custom';
  host.style.cssText = fixed
    ? 'display:block;position:fixed;z-index:2147483646;margin:0;padding:4px;background:transparent;box-sizing:border-box;max-width:min(280px,calc(100vw - 24px))'
    : `display:block;float:${settings.zone === 'prompt-left' ? 'left' : 'right'};position:relative;z-index:2147483646;margin:6px 10px 8px 12px;padding:4px;background:transparent;box-sizing:border-box;max-width:calc(100% - 32px)`;
  if (settings.zone === 'fixed-tr') { host.style.top = '16px'; host.style.right = '16px'; host.style.left = 'auto'; host.style.bottom = 'auto'; }
  else if (settings.zone === 'fixed-tl') { host.style.top = '16px'; host.style.left = '16px'; host.style.right = 'auto'; host.style.bottom = 'auto'; }
  else if (settings.zone === 'fixed-br') { host.style.bottom = '16px'; host.style.right = '16px'; host.style.left = 'auto'; host.style.top = 'auto'; }
  else if (settings.zone === 'fixed-bl') { host.style.bottom = '16px'; host.style.left = '16px'; host.style.right = 'auto'; host.style.top = 'auto'; }
  else if (settings.zone === 'custom') {
    host.style.left = settings.x + '%';
    host.style.top = settings.y + '%';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
  }
  if (fixed) {
    (document.body || document.documentElement).append(host);
    return;
  }
  if (root && root !== document.body && root !== document.documentElement) {
    const prompt = promptBox(root);
    if (settings.zone === 'prompt-left') prompt.prepend(host);
    else prompt.prepend(host);
  } else if (window === window.top) (document.querySelector('main,[role="main"]') || document.body)?.prepend(host);
}

export function createUI() {
  const host = document.createElement('div');
  host.id = 'aurasolve-root';
  host.dataset.auraVersion = BUILD_VERSION;
  const shadow = host.attachShadow({mode: 'closed'});
  const icon = chrome.runtime.getURL('icons/icon-128.png');
  const face = (text, settings) => settings.invisible
    ? `<span class="hit" aria-hidden="true"></span>`
    : `<img class="mark" src="${icon}" alt=""><span>${text}</span>`;
  shadow.innerHTML = `<style>
    :host{font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}[hidden]{display:none!important}
    .wrap{position:relative;display:inline-flex;flex-direction:column;align-items:flex-end;gap:4px}
    button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-width:148px;height:42px;padding:0 18px 0 12px;border:0;border-radius:12px;background:#fff;color:var(--aura-color,#0666f5);font:600 15px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.14);cursor:pointer;outline:none;user-select:none;touch-action:none}
    button:hover,button:focus,button:focus-visible,button:disabled{background:#fff;color:var(--aura-color,#0666f5);box-shadow:0 4px 12px rgba(0,0,0,.14);outline:none}
    button:disabled{cursor:wait}
    button.ghost{min-width:72px;width:72px;height:42px;padding:0;background:transparent;box-shadow:none;border:1px dashed transparent;color:transparent}
    button.ghost:hover,button.ghost:focus,button.ghost:focus-visible{background:transparent;box-shadow:none;border-color:transparent;color:transparent}
    button.ghost.editing{border-color:rgba(6,102,245,.55);background:rgba(6,102,245,.08)}
    .hit{display:block;width:100%;height:100%}
    .mark{width:22px;height:22px;flex:none;display:block;object-fit:contain}
    .spinner{width:16px;height:16px;border:2px solid color-mix(in srgb,var(--aura-color,#0666f5) 20%,transparent);border-top-color:var(--aura-color,#0666f5);border-radius:50%;animation:spin .8s linear infinite;flex:none}
    @keyframes spin{to{transform:rotate(360deg)}}
    .drag{display:none;align-self:stretch;height:10px;border-radius:999px;background:color-mix(in srgb,var(--aura-color,#0666f5) 28%,#fff);cursor:grab;touch-action:none}
    .wrap.movable .drag{display:block}
    .wrap.dragging .drag{cursor:grabbing}
    p{margin:0;color:#475569;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-weight:500;max-width:280px;text-align:right}
    p.ghost-note{opacity:0;pointer-events:none;height:0;margin:0;overflow:hidden}
  </style><div class="wrap"><div class="drag" title="Drag to move" aria-hidden="true"></div><button type="button" title="AuraSolve ${BUILD_VERSION}" aria-busy="false"></button><p role="status" aria-live="polite" hidden></p></div>`;
  const wrap = shadow.querySelector('.wrap');
  const button = shadow.querySelector('button');
  const notice = shadow.querySelector('p');
  const drag = shadow.querySelector('.drag');
  let running = false;
  let settings = {...DEFAULT_OVERLAY};
  let veiled = false;

  function paint() {
    wrap.style.setProperty('--aura-color', settings.color);
    button.classList.toggle('ghost', settings.invisible);
    notice.classList.toggle('ghost-note', settings.invisible);
    wrap.classList.toggle('movable', settings.zone === 'custom' && !settings.invisible);
    button.title = settings.invisible
      ? `AuraSolve ${BUILD_VERSION} · invisible Fill zone`
      : `AuraSolve ${BUILD_VERSION}`;
    if (!running) button.innerHTML = face(settings.label, settings);
    if (settings.invisible) {
      button.setAttribute('aria-label', settings.label);
      // Keep a real hit target; never remove from accessibility tree.
      button.style.opacity = '1';
    } else {
      button.removeAttribute('aria-label');
    }
  }

  function mount() {
    if (veiled) { host.style.visibility = 'hidden'; }
    else host.style.visibility = '';
    const root = questionRoot(), current = snapshot();
    const sara = current.fields.some(field => field.adapter === 'sara-choice');
    const lazy = root && [...root.querySelectorAll('span.eqEditor.inputField, span.eqEditor[widgetid], .acctable .inputcell[role="listbox"], .dijitSelect, .xlFillin, [role="listbox"][aria-haspopup], [role="combobox"], [aria-haspopup="listbox"], .mq-editable-field')].some(visible);
    const answering = Boolean(root && current.question && (sara || (!current.fallback && (current.fields.length || lazy))));
    if (!answering) { if (host.isConnected) host.remove(); return; }
    const frame = [...document.querySelectorAll('iframe')].find(el => el.getBoundingClientRect().width > 400 && el.getBoundingClientRect().height > 250);
    // The question may live in a child frame. Do not put a second toolbar
    // above that iframe in its parent document.
    if (frame && !current.fields.length && !lazy) return;
    paint();
    placeHost(host, settings, root);
  }

  async function refresh(next) {
    settings = normalizeOverlay(next || await readOverlay());
    mount();
  }

  button.onclick = async () => {
    if (running) return;
    running = true; button.disabled = true; button.setAttribute('aria-busy', 'true');
    button.innerHTML = settings.invisible
      ? `<span class="spinner" aria-hidden="true"></span>`
      : `<span class="spinner" aria-hidden="true"></span><span>Filling…</span>`;
    notice.hidden = true;
    try {
      await sendExtension({type: 'prepareField'});
      const result = await sendExtension({type: 'solve', mode: 'field'});
      if (!result.solution.supported || result.solution.confidence < .85 || !result.solution.actions.length) throw new Error(result.solution.limitation || 'Could not fill this answer. Open AuraSolve and choose Explain now.');
      await sendExtension({type: 'apply', planId: result.planId, confirmIncorrect: true});
      notice.hidden = true;
    } catch (error) {
      if (!settings.invisible) { notice.textContent = error.message; notice.hidden = false; }
      else console.warn('AuraSolve Fill failed:', error.message);
    } finally {
      running = false; button.disabled = false; button.setAttribute('aria-busy', 'false');
      button.innerHTML = face(settings.label, settings);
    }
  };

  // Drag only in custom zone. Saves viewport percent so it survives resize.
  let dragState = null;
  const onMove = event => {
    if (!dragState) return;
    const x = Math.min(95, Math.max(0, ((event.clientX - dragState.ox) / window.innerWidth) * 100));
    const y = Math.min(95, Math.max(0, ((event.clientY - dragState.oy) / window.innerHeight) * 100));
    settings = {...settings, zone: 'custom', x, y};
    placeHost(host, settings, questionRoot());
  };
  const onUp = async () => {
    if (!dragState) return;
    dragState = null;
    wrap.classList.remove('dragging');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    await writeOverlay(settings);
  };
  drag.addEventListener('pointerdown', event => {
    if (settings.zone !== 'custom' || settings.invisible) return;
    event.preventDefault();
    const rect = host.getBoundingClientRect();
    dragState = {ox: event.clientX - rect.left, oy: event.clientY - rect.top};
    wrap.classList.add('dragging');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  refresh();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[OVERLAY_KEY]) refresh(changes[OVERLAY_KEY].newValue);
  });
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; mount(); });
  });
  observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'aria-hidden', 'disabled']});
  return {
    open: () => button.focus(),
    veil: hidden => { veiled = hidden; host.style.visibility = hidden ? 'hidden' : ''; },
    refresh,
  };
}
