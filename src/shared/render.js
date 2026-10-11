import {pickedChoices} from "./choices.js";

// Loaded separately so a math-library failure can't stop AuraSolve from starting; math falls back to plain text.
let katex = null;
import("../vendor/katex/katex.js").then(module => { katex = module.default; }).catch(error => console.warn("AuraSolve math rendering unavailable:", error.message));

const el = (tag, className) => { const node = document.createElement(tag); if (className) node.className = className; return node; };

// \( \), \[ \] and $$ $$ are math; a lone "$" stays text so prices like $20,000 are not typeset.
const MATH = /(\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\$\$[\s\S]+?\$\$)/g;

function math(node, text) {
  text.split(MATH).forEach((part, i) => {
    if (!part) return;
    if (!(i % 2)) { node.append(part); return; }
    const display = !part.startsWith("\\(");
    const span = el("span", "math");
    if (!katex) { span.textContent = part.slice(2, -2); node.append(span); return; }
    try { katex.render((display ? "" : "\\displaystyle ") + part.slice(2, -2), span, {displayMode: display, throwOnError: false, output: "html", strict: "ignore"}); }
    catch { span.textContent = part; }
    node.append(span);
  });
}

function italics(node, text) {
  text.split(/(?<![*\w])\*(?![\s*])([^*\n]+?)(?<!\s)\*(?![*\w])/g).forEach((part, i) => {
    if (!part) return;
    if (i % 2) { const em = el("em"); math(em, part); node.append(em); }
    else math(node, part);
  });
}

// Text nodes and KaTeX output only: "**bold**", "*italic*" and LaTeX math.
function rich(node, text) {
  text.split(/\*\*(.+?)\*\*/g).forEach((part, i) => {
    if (!part) return;
    if (i % 2) { const bold = el("strong"); italics(bold, part); node.append(bold); }
    else italics(node, part);
  });
  return node;
}

export async function loadMathFonts(urlFor) {
  const css = await (await fetch(urlFor("src/vendor/katex/katex.min.css"))).text();
  for (const [, rule] of css.matchAll(/@font-face\{([^}]+)\}/g)) {
    const family = rule.match(/font-family:([^;]+)/)?.[1], file = rule.match(/url\((fonts\/[^)]+\.woff2)\)/)?.[1];
    if (!family || !file) continue;
    const face = new FontFace(family, `url(${urlFor(`src/vendor/katex/${file}`)})`, {
      style: rule.match(/font-style:([^;]+)/)?.[1] || "normal", weight: rule.match(/font-weight:([^;]+)/)?.[1] || "400",
    });
    document.fonts.add(face);
    // Load now so the first answer isn't blank while KaTeX's font-display:block waits on a lazy load.
    face.load().catch(() => {});
  }
}

const lines = (text, bullet) => String(text || "").split(/\n+/).map(line => line.replace(bullet, "").trim()).filter(Boolean);

export function explanationSteps(text) {
  const steps = lines(text, /^\s*(?:[-•*]|\d+[.)])\s+/);
  if (steps.length === 1 && steps[0].length > 160) return steps[0].split(/(?<=[.!?])\s+(?=[A-Z(])/).filter(Boolean);
  return steps;
}

export function compactAnswer(text, isChoice = false) {
  // Only shorten explicit option labels; preserve numeric answers and blank labels.
  const match = String(text).trim().match(/^\(?([A-Za-z])[).:]\s+(.+)$/s);
  if (!match) return text;
  if (!isChoice) return match[2];
  return /coordinate plane|line segments? (?:are|is) plotted|graph (?:shows|of)|horizontal x-axis/i.test(match[2]) ? `Graph ${match[1]}` : match[1];
}

export function answerLines(solution, question) {
  const fields=question?.fields || [];
  const isChoice=fields.some(field=>field.kind==='radio' || field.kind==='checkbox' || field.adapter==='sara-choice');
  const picks = isChoice ? pickedChoices(solution, question) : [];
  return (picks.length ? picks : lines(solution.answer, /^\s*[-•*]\s+/)).map(line=>compactAnswer(line,isChoice));
}

export function renderSolution(result, label) {
  const card = el("article", "answer-card");
  if (label) { const tag = el("div", "tag"); tag.textContent = label; card.append(tag); }
  const answers = answerLines(result.solution, result.question);
  const head = el("h3"); head.textContent = "Answer"; card.append(head);
  if (answers.length > 1) {
    const list = el("ul", "answers");
    for (const line of answers) list.append(rich(el("li"), line));
    card.append(list);
  } else card.append(rich(el("p", "answer"), answers[0] || ""));
  const steps = explanationSteps(result.solution.explanation);
  if (steps.length) {
    const why = el("h3"); why.textContent = "Explanation"; card.append(why);
    const list = el("ul", "steps");
    for (const step of steps) list.append(rich(el("li"), step));
    card.append(list);
  }
  if (result.solution.limitation) { const note = el("p", "note"); note.textContent = result.solution.limitation; card.append(note); }
  return card;
}

