// Browser-only transport fixture. It never contacts the real API or an assignment.
let done=false,release;
const calls=[];
const gate=document.createElement('button');gate.id='fixture-release';gate.textContent='Release mock answer';gate.onclick=()=>release?.();document.body.append(gate);
const report=document.createElement('p');report.id='fixture-report';document.body.append(report);
window.chrome={runtime:{sendMessage:async message=>{
 calls.push(message.type);report.textContent=`Mock solve calls: ${calls.filter(c=>c==='solve').length}; mock submissions: ${calls.filter(c=>c==='apply').length}`;
 if(message.type==='settingsStatus')return {ok:true,data:{configured:true}};
 if(message.type==='inspect')return {ok:true,data:{signed:true,tabId:1,question:{hash:'fixture'}}};
 const view={tabId:1,assignment:'fixture',url:location.href,documentId:'doc',hash:'fixture',promptHash:'fixture',fields:done?[]:[{id:'a1',kind:'text'}],progress:{current:21,part:3,totalParts:3,status:done?'correct':'partial',questions:[{number:21,status:done?'correct':'partial'},{number:22,status:'unanswered'}]},controls:done?{similar:1}:{submitPresent:1},feedback:{state:done?'correct':'unknown',modal:false}};
 if(message.type==='pilotOpen')return {ok:true,data:{view,runId:'fixture',checkpoint:null}};
 if(message.type==='pilotRead')return {ok:true,data:view};
 if(message.type==='solve'){
  await new Promise(resolve=>release=resolve);
  return {ok:true,data:{planId:'fixture',question:{fields:[{id:'a1',kind:'text'}]},solution:{answer:'5',explanation:'- Divide both sides by 2.',supported:true,confidence:.99,actions:[{kind:'text',target:'a1',value:'5'}]}}};
 }
 if(message.type==='apply')done=true;
 return {ok:true,data:{}};
}}};
