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
export async function verifiedSolve(solve, snapshot, mode) {
  const first=await solve(snapshot,mode,false);
  if(mode==='explain' || !first.supported || !first.actions.length)return first;
  for(const previous of snapshot.retryContext || []){
    if(sameActions(first,{supported:true,actions:previous.actions || []}))return reject(first,'This answer was already rejected by the page. Review this part manually.');
  }
  const checked=arithmeticCheck(snapshot,first);
  if(checked===true)return first;
  if(snapshot.imageBased && first.actions.every(action=>action.kind==='radio' || action.kind==='checkbox'))return first;
  const menus=(snapshot.fields || []).filter(field=>field.kind==='select' && field.options?.length);
  if(menus.length && menus.length===(snapshot.fields || []).length && first.actions.length===menus.length && first.actions.every(action=>action.kind==='select'))return first;
  if(checked===false)return reject(first,'The answer failed the arithmetic check. Nothing was filled.');
  const second=await solve(snapshot,mode,true);
  if(!sameActions(first,second))return reject(first,snapshot.imageBased || /draw the next figure|list of figures/i.test(snapshot.question || '')
    ? 'The two readings of the figure pattern did not match. Nothing was filled.'
    : 'Independent solutions disagreed. Review the question before filling.');
  return {...second,confidence:Math.min(first.confidence,second.confidence)};
}
