// Agreement is an additional error screen, not an accuracy guarantee.
const sameValue = (left, right) => {
  const a = String(left ?? '').replace(/\s+/g, ' ').trim();
  const b = String(right ?? '').replace(/\s+/g, ' ').trim();
  if (a === b) return true;
  return /^-?\d+(?:\.\d+)?$/.test(a) && /^-?\d+(?:\.\d+)?$/.test(b) && Number(a) === Number(b);
};
export function sameActions(first, second) {
  const actions = solution => (solution.actions || []).map(a=>({
    target:a.target,kind:a.kind,value:String(a.value ?? '').replace(/\s+/g, ' ').trim(),x:a.x,y:a.y,destination:a.destination
  })).sort((a,b)=>a.target.localeCompare(b.target));
  const left = actions(first), right = actions(second);
  return first.supported && second.supported && left.length>0 && left.length===right.length &&
    left.every((action,index)=>action.target===right[index].target && action.kind===right[index].kind &&
      sameValue(action.value, right[index].value) && action.x===right[index].x && action.y===right[index].y && action.destination===right[index].destination);
}

// Strict arithmetic grammar, never eval or page-provided code. Only a complete,
// unambiguous arithmetic prompt can replace the independent model check.
function arithmetic(source){
  const text=source.replace(/\s+/g,'');
  if(!text || !/^[\d.+\-*/^()]+$/.test(text))throw new Error('Not arithmetic');
  let i=0;
  function primary(){
    if(text[i]==='('){i++;const value=expression();if(text[i++]!==')')throw new Error('Missing parenthesis');return value;}
    const match=text.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if(!match)throw new Error('Missing number');i+=match[0].length;return Number(match[0]);
  }
  function power(){const left=primary();if(text[i]==='^'){i++;return left**unary();}return left;}
  function unary(){if(text[i]==='+'){i++;return unary();}if(text[i]==='-'){i++;return -unary();}return power();}
  function term(){let value=unary();while(text[i]==='*' || text[i]==='/'){const op=text[i++],right=unary();value=op==='*'?value*right:value/right;}return value;}
  function expression(){let value=term();while(text[i]==='+' || text[i]==='-'){const op=text[i++],right=term();value=op==='+'?value+right:value-right;}return value;}
  const result=expression();if(i!==text.length || !Number.isFinite(result))throw new Error('Invalid arithmetic');return result;
}
export function arithmeticCheck(snapshot,solution){
  if(snapshot.visual || snapshot.retryContext?.length || snapshot.limitations?.length || snapshot.fields?.length!==1 || solution.actions.length!==1)return null;
  const field=snapshot.fields[0],action=solution.actions[0];
  if(field.kind!=='text' || action.kind!=='text' || field.id!==action.target || field.format==='latex')return null;
  const match=snapshot.question?.trim().match(/^(?:evaluate|calculate|compute|what is)\s*:?\s*([\d\s.+\-*/^()]+)\??$/i);
  if(!match)return null;
  try{
    const actual=arithmetic(match[1]),answer=arithmetic(action.value);
    return Math.abs(actual-answer)<=1e-10*Math.max(1,Math.abs(actual));
  }catch{return null;}
}
function reject(first,message){return {...first,supported:false,actions:[],confidence:Math.min(first.confidence,.49),limitation:message,
  explanation:first.explanation+'\n- **Needs review:** '+message};}
export function coversEveryField(solution, snapshot) {
  const fields = snapshot?.fields || [];
  if (!fields.length || !solution?.actions?.length) return false;
  const targets = new Set(solution.actions.map(action => action.target));
  const seenGroups = new Set();
  for (const field of fields) {
    if (field.kind === 'radio') {
      if (seenGroups.has(field.group)) continue;
      seenGroups.add(field.group);
      const covered = fields.some(other => other.kind === 'radio' && other.group === field.group && targets.has(other.id));
      if (!covered) return false;
    } else if (field.choice) {
      if (targets.has(field.choice) && !targets.has(field.id)) return false;
    } else if (!targets.has(field.id)) return false;
  }
  return true;
}
export function keepCoveredSolution(solution, snapshot) {
  if (!solution || solution.supported || !coversEveryField(solution, snapshot)) return solution;
  const excuse = /cover every|nothing was filled|did not cover|active blank/i.test(solution.limitation || '');
  if (solution.confidence < 0.85 && !excuse) return solution;
  return {...solution, supported:true, confidence:Math.max(solution.confidence || 0, 0.9), limitation:excuse ? '' : (solution.limitation || '')};
}
// One reasoning-model call per question. The model checks its own work; a second
// paid call doubled the cost and mostly surfaced a weaker model's noise.
export async function verifiedSolve(solve, snapshot, mode) {
  const first=keepCoveredSolution(await solve(snapshot,mode), snapshot);
  if(mode==='explain' || !first.supported || !first.actions.length)return first;
  for(const previous of snapshot.retryContext || []){
    if(sameActions(first,{supported:true,actions:previous.actions || []}))return reject(first,'This answer was already rejected by the page. Review this part manually.');
  }
  if(arithmeticCheck(snapshot,first)===false)return reject(first,'The answer failed the arithmetic check. Nothing was filled.');
  return first;
}
