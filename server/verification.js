import {missingAnswers} from '../src/shared/solution.js';
// Agreement is an additional error screen, not an accuracy guarantee.
export function sameActions(first, second) {
  // Compare only what the executor actually does. A radio's unused value can
  // be "B", the option text, or empty without changing the selected answer.
  const normalize = actions => JSON.stringify(actions.map(a=>({
    target:a.target,kind:a.kind,
    ...(['text','select','multiselect','checkbox'].includes(a.kind)?{value:a.value}:{}),
    ...(a.kind==='point'?{x:a.x,y:a.y}:{}),
    ...(a.kind==='drag'?{destination:a.destination}:{})
  })).sort((a,b)=>a.target.localeCompare(b.target)));
  return first.supported && second.supported && first.actions.length>0 &&
    normalize(first.actions)===normalize(second.actions);
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
  if(snapshot.unmappedControls?.length)return reject(first,snapshot.unmappedControls.join(' '));
  if(snapshot.fields && missingAnswers(first,snapshot).length)return reject(first,'The answer did not cover every active blank. Nothing was filled.');
  for(const previous of snapshot.retryContext || []){
    if(sameActions(first,{supported:true,actions:previous.actions || []}))return reject(first,'This answer was already rejected by the page. Review this part manually.');
  }
  const checked=arithmeticCheck(snapshot,first);
  if(checked===true)return first;
  if(checked===false)return reject(first,'The answer failed the arithmetic check. Nothing was filled.');
  const second=await solve(snapshot,mode,true);
  if(snapshot.fields && missingAnswers(second,snapshot).length)return reject(second,'The checked answer did not cover every active blank. Nothing was filled.');
  if(sameActions(first,second))return {...second,confidence:Math.min(first.confidence,second.confidence)};
  // One outlier is common on close multiple-choice options. Fill only when
  // two of three independent solves choose the same action.
  const third=await solve(snapshot,mode,true);
  if(snapshot.fields && missingAnswers(third,snapshot).length)return reject(third,'The checked answer did not cover every active blank. Nothing was filled.');
  const votes=[first,second,third];
  const agreed=votes.find(candidate=>votes.filter(other=>sameActions(candidate,other)).length>=2);
  if(!agreed)return reject(first,'Independent solutions disagreed. Review the question before filling.');
  return {...agreed,confidence:Math.min(...votes.filter(other=>sameActions(agreed,other)).map(other=>other.confidence))};
}
