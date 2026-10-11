// Correct options to show bolded: the model's picks, or the radio/checkbox fields it chose to fill.
export function pickedChoices(solution, question) {
  if (String(solution.answer || "").includes("\n")) return [];
  const listed = (solution.choices || []).map(c => c.trim()).filter(Boolean);
  if (listed.length) return listed;
  const fields = new Map((question?.fields || []).map(f => [f.id, f]));
  return solution.actions
    .filter(a => a.kind === "radio" || (a.kind === "checkbox" && a.value === "true"))
    .map(a => fields.get(a.target)?.label?.trim())
    .filter(Boolean);
}
