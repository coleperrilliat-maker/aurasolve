const clean=value=>String(value || '').replace(/\s+/g,' ').trim();
export function questionStatus(label){
  if(/partially correct|partial credit|\bpartial\b/i.test(label))return 'partial';
  if(/incorrect|wrong/i.test(label))return 'incorrect';
  if(/\bcorrect\b/i.test(label))return 'correct';
  if(/in progress|incomplete|attempted/i.test(label) && !/not attempted/i.test(label))return 'incomplete';
  return 'unanswered';
}
export function controlKind(labels,command=''){
  const texts=labels.map(clean).filter(Boolean);
  // Visible labels take precedence: Pearson reuses command=checkanswer for Continue.
  if(texts.some(t=>/^(continue|next part|continue to next part)$/i.test(t)))return 'continue';
  if(texts.some(t=>/^(similar question|similar exercise|try again)$/i.test(t)))return 'similar';
  if(texts.some(t=>/^(check (my )?answer|final check|submit answer|check)$/i.test(t)))return 'submit';
  if(texts.some(t=>/^(next|next question|next problem)$/i.test(t)))return 'next';
  if(texts.some(t=>/^(ok|okay)$/i.test(t)))return 'dismiss';
  // Never treat assignment Submit, Save or Save best score as a per-part submission.
  if(texts.length)return null;
  return {checkanswer:'submit',similarquestion:'similar',next:'next',continue:'continue'}[command.toLowerCase()] || null;
}
export function assignmentKey(url){
  try{const u=new URL(url);const id=u.searchParams.get('homeworkId') || u.searchParams.get('testId');
    const course=u.searchParams.get('cId') || u.searchParams.get('courseId');
    return u.origin+u.pathname+(id?'?assignment='+id:'')+(course?'&course='+course:'');
  }catch{return url;}
}
export function decidePlayer(view){
  const p=view.progress || {}, controls=view.controls || {};
  if(view.incompleteWarning)return {kind:'stay'};
  if(view.feedback?.modal && view.feedback.state!=='unknown')return {kind:'dismiss'};
  if(controls.continue>0)return {kind:'continue'};
  // A completed question must have terminal controls; a correct part is not a completed question.
  const terminal=controls.similar>0 || (p.status==='correct' && !view.fields.length && !controls.submitPresent);
  if(terminal){
    if(p.status==='correct'){
      const list=p.questions || [];
      const remaining=list.filter(q=>q.status!=='correct' && q.number!==p.current);
      const next=remaining.find(q=>q.number>p.current) || remaining[0];
      if(next)return {kind:'question',number:next.number};
      if(list.length)return {kind:'done'};
      return controls.next?{kind:'next'}:{kind:'pause',reason:'No complete question list is available to confirm completion.'};
    }
    if(controls.similar && ['partial','incorrect','incomplete','unanswered'].includes(p.status))return {kind:'similar'};
    return {kind:'pause',reason:'Waiting for the question score to update.'};
  }
  if(!p.current && view.feedback?.state==='correct' && controls.next)return {kind:'next'};
  if(view.fields.length && controls.submitPresent>0)return {kind:'solve'};
  return {kind:'pause',reason:'Waiting for supported answer fields or a clear Continue/Similar control.'};
}
