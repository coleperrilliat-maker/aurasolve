// A script click inside the page is ignored by Pearson's reason menu.
// Chrome's debugger sends the same real mouse click the ChatGPT extension uses.
export function sameDocument(src, parentHref, childHref) {
  try {
    const left = new URL(src, parentHref);
    const right = new URL(childHref);
    if (left.origin !== right.origin) return false;
    return left.pathname === right.pathname || right.href.startsWith(`${left.origin}${left.pathname}`);
  } catch {
    return false;
  }
}

const hashless = value => String(value || '').split('#')[0];
const mark = frame => `${frame?.id || ''} ${frame?.name || ''}`;

// Pearson's outer frame keeps its launch address, which is not the address of
// the page inside it. The frame id is stable: activityFrame inside PlayerHtml5.
export function ownerRank(iframe, parentHref, child) {
  const childHref = String(child?.href || '');
  if (iframe?.childHref && hashless(iframe.childHref) === hashless(childHref)) return 0;
  if (iframe?.src && sameDocument(iframe.src, parentHref, childHref)) return 1;
  if (/\bactivityFrame\b/i.test(mark(iframe)) && /\/Player\/Player\.aspx/i.test(childHref)) return 2;
  if (/PlayerHtml5/i.test(mark(iframe)) && (child?.iframes || []).some(frame => /\bactivityFrame\b/i.test(mark(frame)))) return 3;
  return null;
}

// local point is inside a nested frame. Add each parent iframe's position
// until the point is in the top page, which is where the real click lands.
export function placeClick(reports, activityFrameId, local, href = '') {
  let current = reports.find(report => report.frameId === activityFrameId);
  if (!current && href) {
    const same = reports.filter(report => hashless(report.href) === hashless(href));
    if (same.length === 1) current = same[0];
  }
  if (!current || !Number.isFinite(local?.x) || !Number.isFinite(local?.y)) return null;
  let x = local.x, y = local.y;
  const seen = new Set();
  while (current.frameId !== 0 && !seen.has(current.frameId)) {
    seen.add(current.frameId);
    let best = null;
    for (const report of reports) {
      if (report.frameId === current.frameId) continue;
      for (const iframe of report.iframes || []) {
        const rank = ownerRank(iframe, report.href, current);
        if (rank == null) continue;
        if (!best || rank < best.rank) best = {report, iframe, rank, ties: 1};
        else if (rank === best.rank) best.ties += 1;
      }
    }
    if (!best || best.ties !== 1) return null;
    x += best.iframe.left;
    y += best.iframe.top;
    current = best.report;
  }
  return current.frameId === 0 ? {x, y} : null;
}

export async function withDebugger(tabId, run) {
  if (!chrome.debugger?.attach) throw new Error('Reload AuraSolve at chrome://extensions and allow the new permission, then try Fill again.');
  try {
    await chrome.debugger.attach({tabId}, '1.3');
  } catch (error) {
    const message = String(error?.message || error);
    if (/already attached/i.test(message)) throw new Error('Chrome is already being controlled on this tab. Close the other controller, then try Fill again.');
    throw new Error('Reload AuraSolve at chrome://extensions and allow the new permission, then try Fill again.');
  }
  try {
    return await run();
  } finally {
    try { await chrome.debugger.detach({tabId}); } catch {}
  }
}

export async function awaitSelection(read, pause = () => Promise.resolve(), attempts = 30) {
  let last = {filled: false, error: 'The reason was not clicked. The box still shows "nothing".'};
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = await read();
    if (last?.filled) return last;
    if (attempt < attempts - 1) await pause();
  }
  return last;
}

export async function trustedClick(tabId, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('The reason list moved. Generate a new answer.');
  const point = {x: Math.round(x), y: Math.round(y)};
  const send = (type, button, buttons, clickCount) => chrome.debugger.sendCommand({tabId}, 'Input.dispatchMouseEvent', {
    type, x: point.x, y: point.y, button, buttons, clickCount
  });
  // Press the words directly. A move first paints the black hover bar.
  await send('mousePressed', 'left', 1, 1);
  await new Promise(resolve => setTimeout(resolve, 40));
  await send('mouseReleased', 'left', 0, 1);
}
