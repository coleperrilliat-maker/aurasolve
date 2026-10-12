// Orchestration is independent of the UI and page adapter.
export async function runAutoPilot({request, status, result, live, sleep, limit=5}) {
  for(let index=1;index<=limit;index++){
    live();status(`Solving question ${index} of ${limit}…`);
    const answer=await request({type:"solve",mode:"autopilot"});live();
    if(!answer.solution.supported || answer.solution.confidence<.85 || !answer.solution.actions.length){
      result(answer,index);throw new Error(answer.solution.limitation || "This answer needs review before filling.");
    }
    status("Filling answers and clicking Check answer…");
    await request({type:"apply",planId:answer.planId});live();
    result(answer,index);
    let outcome;
    for(let poll=0;poll<30;poll++){
      await sleep(500);live();
      outcome=await request({type:"feedback",planId:answer.planId});live();
      if(outcome.state!=="unknown")break;
    }
    if(outcome?.state!=="correct")throw new Error(outcome?.state==="incorrect"
      ?"Pearson marked the answer incorrect. AutoPilot stopped for review."
      :"No result appeared after Check answer. Check the page before retrying.");
    status(`Question ${index} confirmed correct.`);
    if(index===limit)return;
    await request({type:"next",planId:answer.planId});live();
    // Wait for a new stable prompt, not a changed feedback message or input value.
    let seen=null,ready=false;
    const old=answer.question.promptHash || answer.question.hash;
    for(let poll=0;poll<30;poll++){
      await sleep(500);live();
      let next;
      try { next=(await request({type:"inspect"})).question; } catch {continue;}
      live();
      const key=next.promptHash || next.hash;
      if(key!==old && key===seen){ready=true;break;}
      seen=key!==old?key:null;
    }
    if(!ready)throw new Error("The next question did not finish loading. AutoPilot stopped.");
  }
}
