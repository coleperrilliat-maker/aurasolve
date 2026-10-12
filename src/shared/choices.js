const MULTI = /select all|choose all|all that apply|mark all|check all|(choose|select|pick|which) (two|three|four|2|3|4)\b/i;
const letterOf = text => String(text).trim().match(/^\(?([A-Za-z]|\d{1,2})[).:]\s/)?.[1]?.toUpperCase();

// Single-answer questions sometimes come back with every option listed; keep the one the solution actually concludes.
function single(solution, listed) {
  const stated = [...String(solution.explanation || "").matchAll(/answer is\s*(?:option\s*)?\(?([A-Za-z]|\d{1,2})\)?(?![a-z])/gi)].pop()?.[1]?.toUpperCase();
  const answer = String(solution.answer || "").trim();
  const wanted = stated || (!answer.includes("\n") ? letterOf(answer) : null);
  if (wanted) return listed.find(c => letterOf(c) === wanted) || null;
  return listed.find(c => c.trim() === answer) || null;
}

// Correct options to show bolded: the model's picks, or the radio/checkbox fields it chose to fill.
export function pickedChoices(solution, question) {
  const fields = question?.fields || [];
  const many = fields.some(f => f.kind === "checkbox") || MULTI.test(question?.question || "");
  let listed = (solution.choices || []).map(c => c.trim()).filter(Boolean);
  // Multi-blank answers (proofs) are one value per line; show those lines rather than unlabeled picks.
  if (String(solution.answer || "").includes("\n") && !listed.every(letterOf)) return [];
  if (listed.length > 1 && !many) { const pick = single(solution, listed); listed = pick ? [pick] : []; }
  if (listed.length) return listed;
  if (String(solution.answer || "").includes("\n")) return [];
  const byId = new Map(fields.map(f => [f.id, f]));
  return (solution.actions || [])
    .filter(a => a.kind === "radio" || (a.kind === "checkbox" && a.value === "true"))
    .map(a => byId.get(a.target)?.label?.trim())
    .filter(Boolean);
}

