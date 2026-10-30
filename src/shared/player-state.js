const clean=value=>String(value || '').replace(/\s+/g,' ').trim();
export function questionStatus(label){
  if(/partially correct|partial credit|\bpartial\b/i.test(label))return 'partial';
  if(/incorrect|wrong/i.test(label))return 'incorrect';
  if(/\bcorrect\b/i.test(label))return 'correct';
  if(/in progress|incomplete|attempted/i.test(label) && !/not attempted/i.test(label))return 'incomplete';
  return 'unanswered';
}
const buttonText=value=>clean(String(value||'').replace(/[\u200B-\u200D\uFEFF\uE000-\uF8FF]/g,'').replace(/\s*[›>»→]+\s*$/,''));
const finalCheckText=text=>text.length<=80 && /\bfinal\s+check\b/i.test(text) && !/\b(?:assignment|homework|test|quiz|exam)\b/i.test(text);
export function controlKind(labels,command='',extra={}){
  const texts=labels.map(buttonText).filter(Boolean);
  const assignmentHandIn=texts.some(t=>/\b(?:submit|finish|turn in) (?:assignment|homework|test|quiz|exam)\b/i.test(t) || /^save best score$/i.test(t));
  // "Final Check" is the last-part Check answer, even when another accessible
  // name on that same control says Submit. A real assignment hand-in stays blocked.
  if(texts.some(finalCheckText) && !assignmentHandIn)return 'submit';
  // Assignment-level controls are never a per-question answer check. Treat a
  // dangerous visible label as authoritative even when Pearson reuses command
  // metadata or another accessible label says "Check answer".
  if(texts.some(t=>/^(submit|save|finish|turn in)$/i.test(t) ||
    /\b(?:submit|finish|turn in) (?:assignment|homework|test|quiz|exam)\b/i.test(t) ||
    /^save best score$/i.test(t)))return null;
  // Visible labels take precedence: Pearson reuses command=checkanswer for Continue.
  if(texts.some(t=>/^(continue|next part|continue to next part)$/i.test(t)))return 'continue';
  if(texts.some(t=>/^(similar question|similar exercise|try again)$/i.test(t)))return 'similar';
  if(texts.some(t=>/^(check (my )?answer|final check|check)$/i.test(t)))return 'submit';
  if(texts.some(t=>/^(next|next question|next problem)$/i.test(t)))return 'next';
  if(texts.some(t=>/^(ok|okay)$/i.test(t)))return 'dismiss';
  if(texts.length)return null;
  const fromCommand={similarquestion:'similar',similarexercise:'similar',next:'next',nextquestion:'next',continue:'continue'}[String(command).toLowerCase()];
  if(fromCommand)return fromCommand;
  // Only the player's own nav Check answer control may be identified from
  // command metadata. Continue, Next, and assignment Submit have labels.
  if(String(command).toLowerCase()==='checkanswer' && extra.nav && !extra.dialog)return 'submit';
  return null;
}
// The red footer control is either Check answer or Next. They advance the
// same way. Assignment Submit is never one of them.
export function footerAdvanceKind(label){
  const text=buttonText(label);
  if(/^(?:check(?:\s+my)?\s+answer|final\s+check)$/i.test(text) || finalCheckText(text))return 'check';
  if(/^next(?:\s+(?:question|problem))?$/i.test(text))return 'next';
  return '';
}
// Several Check answer buttons can be visible. Use the player control at the
// lower right, and never a button inside a hand-in or feedback dialog.
export function pickCheckAnswer(entries){
  const page=entries.filter(entry=>!entry.dialog);
  if(!page.length)return null;
  const rank=entry=>(entry.nav || ['checkanswer','next','nextquestion'].includes(entry.command)?100000:0)+entry.bottom*10+entry.right;
  return page.reduce((best,entry)=>rank(entry)>rank(best)?entry:best);
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
  if(view.feedback?.modal && (view.feedback.state!=='unknown' || view.feedback.dismissible))return {kind:'dismiss'};
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
  // Fill first. Pearson often enables Check answer only after the choice is entered.
  if(view.fields.length)return {kind:'solve'};
  return {kind:'pause',reason:'Waiting for supported answer fields or a clear Continue/Similar control.'};
}
