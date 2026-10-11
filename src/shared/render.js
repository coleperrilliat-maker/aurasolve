import {pickedChoices} from "./choices.js";

const el = (tag, className) => { const node = document.createElement(tag); if (className) node.className = className; return node; };

// Renders "**bold**" spans as <strong> using text nodes only.
function rich(node, text) {
  text.split(/\*\*(.+?)\*\*/g).forEach((part, i) => {
    if (!part) return;
    if (i % 2) { const bold = el("strong"); bold.textContent = part; node.append(bold); }
    else node.append(part);
  });
  return node;
}

const lines = (text, bullet) => String(text || "").split(/\n+/).map(line => line.replace(bullet, "").trim()).filter(Boolean);

export function explanationSteps(text) {
  const steps = lines(text, /^\s*(?:[-•*]|\d+[.)])\s+/);
  if (steps.length === 1 && steps[0].length > 160) return steps[0].split(/(?<=[.!?])\s+(?=[A-Z(])/).filter(Boolean);
  return steps;
}

export function answerLines(solution, question) {
  const picks = pickedChoices(solution, question);
  return picks.length ? picks : lines(solution.answer, /^\s*[-•*]\s+/);
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
