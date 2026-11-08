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

  function showResult(reply, point) {
    clear();
    const answerMatch = String(reply || '').match(/\*\*Answer:\*\*\s*([\s\S]*?)(?=\n-|\n\n|$)/i);
    const answer = (answerMatch ? answerMatch[1] : String(reply || '').split('\n')[0] || '').replace(/\*\*/g, '').trim();
    const explanation = String(reply || '')
      .replace(/\*\*Answer:\*\*\s*[\s\S]*?(?=\n-|\n\n|$)/i, '')
      .trim() || reply;
    const card = document.createElement('div');
    card.id = 'aurasolve-region-result';
    card.innerHTML = `
      <style>
        #aurasolve-region-result{all:initial;position:fixed;z-index:2147483647;width:min(340px,calc(100vw - 24px));max-height:min(70vh,520px);display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:16px;background:#fff;box-shadow:0 12px 40px rgba(15,18,34,.22),0 0 0 1px rgba(15,18,34,.08);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0e1120;overflow:auto}
        #aurasolve-region-result *{box-sizing:border-box}
        #aurasolve-region-result .head{display:flex;align-items:center;justify-content:space-between;gap:8px}
        #aurasolve-region-result .head strong{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#3b6cff}
        #aurasolve-region-result .x{width:28px;height:28px;border:0;border-radius:8px;background:#f1f3f8;color:#474e63;font-size:18px;cursor:pointer;line-height:1}
        #aurasolve-region-result .box{padding:12px 14px;border-radius:12px;background:#f7f8fb;box-shadow:inset 0 0 0 1px rgba(15,18,34,.06)}
        #aurasolve-region-result .box h3{margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#8b91a4}
        #aurasolve-region-result .box .body{font-size:15px;font-weight:650;overflow-wrap:anywhere}
        #aurasolve-region-result .box.explain .body{font-size:13.5px;font-weight:450;color:#22273a}
        #aurasolve-region-result ul{margin:0;padding-left:18px}
        #aurasolve-region-result p{margin:0 0 6px}
        #aurasolve-region-result p:last-child{margin-bottom:0}
      </style>
      <div class="head"><strong>AuraSolve</strong><button class="x" type="button" aria-label="Close">×</button></div>
      <div class="box"><h3>Answer</h3><div class="body" data-answer></div></div>
      <div class="box explain"><h3>Explanation</h3><div class="body" data-explain></div></div>`;
    const left = Math.min(window.innerWidth - 360, Math.max(12, (point?.x || window.innerWidth / 2) - 160));
    const top = Math.min(window.innerHeight - 80, Math.max(12, (point?.y || 80) + 12));
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    document.documentElement.append(card);
    card.querySelector('[data-answer]').append(rich(answer || '…'));
    card.querySelector('[data-explain]').append(rich(explanation));
    card.querySelector('.x').onclick = () => card.remove();
  }

  function showWaiting(point) {
    clear();
    const card = document.createElement('div');
    card.id = 'aurasolve-region-result';
    card.innerHTML = `
      <style>
        #aurasolve-region-result{all:initial;position:fixed;z-index:2147483647;padding:14px 16px;border-radius:14px;background:#fff;box-shadow:0 12px 40px rgba(15,18,34,.22);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0e1120}
        #aurasolve-region-result .wait{display:flex;align-items:center;gap:10px}
        #aurasolve-region-result .spin{width:14px;height:14px;border:2px solid #c9d7ff;border-top-color:#3b6cff;border-radius:50%;animation:aura-spin .8s linear infinite}
        @keyframes aura-spin{to{transform:rotate(360deg)}}
      </style>
      <div class="wait"><span class="spin"></span><span>Solving this area…</span></div>`;
    card.style.left = Math.min(window.innerWidth - 220, Math.max(12, (point?.x || 24))) + 'px';
    card.style.top = Math.min(window.innerHeight - 60, Math.max(12, (point?.y || 24))) + 'px';
    document.documentElement.append(card);
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
