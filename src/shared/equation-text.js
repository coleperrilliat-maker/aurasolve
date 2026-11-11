// Canvas often draws the equation as an image, so the question text the
// model sees is only "Convert into slope-intercept form." Pull the equation
// out of the image and keep typed answers in the spaced form those quizzes grade.

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const GENERIC = /^(image|img|equation|latex|math|formula|picture|photo)$/i;

export const EQUATION_ANSWER_RULE = 'When a text answer is an equation (slope-intercept, standard form, point-slope, or anything that must include an equal sign), put the entire equation in that blank, both sides. Slope-intercept looks like "y = 2x - 6". Standard form looks like "3x + 4y = 12". Point-slope looks like "y - 4 = 2(x - 5)". Use one space before and after =, and one space before and after a plus or a minus between two terms. Keep a leading minus attached, as in "y = -5x + 8". Use a plain hyphen and a plain x. Do not return only the right-hand side. Do not copy the question\'s example; convert the equation that belongs to that question. If the equation is an image, read the image. No LaTeX.';

export function needsFullEquation(title) {
  return /slope-intercept|slope intercept|standard form|point-slope|point slope|equal sign/i.test(String(title || ''));
}

export function equationAnswerOk(title, text) {
  const value = clean(text);
  if (!value) return false;
  if (!needsFullEquation(title)) return true;
  return /=/.test(value) && /[a-z]/i.test(value);
}

export function decodeEquationSrc(src) {
  const match = String(src || '').match(/equation_images\/([^/?#]+)/i);
  if (!match) return '';
  let text = match[1];
  for (let pass = 0; pass < 2 && /%[0-9a-f]{2}/i.test(text); pass++) {
    try { text = decodeURIComponent(text); } catch { break; }
  }
  return clean(text
    .replace(/\\left|\\right|\\,/g, '')
    .replace(/\\times|\\cdot/g, '*')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)')
    .replace(/[{}]/g, ''));
}

export function equationFromImage({alt = '', title = '', src = '', equation = ''} = {}) {
  const direct = [equation, alt, title].map(clean).find(value => value && !GENERIC.test(value));
  return direct || decodeEquationSrc(src);
}

export function textWithEquations(root) {
  const parts = [];
  const walk = node => {
    if (!node) return;
    if (node.nodeType === 3) {
      parts.push(node.textContent || '');
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = String(node.tagName || '').toUpperCase();
    if (tag === 'STYLE') return;
    if (tag === 'SCRIPT') {
      if (/math\/tex|math\/mml/i.test(node.type || node.getAttribute?.('type') || '')) parts.push(` ${clean(node.textContent)} `);
      return;
    }
    if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) return;
    const stored = node.getAttribute?.('data-equation-content');
    if (stored && tag !== 'IMG') {
      parts.push(` ${clean(stored)} `);
      return;
    }
    if (tag === 'IMG') {
      const label = equationFromImage({
        alt: node.alt || node.getAttribute?.('alt') || '',
        title: node.title || node.getAttribute?.('title') || '',
        src: node.currentSrc || node.src || node.getAttribute?.('src') || '',
        equation: stored || '',
      });
      if (label) parts.push(` ${label} `);
      return;
    }
    if (tag === 'ANNOTATION') {
      parts.push(` ${clean(node.textContent)} `);
      return;
    }
    const children = node.childNodes ? [...node.childNodes] : [];
    for (const child of children) walk(child);
  };
  walk(root);
  return clean(parts.join(' '));
}

// "y=2x-6" -> "y = 2x - 6", while "y=-5x+8" stays "y = -5x + 8".
export function spaceEquation(value) {
  const raw = String(value ?? '').replace(/[−–—]/g, '-').replace(/\s+/g, '');
  if (!raw || !/[-=+]/.test(raw)) return clean(value);
  let out = '';
  for (const ch of raw) {
    if (ch === '=' || ch === '+') {
      out = `${out.trimEnd()} ${ch} `;
      continue;
    }
    if (ch === '-') {
      const prev = out.trimEnd().slice(-1);
      const unary = !prev || '=(+-*/^'.includes(prev);
      out = unary ? `${out.trimEnd()}${prev === '=' ? ' ' : ''}-` : `${out.trimEnd()} - `;
      continue;
    }
    out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}
