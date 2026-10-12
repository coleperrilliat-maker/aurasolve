// Agreement is an additional error screen, not an accuracy guarantee.
export function sameActions(first, second) {
  const normalize = actions => JSON.stringify(actions.map(a=>({
    target:a.target,kind:a.kind,value:a.value.trim(),x:a.x,y:a.y,destination:a.destination
  })).sort((a,b)=>a.target.localeCompare(b.target)));
  return first.supported && second.supported && first.actions.length>0 &&
    normalize(first.actions)===normalize(second.actions);
}
export async function verifiedSolve(solve, snapshot, mode) {
  const first=await solve(snapshot,mode,false);
  if(mode==="explain" || !first.supported || !first.actions.length)return first;
  const second=await solve(snapshot,mode,true);
  if(!sameActions(first,second))return {
    ...first,supported:false,actions:[],confidence:Math.min(first.confidence,second.confidence,.49),
    limitation:"Independent solutions disagreed. Review the question before filling.",
    explanation:first.explanation+"\n- **Needs review:** A second solution did not agree; no answer was filled."
  };
  return {...second,confidence:Math.min(first.confidence,second.confidence)};
}
