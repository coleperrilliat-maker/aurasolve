import {snapshot,feedback,visible,findButtons,prepareField} from '../src/content/detection.js';
import {execute,clickControl,dismissFeedback,stayOnIncompleteQuestion,navigateQuestion} from '../src/content/actions.js';
import {runPilot} from '../src/shared/pilot-engine.js';
const fixture=document.querySelector('#fixture'),results=document.querySelector('#results');
const assert=(test,message)=>{if(!test)throw new Error(message);};
const report=text=>{const li=document.createElement('li');li.textContent=text;results.append(li);};
const solution=fields=>({answer:'5',explanation:'Fixture answer.',supported:true,confidence:.99,choices:[],limitation:'',actions:fields.map(f=>({target:f.id,kind:'text',value:'5',x:null,y:null,destination:''}))});
document.querySelector('#run-tests').onclick=async()=>{
 results.replaceChildren();
 try{
  // Reproduce the live Pearson markup: five visible eqEditor wrappers contain
  // disabled focusNode inputs. Only the sixth input belongs to the active part.
  const history=Array.from({length:5},(_,i)=>`<span class="equation eqEditor assessments-components-0-1-2 inputField fNormal ${i===4?'correct':'incorrectInput incorrect'} disabled"><input class="focusNode" disabled value="${i+1}"></span>`).join('');
  fixture.innerHTML=`<div role="heading" aria-level="3">Question 15, fixture</div><span class="progressText">Part 5 of 5</span><nav id="xl_dijit_HigherEdAssignmentReviewNav_test"><a class="questionLabel" aria-label="Question 15, Incorrect">Question 15</a></nav><section data-aura-question><p>Solve 2x = 10.</p>${history}<span class="equation eqEditor assessments-components-0-1-2 inputField fNormal"><input class="focusNode" aria-label="x"></span></section><button id="check" command="checkanswer" disabled>Check answer</button>`;
  let s=snapshot();assert(s.player.progress.current===15 && s.player.progress.part===5,'Wrong current question or part');assert(s.fields.length===1,'Locked field was included');assert(!s.limitations.length,'Completed Pearson editors flagged as unsupported');assert(s.player.controls.submitPresent===1 && s.player.controls.submit===0,'Disabled submit not detected');
  document.querySelector('input[aria-label=x]').oninput=()=>document.querySelector('#check').disabled=false;
  let clicks=0;document.querySelector('#check').onclick=()=>clicks++;
  await execute({id:'test',url:s.url,hash:s.hash,mode:'autopilot',submit:false,requireComplete:true,solution:solution(s.fields)});
  assert(document.querySelector('input[aria-label=x]').value==='5' && !document.querySelector('#check').disabled,'Field did not retain answer/enable submit');
  assert(clicks===0,'Fill submitted unexpectedly');clickControl('submit');assert(clicks===1,'Check answer was not clicked once');
  assert([...document.querySelectorAll('input:disabled')].every((el,i)=>el.value===String(i+1)),'Completed answers were changed');
  const widget=document.createElement('span');widget.className='eqEditor inputField';widget.innerHTML='<input readonly value="read-only history">';fixture.querySelector('section').append(widget);
  assert(!snapshot().limitations.length,'Read-only editor flagged as unsupported');
  widget.innerHTML='<input disabled value="disabled history">';assert(!snapshot().limitations.length,'Disabled inner input flagged as unsupported');
  widget.innerHTML='Active unsupported editor';assert(snapshot().limitations.some(l=>/Pearson math/.test(l)),'Active unsupported editor was not diagnosed');widget.remove();
  document.querySelector('#check').textContent='Continue';
  assert(findButtons('continue').length===1 && findButtons('submit').length===0,'Continue was mistaken for submit');
  report('PASS: Question 15 / Part 5: five completed Pearson editors ignored, active answer filled, Check answer clicked once, Continue identified.');
  report('PASS: disabled/read-only editor history is ignored; an active unsupported editor remains diagnosed.');

  fixture.innerHTML=`<section data-aura-question><p>Solve the next active part: 2x=10.</p>${history}<span class="eqEditor inputField" id="lazy">Click to answer</span></section>`;
  const lazy=document.querySelector('#lazy');lazy.onclick=()=>{lazy.innerHTML='<input aria-label="x">';};
  assert(!snapshot().fields.length,'Lazy field should not already exist');
  await prepareField();assert(snapshot().fields.length===1 && !snapshot().limitations.length,'Shared preparation did not activate the current editor');
  assert([...document.querySelectorAll('input:disabled')].every((el,i)=>el.value===String(i+1)),'Preparation changed completed answers');
  report('PASS: shared preparation activates a lazy current editor while leaving completed parts untouched.');

  let question=21,part=2,retry=0,submits=0,solves=0,persisted=null,plan=null,lastVerdict='unknown';
  const statuses={20:'correct',21:'partial',22:'unanswered'},steps=[];
  function render(){
   fixture.innerHTML=`<div role="heading" aria-level="3">Question ${question}, fixture</div><span class="progressText">Part ${part} of 2</span><nav id="xl_dijit_HigherEdAssignmentReviewNav_test">${[20,21,22].map(n=>`<a href="#" class="questionLabel" aria-label="Question ${n}, ${statuses[n]==='partial'?'Partially correct':statuses[n]}">Question ${n}</a>`).join('')}</nav><section data-aura-question><p>Solve fixture ${question} part ${part} variation ${retry}: 2x=10.</p>${history}<span class="eqEditor inputField"><input aria-label="x"></span></section><button command="checkanswer" id="check" disabled>Check answer</button><button id="next">Next question</button>`;
   document.querySelector('input[aria-label=x]').oninput=()=>document.querySelector('#check').disabled=false;
   for(const link of fixture.querySelectorAll('a'))link.onclick=e=>{e.preventDefault();question=Number(link.textContent.match(/\d+/)[0]);part=1;retry=0;render();};
   document.querySelector('#next').onclick=()=>{throw new Error('Should navigate the unfinished question list, not blindly click Next');};
   document.querySelector('#check').onclick=()=>{
    submits++;const wrong=question===22 && part===1 && retry===0;
    lastVerdict=wrong?'incorrect':'correct';
    if(wrong)statuses[question]='partial';
    if(part===2){statuses[question]=question===22 && retry===0?'partial':'correct';}
    document.querySelector('input[aria-label=x]').disabled=true;
    const button=document.querySelector('#check');button.textContent=part===2?'Similar question':'Continue';button.disabled=false;
    button.onclick=()=>{if(part===2){retry++;part=1;}else part++;render();};
    const link=[...fixture.querySelectorAll('a')].find(a=>a.textContent===`Question ${question}`);
    link.setAttribute('aria-label',`Question ${question}, ${statuses[question]==='partial'?'Partially correct':statuses[question]}`);
    const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.innerHTML=`${wrong?'Incorrect. Try again.':'Correct! Fantastic!'} <button>OK</button>`;dialog.querySelector('button').onclick=()=>dialog.remove();fixture.append(dialog);
   };
  }
  render();
  const warning=document.createElement('div');warning.setAttribute('role','alertdialog');warning.innerHTML='Important: You have not completed this question; you will receive credit only for the work you have done. Are you sure you want to leave this question? <button>Yes</button><button>No</button>';
  warning.querySelectorAll('button')[1].onclick=()=>warning.remove();fixture.append(warning);
  const read=()=>{const q=snapshot();return {tabId:1,assignment:'local-fixture',documentId:'doc',url:q.url,hash:q.hash,promptHash:q.promptHash,fields:q.fields,...q.player,feedback:feedback()};};
  await runPilot({delay:ms=>new Promise(r=>setTimeout(r,Math.min(ms,10))),pollLimit:8,request:async m=>{
   if(m.type==='pilotOpen')return {runId:'fixture',view:read(),checkpoint:persisted};
   if(m.type==='pilotRead')return read();
   if(m.type==='pilotSave'){persisted=structuredClone(m.checkpoint);return {};}
   if(m.type==='solve'){solves++;const q=snapshot();assert(!q.limitations.length,'Completed widgets blocked the next part');plan={id:'test',url:q.url,hash:q.hash,mode:'autopilot',submit:false,requireComplete:true,solution:solution(q.fields)};return {planId:'test',solution:plan.solution,question:q};}
   if(m.type==='apply'){await execute(plan);clickControl('submit');return {submitted:true};}
   if(m.type==='pilotAction'){
    steps.push(m.action.kind);
    if(m.action.kind==='stay')return stayOnIncompleteQuestion();
    if(m.action.kind==='dismiss')return dismissFeedback();
    if(m.action.kind==='question')return navigateQuestion(m.action.number);
    return clickControl(m.action.kind);
   }
   throw new Error('Unknown request '+m.type);
  }});
  assert(statuses[21]==='correct' && statuses[22]==='correct','Did not complete remaining questions');
  assert(submits===5 && solves===5,'Wrong number of model calls or submissions');
  assert(steps[0]==='stay' && steps.filter(s=>s==='similar').length===1 && steps.filter(s=>s==='continue').length===2,'Unexpected navigation flow');
  assert(!persisted.pending,'Pending submit was not cleared');
  report('PASS: complete browser flow: No → resume Part 2 → OK → next unfinished question → wrong → OK → Continue → finish parts → Similar → 100% correct.');
  report(`PASS: ${solves} mock AI solves, ${submits} submissions, no duplicate or locked-part submissions.`);
  report('All browser scenarios passed.');
 }catch(error){report('FAIL: '+error.message);console.error(error);}
};
