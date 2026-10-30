// Plain answer boxes need slash fractions; math-editor APIs retain LaTeX.
export function fieldValue(value, field) {
  if (field.kind !== 'text' || field.format === 'latex') return value;
  let text=value.trim().replace(/^\\[([]|\\[)\]]$/g,'');
  const atom=s=>/^[+-]?(?:\d+(?:\.\d+)?|[a-zA-Z])$/.test(s.trim())?s.trim():`(${s.trim()})`;
  for(let i=0;i<12;i++) {
    const next=text.replace(/\\(?:dfrac|tfrac|frac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,(_,a,b)=>`${atom(a)}/${atom(b)}`);
    if(next===text)break;
    text=next;
  }
  return text;
}

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
  if (mode === "explain") {
    solution.actions = [];
    return solution;
  }
  const seen = new Set();
  const radioPicks = new Map();
  for (const a of solution.actions) {
    const f = fieldForAction(a.target, snapshot.fields);
    if (f && a.target !== f.id) {
      a.target = f.id;
      if (f.kind === "radio") a.kind = "radio";
      if (!a.value) a.value = f.adapter === "sara-choice" ? f.label : (optionLetter(f.label) || f.label);
    }
    if (!f || a.kind !== f.kind || typeof a.value !== "string" || a.value.length > 4000) throw new Error("The solution references an unsupported field.");
    a.value = fieldValue(a.value, f);
    if (seen.has(a.target)) throw new Error("Duplicate field actions are not supported.");
    seen.add(a.target);
    if (a.kind === "select" && !f.options.some(o => o.value === a.value && !o.disabled)) {
      const key = text => String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      const named = f.options.filter(o => key(o.label) === key(a.value));
      if (named.length > 1) throw new Error("The selected option is ambiguous.");
      if (named.length !== 1 || named[0].disabled) throw new Error("The selected option is unavailable.");
      a.value = named[0].value;
    }
    if (a.kind === "checkbox" && !["true","false"].includes(a.value)) throw new Error("Invalid checkbox state.");
    if (a.kind === "point" && (!Number.isFinite(a.x) || !Number.isFinite(a.y) || a.x < f.bounds.xMin || a.x > f.bounds.xMax || a.y < f.bounds.yMin || a.y > f.bounds.yMax)) throw new Error("The graph point is outside the supported grid.");
    if (a.kind === "point" && f.adapter === "aria-number-line" &&
      (a.y !== 0 || Math.abs((a.x-f.bounds.xMin)/f.step-Math.round((a.x-f.bounds.xMin)/f.step)) > 1e-8))
      throw new Error("The number-line point does not match an available tick.");
    if (a.kind === "drag" && !snapshot.dropTargets.some(d => d.id === a.destination)) throw new Error("Unknown drop target.");
    if (a.kind === "radio" && f.adapter !== "sara-choice" && f.group) {
      if (radioPicks.has(f.group)) throw new Error("The solution selected more than one answer in a radio group.");
      radioPicks.set(f.group, a.target);
    }
  }
  if (mode !== "explain" && radioPicks.size) {
    const groups = [...new Set((snapshot.fields || []).filter(field => field.kind === "radio" && field.adapter !== "sara-choice" && field.group).map(field => field.group))];
    if (groups.length > 1 && groups.some(group => !radioPicks.has(group))) throw new Error("Each part of this question needs its own answer.");
  }
  return solution;
}
export function radioPartGroups(rows) {
  const ids = new Map(), out = new Map();
  for (const row of rows) {
    const key = row.anchor ?? (row.name ? `name:${row.name}` : row.id);
    if (!ids.has(key)) ids.set(key, `part-${ids.size + 1}`);
    out.set(row.id, ids.get(key));
  }
  return out;
}
function optionLetter(label) {
  const text = String(label || "").trim();
  const wrapped = text.match(/^\(([A-H])\)\s*(?:[.)]\s*)?/i);
  if (wrapped) return wrapped[1].toUpperCase();
  const plain = text.match(/^([A-H])[.)](?:\s|$)/i);
  if (plain) return plain[1].toUpperCase();
  const only = text.match(/^([A-H])$/i);
  return only ? only[1].toUpperCase() : null;
}
function fieldForAction(target, fields) {
  const known = fields.find(field => field.id === target);
  if (known) return known;
  const text = String(target || "").trim();
  const scoped = text.match(/^(part-\d+)\s*[:/#]\s*\(?([A-H])\)?$/i);
  if (scoped) {
    const group = scoped[1].toLowerCase();
    const letter = scoped[2].toUpperCase();
    const scopedMatches = fields.filter(field => field.kind === "radio" && String(field.group || "").toLowerCase() === group && optionLetter(field.label) === letter);
    if (scopedMatches.length === 1) return scopedMatches[0];
  }
  const letter = text.match(/^\(?([A-E])\)?[.):]?$/i)?.[1]?.toUpperCase();
  if (letter) {
    const sara = fields.filter(field => field.adapter === "sara-choice" && String(field.label || "").trim().toUpperCase() === letter);
    if (sara.length === 1) return sara[0];
    const labeled = fields.filter(field => field.kind === "radio" && optionLetter(field.label) === letter);
    if (labeled.length === 1) return labeled[0];
  }
  const byLabel = fields.filter(field => field.kind === "radio" && String(field.label || "").trim().toLowerCase() === text.toLowerCase());
  return byLabel.length === 1 ? byLabel[0] : null;
}

