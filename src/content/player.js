import {controlKind,questionStatus} from '../shared/player-state.js';
const clean=value=>String(value || '').replace(/\s+/g,' ').trim();
export function readPlayer(doc,visible){
  const headings=[...doc.querySelectorAll('[role="heading"],h2,h3')].filter(visible).map(e=>clean(e.innerText));
  const current=Number(headings.map(t=>t.match(/^Question\s+(\d+)(?:,|\s|$)/i)).find(Boolean)?.[1]) || null;
  const partText=[...doc.querySelectorAll('.progressText')].filter(visible).map(e=>clean(e.innerText)).find(t=>/^Part \d+ of \d+$/i.test(t));
  const parts=partText?.match(/Part (\d+) of (\d+)/i);
  const links=[...doc.querySelectorAll('[id^="xl_dijit_HigherEdAssignmentReviewNav_"] a.questionLabel')];
  const questions=links.map(e=>{
    const label=clean(e.getAttribute('aria-label') || e.innerText);
    return {number:Number(label.match(/^Question\s+(\d+)/i)?.[1]),status:questionStatus(label)};
  }).filter(q=>q.number>0);
  const controls={submit:0,submitPresent:0,continue:0,next:0,similar:0};
  for(const el of doc.querySelectorAll('button,input[type="button"],input[type="submit"],[role="button"],a.navButton,[command="checkanswer"],[command="continue"],[command="similarexercise"],[command="next"],[command="nextquestion"],[command="similarquestion"]')){
    if(!visible(el))continue;
    const nav=el.matches?.('button.navButton, a.navButton, .navButton');
    const dialog=Boolean(el.closest?.('.xlDialogButtonContainer, [role="dialog"], [role="alertdialog"], .dijitDialog, .feedbackDialog'));
    const kind=controlKind([el.innerText,el.value,el.getAttribute('aria-label'),el.getAttribute('title')],el.getAttribute('command') || '',{nav,dialog});
    if(kind==='submit')controls.submitPresent++;
    if(kind in controls && !el.disabled && el.getAttribute('aria-disabled')!=='true')controls[kind]++;
  }
  const dialogs=[...doc.querySelectorAll('[role="dialog"],[role="alertdialog"],.dijitDialog,.modal')].filter(visible);
  const incompleteWarning=dialogs.some(e=>/you have not completed this question/i.test(e.innerText) && /leave this question/i.test(e.innerText));
  return {progress:{current,part:Number(parts?.[1]) || null,totalParts:Number(parts?.[2]) || null,status:questions.find(q=>q.number===current)?.status || 'unknown',questions},controls,incompleteWarning};
}
export function goToQuestion(doc,number,visible){
  const candidates=[...doc.querySelectorAll('[id^="xl_dijit_HigherEdAssignmentReviewNav_"] a.questionLabel')]
    .filter(e=>visible(e) && Number(clean(e.innerText).match(/^Question\s+(\d+)$/i)?.[1])===number);
  if(candidates.length!==1)throw new Error('The target question is not visible in the question list. Expand the list and resume.');
  candidates[0].click();return {clicked:true};
}
