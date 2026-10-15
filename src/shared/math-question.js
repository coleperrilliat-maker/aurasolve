const strongWriting = /\b(essay|paragraphs?|thesis|reading comprehension|in your own words|word count|grammar|vocabulary|novel|poem|main idea|passage|author|chapter|character|literature)\b/i;
const mathWords = /\b(solve|simplify|equation|fraction|algebra|evaluate|calculate|graph|variable|polynomial|decimal|integer|exponent|radical|sqrt|factor|slope|coordinate|inequalit(?:y|ies))\b/i;
const mathExpr = /\d\s*[=+\-*/^]|[=<>]\s*-?\d|(?:^|\s)[a-z]\s*=\s*-?\d/i;

export function classifySubject({text = '', hasMathMarkup = false, recognizedQuestion = false, hasAnswerField = false} = {}) {
  const source = String(text || '');
  const writing = strongWriting.test(source);
  if (hasMathMarkup && !writing) return 'math';
  if (writing && !hasMathMarkup) return 'writing';
  if (!writing && (mathWords.test(source) || mathExpr.test(source))) return 'math';
  if (!writing && recognizedQuestion && hasAnswerField) return 'math';
  if (writing) return 'writing';
  return 'other';
}

export const mathFillAllowed = snapshot => snapshot?.subject === 'math';

export function meaningfulValue(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return Boolean(text && !/^(answer|type your answer|click to answer|enter answer)$/i.test(text));
}

export function sameEntry(expected, actual, type = '') {
  const left = String(expected ?? '').replace(/\s+/g, '');
  const right = String(actual ?? '').replace(/\s+/g, '');
  if (left === right) return true;
  if ((type === 'number' || type === 'text') && left !== '' && right !== '' && /^-?\d+(?:\.\d+)?$/.test(left) && /^-?\d+(?:\.\d+)?$/.test(right))
    return Number(left) === Number(right);
  return false;
}

export function fillBlocker(limitations = []) {
  const ranked = [/graph control/i, /number line/i, /WIRIS|MathLive|MathQuill|supported editor API/i, /drag item/i, /dropdown/i, /canvas|graph/i];
  for (const pattern of ranked) {
    const found = limitations.find(item => pattern.test(item));
    if (found) return found;
  }
  return limitations[0] || 'No supported math input was found on this question.';
}

function intersects(box, blocker, gap) {
  return box.left - gap < blocker.right && box.right + gap > blocker.left && box.top - gap < blocker.bottom && box.bottom + gap > blocker.top;
}

// Prefer the question's upper right, then nearby open space. Every accepted
// spot keeps 12px from blockers and the viewport edge.
export function placeMathButton(root, blockers, size, viewport) {
  const gap = 12;
  const spots = [
    {left: root.right - size.width - gap, top: root.top + gap},
    {left: root.right - size.width - gap, top: root.top - size.height - gap},
    {left: root.left + gap, top: root.top + gap},
    {left: root.right + gap, top: root.top + gap},
    {left: root.right - size.width - gap, top: root.bottom + gap},
    {left: viewport.width - size.width - gap, top: gap},
  ];
  for (let top = root.top + gap; top <= root.bottom - size.height - gap; top += size.height + gap)
    spots.push({left: root.right - size.width - gap, top});
  return spots.find(spot => {
    const box = {left: spot.left, top: spot.top, right: spot.left + size.width, bottom: spot.top + size.height};
    return box.left >= gap && box.top >= gap && box.right <= viewport.width - gap && box.bottom <= viewport.height - gap
      && !blockers.some(blocker => intersects(box, blocker, gap));
  }) || null;
}

// Resolve when the condition becomes true. The timeout only reports that a
// dynamic editor never appeared; it is not a delay before checking.
export function whenReady(ready, listen, timeoutMs = 8000) {
  if (ready()) return Promise.resolve(true);
  return new Promise(resolve => {
    let settled = false, stop = () => {};
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      queueMicrotask(() => stop());
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    stop = listen(() => { if (ready()) finish(true); }) || (() => {});
  });
}
