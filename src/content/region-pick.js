// Injected into the top frame for region screenshot → solve.
(function () {
  if (globalThis.__auraRegionPick) return;

  function clear() {
    document.getElementById('aurasolve-region-root')?.remove();
    document.getElementById('aurasolve-region-result')?.remove();
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

  const cleanLine = line => plainMath(line).replace(/\*\*/g, '').replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').trim();

  function parseReply(reply) {
    if (reply && typeof reply === 'object') {
      return {
        fills: (reply.fills || []).map(cleanLine).filter(Boolean).slice(0, 8),
        steps: (reply.steps || []).map(cleanLine).filter(Boolean).slice(0, 6),
      };
    }
    const text = plainMath(reply).replace(/\*\*/g, '').trim();
    const fillBlock = text.match(/(?:^|\n)\s*Fill:\s*([\s\S]*?)(?=\n\s*Steps:|$)/i);
    const stepBlock = text.match(/(?:^|\n)\s*Steps:\s*([\s\S]*)$/i);
    if (fillBlock) {
      return {
        fills: fillBlock[1].split(/\n+/).map(cleanLine).filter(Boolean).slice(0, 8),
        steps: (stepBlock?.[1] || '').split(/\n+/).map(cleanLine).filter(Boolean).slice(0, 6),
      };
    }
    return {fills: [], steps: text ? [text] : []};
  }

  function placeCard(card, point) {
    const left = Math.min(window.innerWidth - 320, Math.max(12, (point?.x || window.innerWidth - 340)));
    const top = Math.min(window.innerHeight - 80, Math.max(12, (point?.y || 72)));
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    document.documentElement.append(card);
    const rect = card.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 12) card.style.top = Math.max(12, window.innerHeight - 12 - rect.height) + 'px';
    if (rect.right > window.innerWidth - 12) card.style.left = Math.max(12, window.innerWidth - 12 - rect.width) + 'px';
  }

  function showResult(reply, point) {
    clear();
    const {fills, steps} = parseReply(reply);
    const card = document.createElement('div');
    card.id = 'aurasolve-region-result';
    card.innerHTML = `
      <style>
        #aurasolve-region-result{all:initial;position:fixed;z-index:2147483647;width:min(320px,calc(100vw - 24px));max-height:min(70vh,520px);overflow:auto;display:flex;flex-direction:column;gap:12px;padding:14px 14px 16px;border-radius:18px;background:#fff;color:#111;font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 16px 40px rgba(20,24,40,.18)}
        #aurasolve-region-result *{box-sizing:border-box}
        #aurasolve-region-result .head{display:flex;align-items:center;justify-content:space-between}
        #aurasolve-region-result .head strong{font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8b909e}
        #aurasolve-region-result .x{width:28px;height:28px;border:0;border-radius:8px;background:#f3f4f6;color:#333;font-size:18px;line-height:1;cursor:pointer}
        #aurasolve-region-result .fills{margin:0;font-size:16px;font-weight:650}
        #aurasolve-region-result .mark{display:inline;padding:1px 6px;border-radius:6px;background:#ffe56a;color:#1a1a1a;font-weight:750}
        #aurasolve-region-result ol{margin:0;padding-left:18px;color:#2a2e38;font-size:14px;font-weight:450}
        #aurasolve-region-result li{margin:0 0 6px}
        #aurasolve-region-result .steps strong{display:block;margin-bottom:6px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8b909e}
      </style>
      <div class="head"><strong>Answer</strong><button class="x" type="button" aria-label="Close">×</button></div>
      <p class="fills"></p>
      <div class="steps" hidden><strong>Steps</strong><ol></ol></div>`;
    const fillsNode = card.querySelector('.fills');
    fills.forEach((value, index) => {
      if (index) fillsNode.append(' ');
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = value;
      fillsNode.append(mark);
    });
    if (!fills.length) fillsNode.textContent = 'Could not read an answer.';
    const stepsNode = card.querySelector('.steps');
    if (steps.length) {
      stepsNode.hidden = false;
      const list = stepsNode.querySelector('ol');
      for (const step of steps) {
        const item = document.createElement('li');
        item.textContent = step;
        list.append(item);
      }
    }
    card.querySelector('.x').onclick = () => card.remove();
    placeCard(card, point);
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
    placeCard(card, point);
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
