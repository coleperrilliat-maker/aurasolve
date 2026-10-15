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
      kind:{type:"string",enum:["text","select","multiselect","radio","checkbox","point","drag"]},
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
  const seen = new Set(), radioGroups = new Set();
  for (const a of solution.actions) {
    const f = ids.get(a.target);
    if (!f || a.kind !== f.kind || typeof a.value !== "string" || a.value.length > 4000) throw new Error("The solution references an unsupported field.");
    a.value = fieldValue(a.value, f);
    if (seen.has(a.target)) throw new Error("Duplicate field actions are not supported.");
    seen.add(a.target);
    if (a.kind === 'radio') {
      if (radioGroups.has(f.group)) throw new Error('The solution selected more than one answer in a radio group.');
      radioGroups.add(f.group);
    }
    if (a.kind === "select" || a.kind === 'multiselect') {
      // Prefer the actual value. Accept an exact, unique displayed label when
      // a model returns the visible answer instead of an opaque option ID.
      const optionValue=value=>{
        let matches=f.options.filter(o=>o.value===value && !o.disabled);
        if(!matches.length)matches=f.options.filter(o=>o.label===value && !o.disabled);
        if(matches.length!==1)throw new Error('The selected option is unavailable or ambiguous.');
        return matches[0].value;
      };
      if(a.kind==='select')a.value=optionValue(a.value);
      else {
        let values;try{values=JSON.parse(a.value);}catch{throw new Error('Multiple selections must be a JSON list of option values.');}
        if(!Array.isArray(values) || values.some(v=>typeof v!=='string'))throw new Error('Invalid multiple selections.');
        a.value=JSON.stringify([...new Set(values.map(optionValue))].sort());
      }
    }
    if (a.kind === "checkbox" && !["true","false"].includes(a.value)) throw new Error("Invalid checkbox state.");
    if (a.kind === "point" && (!Number.isFinite(a.x) || !Number.isFinite(a.y) || a.x < f.bounds.xMin || a.x > f.bounds.xMax || a.y < f.bounds.yMin || a.y > f.bounds.yMax)) throw new Error("The graph point is outside the supported grid.");
    if (a.kind === "drag" && !snapshot.dropTargets.some(d => d.id === a.destination)) throw new Error("Unknown drop target.");
  }
  return solution;
}

export function missingAnswers(solution, snapshot) {
  const targets=new Set(solution.actions.map(a=>a.target));
  const groups=new Set(snapshot.fields.filter(f=>f.kind==='radio' && targets.has(f.id)).map(f=>f.group));
  return snapshot.fields.filter(f=>f.kind==='radio'?!groups.has(f.group):!targets.has(f.id));
}

