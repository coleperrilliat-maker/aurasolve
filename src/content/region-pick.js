// Injected into the top frame for region screenshot → solve.
(function () {
  if (globalThis.__auraRegionPick) return;

  function clear() {
    document.getElementById('aurasolve-region-root')?.remove();
    document.getElementById('aurasolve-region-result')?.remove();
  }

  function rich(text) {
    const box = document.createElement('div');
    for (const raw of String(text || '').split(/\n+/)) {
      const line = raw.trim();
      if (!line) continue;
      const item = line.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
      const node = document.createElement(item ? 'li' : 'p');
      const source = item ? item[1] : line;
      source.split(/\*\*(.+?)\*\*/g).forEach((part, index) => {
        if (!part) return;
        if (index % 2) {
          const strong = document.createElement('strong');
          strong.textContent = part;
          node.append(strong);
        } else node.append(part);
      });
      if (item) {
        let list = box.querySelector(':scope > ul:last-child');
        if (!list) { list = document.createElement('ul'); box.append(list); }
        list.append(node);
      } else box.append(node);
    }
    return box;
  }

  const plainMath = text => String(text || '')
    .replace(/\\[()[\]]/g, '')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^{}]*)\}/g, '√($1)')
    .replace(/\\(times|cdot|div|pm|leq?|geq?|neq?|approx|infty|pi|theta|degree|circ)\b/g, (_, name) => ({times:'×', cdot:'·', div:'÷', pm:'±', le:'≤', leq:'≤', ge:'≥', geq:'≥', ne:'≠', neq:'≠', approx:'≈', infty:'∞', pi:'π', theta:'θ', degree:'°', circ:'°'})[name])
    .replace(/\^\{\\?circ\}/g, '°')
    .replace(/\^\\circ/g, '°')
    .replace(/\^\{([^{}]*)\}/g, '^$1')
    .replace(/\\(left|right)\b/g, '')
    .replace(/[ \t]{2,}/g, ' ');

  function shortReply(reply) {
    const text = plainMath(reply).replace(/\*\*/g, '').trim();
    if (/^Filled in\b/i.test(text)) return text.split('\n')[0].trim();
    const answerMatch = text.match(/(?:^|\n)\s*Answer:\s*([\s\S]*?)(?=\n(?:Explanation|Filled in)|$)/i);
    const answer = (answerMatch ? answerMatch[1] : text.split('\n')[0] || '').trim();
    return answer.slice(0, 160) || 'Done.';
  }

  function placeToast(card, point) {
    const left = Math.min(window.innerWidth - 280, Math.max(12, (point?.x || window.innerWidth / 2) - 120));
    const top = Math.min(window.innerHeight - 56, Math.max(12, (point?.y || 80) + 8));
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    document.documentElement.append(card);
    const rect = card.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 12) card.style.top = Math.max(12, window.innerHeight - 12 - rect.height) + 'px';
    if (rect.right > window.innerWidth - 12) card.style.left = Math.max(12, window.innerWidth - 12 - rect.width) + 'px';
  }

  function showResult(reply, point) {
    clear();
    const card = document.createElement('div');
    card.id = 'aurasolve-region-result';
    card.innerHTML = `
      <style>
        #aurasolve-region-result{all:initial;position:fixed;z-index:2147483647;max-width:min(320px,calc(100vw - 24px));display:inline-flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:#11141c;color:#fff;font:600 13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.28)}
        #aurasolve-region-result *{box-sizing:border-box}
        #aurasolve-region-result .msg{min-width:0;overflow-wrap:anywhere}
        #aurasolve-region-result .x{flex:none;width:22px;height:22px;border:0;border-radius:6px;background:transparent;color:rgba(255,255,255,.7);font-size:16px;line-height:1;cursor:pointer}
      </style>
      <span class="msg"></span><button class="x" type="button" aria-label="Close">×</button>`;
    card.querySelector('.msg').textContent = shortReply(reply);
    card.querySelector('.x').onclick = () => card.remove();
    placeToast(card, point);
    setTimeout(() => card.isConnected && card.remove(), 6000);
  }

  function showWaiting(point) {
    clear();
    const card = document.createElement('div');
    card.id = 'aurasolve-region-result';
    card.innerHTML = `
      <style>
        #aurasolve-region-result{all:initial;position:fixed;z-index:2147483647;padding:10px 12px;border-radius:12px;background:#11141c;color:#fff;font:600 13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.28)}
        #aurasolve-region-result .wait{display:flex;align-items:center;gap:10px}
        #aurasolve-region-result .spin{width:12px;height:12px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:aura-spin .8s linear infinite}
        @keyframes aura-spin{to{transform:rotate(360deg)}}
      </style>
      <div class="wait"><span class="spin"></span><span>Solving…</span></div>`;
    placeToast(card, point);
  }

  async function crop(imageUrl, box) {
    const image = await createImageBitmap(await (await fetch(imageUrl)).blob());
    const scaleX = image.width / window.innerWidth;
    const scaleY = image.height / window.innerHeight;
    const sx = Math.max(0, Math.round(box.x * scaleX));
    const sy = Math.max(0, Math.round(box.y * scaleY));
    const sw = Math.max(1, Math.min(image.width - sx, Math.round(box.w * scaleX)));
    const sh = Math.max(1, Math.min(image.height - sy, Math.round(box.h * scaleY)));
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext('2d').drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  function start(imageUrl) {
    clear();
    const root = document.createElement('div');
    root.id = 'aurasolve-region-root';
    root.innerHTML = `
      <style>
        #aurasolve-region-root{all:initial;position:fixed;inset:0;z-index:2147483646;cursor:crosshair;user-select:none;overflow:hidden}
        #aurasolve-region-root .layer{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none}
        #aurasolve-region-root .veil{position:absolute;inset:0;background:rgba(8,12,24,.55);pointer-events:none}
        #aurasolve-region-root .select{position:absolute;box-shadow:0 0 0 9999px rgba(8,12,24,.55);border:2px solid #3b6cff;overflow:hidden;pointer-events:none}
        #aurasolve-region-root .select .cut{position:absolute;max-width:none;pointer-events:none}
        #aurasolve-region-root .hint{position:fixed;left:50%;top:18px;transform:translateX(-50%);padding:8px 14px;border-radius:999px;background:rgba(15,18,34,.88);color:#fff;font:600 13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:none;white-space:nowrap;z-index:1}
      </style>
      <img class="layer" alt="">
      <div class="veil"></div>
      <div class="hint">Drag to select · Esc to cancel</div>`;
    const layer = root.querySelector('.layer');
    const veil = root.querySelector('.veil');
    layer.src = imageUrl;
    const select = document.createElement('div');
    select.className = 'select';
    select.hidden = true;
    const cut = document.createElement('img');
    cut.className = 'cut';
    cut.alt = '';
    cut.src = imageUrl;
    select.append(cut);
    root.append(select);
    document.documentElement.append(root);

    let origin = null;
    let box = null;

    const sizeCut = () => {
      cut.style.width = window.innerWidth + 'px';
      cut.style.height = window.innerHeight + 'px';
    };
    sizeCut();

    const paint = (next) => {
      box = next;
      if (!box || box.w < 2 || box.h < 2) {
        select.hidden = true;
        veil.hidden = false;
        return;
      }
      veil.hidden = true;
      select.hidden = false;
      select.style.left = box.x + 'px';
      select.style.top = box.y + 'px';
      select.style.width = box.w + 'px';
      select.style.height = box.h + 'px';
      cut.style.left = -box.x + 'px';
      cut.style.top = -box.y + 'px';
    };

    const finish = async (cancelled) => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', sizeCut);
      root.remove();
      if (cancelled || !box || box.w < 12 || box.h < 12) {
        chrome.runtime.sendMessage({type: 'regionCancelled'}).catch(() => {});
        return;
      }
      const point = {x: box.x + box.w / 2, y: box.y + box.h};
      showWaiting(point);
      try {
        const image = await crop(imageUrl, box);
        chrome.runtime.sendMessage({type: 'regionPicked', image, point}).catch(() => {});
      } catch (error) {
        showResult(error.message || 'Could not capture that area.', point);
        chrome.runtime.sendMessage({type: 'regionCancelled'}).catch(() => {});
      }
    };

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(true);
      }
    };

    root.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      origin = {x: event.clientX, y: event.clientY};
      paint({x: origin.x, y: origin.y, w: 0, h: 0});
    });
    root.addEventListener('pointermove', (event) => {
      if (!origin) return;
      const x = Math.min(origin.x, event.clientX);
      const y = Math.min(origin.y, event.clientY);
      paint({x, y, w: Math.abs(event.clientX - origin.x), h: Math.abs(event.clientY - origin.y)});
    });
    root.addEventListener('pointerup', () => {
      if (!origin) return;
      origin = null;
      finish(false);
    });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', sizeCut);
  }

  globalThis.__auraRegionPick = {
    start,
    showResult,
    clear,
  };
})();
