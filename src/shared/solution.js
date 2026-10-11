export const solutionSchema = {
  type: "object", additionalProperties: false,
  // explanation comes first so the model works the problem before committing to an answer.
  properties: {
    explanation: {type:"string"}, answer: {type:"string"}, choices: {type:"array",items:{type:"string"}},
    confidence: {type:"number"}, supported: {type:"boolean"},
    limitation: {type:"string"},
    actions: {type:"array",items:{type:"object",additionalProperties:false,properties:{
      kind:{type:"string",enum:["text","select","radio","checkbox","point","drag"]},
      target:{type:"string"}, value:{type:"string"}, destination:{type:"string"},
      x:{type:["number","null"]}, y:{type:["number","null"]}
    },required:["kind","target","value","destination","x","y"]}}
  }, required:["explanation","answer","choices","confidence","supported","limitation","actions"]
};
export function validateSolution(solution, snapshot, mode) {
  if (!solution || typeof solution.answer !== "string" || typeof solution.explanation !== "string" ||
      typeof solution.supported !== "boolean" || typeof solution.limitation !== "string" ||
      !Number.isFinite(solution.confidence) || solution.confidence < 0 || solution.confidence > 1 || !Array.isArray(solution.actions))
    throw new Error("The model returned an invalid solution. Nothing was filled.");
  if (solution.choices === undefined) solution.choices = [];
  // Models sometimes emit a literal "\n" before the next step; LaTeX like \neq must survive.
  const breaks = text => text.replace(/\\n(?=\s*(?:[-•*]|\d{1,2}[.)])\s)/g, "\n");
  solution.explanation = breaks(solution.explanation);
  solution.answer = breaks(solution.answer);
  if (!Array.isArray(solution.choices) || solution.choices.length > 12 || solution.choices.some(c => typeof c !== "string" || c.length > 500))
    throw new Error("The model returned invalid answer choices.");
  if (solution.actions.length > 24) throw new Error("Too many actions in the response.");
  const ids = new Map(snapshot.fields.map(f => [f.id, f]));
  const seen = new Set();
  for (const a of solution.actions) {
    const f = ids.get(a.target);
    if (!f || a.kind !== f.kind || typeof a.value !== "string" || a.value.length > 4000) throw new Error("The solution references an unsupported field.");
    if (seen.has(a.target)) throw new Error("Duplicate field actions are not supported.");
    seen.add(a.target);
    if (mode === "field" && a.target !== snapshot.selected) throw new Error("The solution tried to change a different field.");
    if (a.kind === "select" && !f.options.some(o => o.value === a.value && !o.disabled)) throw new Error("The selected option is unavailable.");
    if (a.kind === "checkbox" && !["true","false"].includes(a.value)) throw new Error("Invalid checkbox state.");
    if (a.kind === "point" && (!Number.isFinite(a.x) || !Number.isFinite(a.y) || a.x < f.bounds.xMin || a.x > f.bounds.xMax || a.y < f.bounds.yMin || a.y > f.bounds.yMax)) throw new Error("The graph point is outside the supported grid.");
    if (a.kind === "drag" && !snapshot.dropTargets.some(d => d.id === a.destination)) throw new Error("Unknown drop target.");
  }
  return solution;
}
