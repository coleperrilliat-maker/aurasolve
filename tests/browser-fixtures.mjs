// Optional browser regression suite: install Playwright and Chromium first.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=resolve(import.meta.dirname,'..');
const server=createServer(async(req,res)=>{
  const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);
  if(!path.startsWith(root+'/')){res.writeHead(403).end();return;}
  try{const body=await readFile(path);res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.css'?'text/css':'text/html');res.end(body);}
  catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  const page=await browser.newPage();
  await page.goto(origin+'/src/options/index.html');
  const result=await page.evaluate(async()=>{
    document.body.innerHTML='<main data-aura-question><section class="question-content">Solve 3x + 7 = 22. <div contenteditable="true" role="textbox" aria-label="x"></div></section></main><button command="checkanswer">Check my answer</button>';
    const detection=await import('/src/content/detection.js');
    const actions=await import('/src/content/actions.js');
    detection.trackSelection();
    const before=detection.snapshot();
    const field=before.fields[0];
    const plan={url:before.url,hash:before.hash,mode:'field',submit:false,solution:{answer:'5',explanation:'Subtract 7. Divide by 3.',supported:true,confidence:.99,limitation:'',actions:[{kind:'text',target:field.id,value:'5',destination:'',x:null,y:null}]}};
    await actions.execute(plan);
    const after=detection.snapshot();
    return {count:before.fields.length,selected:before.selected,value:document.querySelector('[contenteditable]').textContent,stable:before.hash===after.hash,submit:before.controls.submit};
  });
  assert.equal(result.count,1);assert.ok(result.selected);assert.equal(result.value,'5');assert.equal(result.stable,true);assert.equal(result.submit,1);
  console.log('PASS: nested Pearson-style containers, auto-selection, real contenteditable fill, stable snapshot, command button');
  const mixed=await page.evaluate(async()=>{
    document.body.innerHTML='<main data-aura-question><p>Choose the dilation and scale factor.</p><svg width="50" height="50"></svg><label><input type="radio" name="kind" value="reduction">Reduction</label><label><input type="radio" name="kind" value="enlargement">Enlargement</label><input id="scale" aria-label="Scale factor"></main><button command="checkanswer">Check answer</button><button command="next">Next</button>';
    let submits=0, next=0;
    document.querySelector('[command="checkanswer"]').onclick=()=>submits++;
    document.querySelector('[command="next"]').onclick=()=>next++;
    const detector=await import('/src/content/detection.js'), actions=await import('/src/content/actions.js');
    const snap=detector.snapshot();
    const radio=snap.fields.find(f=>f.kind==='radio'), blank=snap.fields.find(f=>f.kind==='text');
    const solution={answer:'Reduction\n1/3',explanation:'Corresponding lengths have ratio one third.',supported:true,confidence:.99,limitation:'',choices:[],actions:[{kind:'radio',target:radio.id,value:'',destination:'',x:null,y:null},{kind:'text',target:blank.id,value:'1/3',destination:'',x:null,y:null}]};
    const plan={url:snap.url,hash:snap.hash,mode:'field',submit:false,solution,visualRead:true};
    await actions.execute(plan);
    await actions.execute({...plan,submit:true});
    actions.clickControl('next');
    const {answerLines}=await import('/src/shared/render.js');
    const compact=answerLines({answer:'B. A coordinate plane has a horizontal x-axis.\nD. It is a translation up four units.',choices:[],actions:[]},{fields:[]});
    return {checked:document.querySelector('input[type="radio"]').checked,value:document.querySelector('#scale').value,submits,next,compact};
  });
  assert.deepEqual(mixed,{checked:true,value:'1/3',submits:1,next:1,compact:['Graph B','D']});
  console.log('PASS: mixed radio and fraction Fill, visual question submission, Next, compact graph and option answers');

  const dropdowns=await page.evaluate(async()=>{
    document.body.innerHTML='<main data-aura-question>The orientations are <div class="dijitSelect" widgetid="orientation" role="combobox">Choose<input type="hidden"></div> so the isometry is a <div class="dijitSelect" widgetid="isometry" role="combobox">Choose</div></main>';
    const widgets={};
    for(const [id,labels] of [['orientation',['same','opposite']],['isometry',['rotation','reflection']]]) {
      let value='';
      widgets[id]={getOptions:()=>labels.map((label,i)=>({value:String(i),label})),_setValueAttr(){},get:()=>value,set:(key,v)=>{value=v;}};
    }
    window.dijit={byId:id=>widgets[id]};
    const {editorBridge}=await import('/src/background/editors.js');
    editorBridge({op:'discover'});
    const detector=await import('/src/content/detection.js');
    const snap=detector.snapshot();
    window.chrome={runtime:{sendMessage:async msg=>{
      const field=snap.fields.find(f=>f.id===msg.target);
      return {ok:true,data:editorBridge({op:'write',key:field.editorKey,adapter:field.adapter,value:'1'})};
    }}};
    const {execute}=await import('/src/content/actions.js');
    await execute({url:snap.url,hash:snap.hash,mode:'field',submit:false,id:'test',solution:{answer:'opposite\nreflection',explanation:'Compare orientations.',confidence:.99,supported:true,limitation:'',actions:snap.fields.map(f=>({kind:'select',target:f.id,value:'1',destination:'',x:null,y:null}))}});
    let rejected=false;try{editorBridge({op:'write',key:snap.fields[0].editorKey,adapter:'dojo-select',value:'missing'});}catch{rejected=true;}
    return {kinds:snap.fields.map(f=>f.kind),options:snap.fields.map(f=>f.options.map(o=>o.label)),values:Object.values(widgets).map(w=>w.get()),stable:snap.hash===detector.snapshot().hash,rejected};
  });
  assert.deepEqual(dropdowns,{kinds:['select','select'],options:[['same','opposite'],['rotation','reflection']],values:['1','1'],stable:true,rejected:true});
  console.log('PASS: two custom Dojo dropdowns expose options, fill both values, reject unavailable options, keep question stable');

  const activated=await page.evaluate(async()=>{
    document.body.innerHTML='<main data-aura-question>Solve 2x = 8<span class="eqEditor inputField" widgetid="fixture">Answer</span></main>';
    const widget=document.querySelector('.eqEditor');
    widget.onclick=()=>{widget.innerHTML='<input class="focusNode" aria-label="x">';};
    const detector=await import('/src/content/detection.js');
    const before=detector.snapshot().fields.length;
    await detector.prepareField();
    return {before,after:detector.snapshot().fields.length,selected:detector.snapshot().selected};
  });
  assert.equal(activated.before,0);assert.equal(activated.after,1);assert.ok(activated.selected);
  console.log('PASS: Fill inspection activates a lazy Pearson-style answer box without a user click');

  const ui=await browser.newPage();
  await ui.goto(origin+'/src/options/index.html');
  await ui.evaluate(async()=>{
    document.body.innerHTML='<main data-aura-question>Solve 3x + 7 = 22<input aria-label="x"></main>';
    const attach=Element.prototype.attachShadow;
    Element.prototype.attachShadow=function(options){const shadow=attach.call(this,options);window.testShadow=shadow;return shadow;};
    const solution={answer:'5',explanation:'Subtract 7, then divide both sides by 3.',supported:true,confidence:.99,limitation:'',actions:[{kind:'text',target:'a1',value:'5'}]};
    window.chrome={runtime:{getURL:path=>new URL('/'+path,location.href).href,sendMessage:async message=>{
      if(message.type==='inspect')return{ok:true,data:{signed:true,question:{selected:'a1'}}};
      if(message.type==='settingsStatus')return{ok:true,data:{configured:true}};
      if(message.type==='solve')return{ok:true,data:{planId:'p1',solution,question:{fields:[],question:'Solve 3x+7=22'}}};
      if(message.type==='apply')return{ok:false,error:'Fixture: editor unavailable'};
      return{ok:true,data:{}};
    }}};
    const {createUI}=await import('/src/content/ui.js');createUI();
    testShadow.querySelector('[data-mode="autopilot"]').click();
  });
  await ui.waitForFunction(()=>window.testShadow.querySelector('#status').textContent.includes('Fixture: editor unavailable'));
  const text=await ui.evaluate(()=>testShadow.querySelector('#results').textContent);
  assert.match(await ui.evaluate(()=>testShadow.querySelector('.build').textContent),/1\.13\.12/);
  assert.match(text,/Answer/);assert.match(text,/Explanation/);assert.match(text,/Subtract 7/);
  assert.equal(await ui.evaluate(()=>testShadow.querySelectorAll('.answer-card').length),1);
  console.log('PASS: AutoPilot keeps one answer and explanation visible after a failed fill');
  await ui.evaluate(()=>{delete window.chrome.runtime;testShadow.querySelector('[data-mode="field"]').click();});
  await ui.waitForFunction(()=>!testShadow.querySelector('#reconnect').hidden);
  const disconnectedText=await ui.evaluate(()=>testShadow.querySelector('#fill-status').textContent);
  assert.match(disconnectedText,/Refresh this lab page/);
  assert.doesNotMatch(disconnectedText,/Cannot read properties/);
  assert.equal(await ui.evaluate(()=>testShadow.querySelector('[data-mode="field"]').disabled),true);
  console.log('PASS: losing chrome.runtime shows refresh recovery and stops further actions');

  const fill=await browser.newPage();
  await fill.goto(origin+'/src/options/index.html');
  await fill.evaluate(async()=>{
    document.body.innerHTML='<main data-aura-question>Solve 3x + 7 = 22<input id="answer" aria-label="x"></main><button id="submit">Submit</button>';
    window.submits=0;document.querySelector('#submit').onclick=()=>window.submits++;
    const attach=Element.prototype.attachShadow;
    Element.prototype.attachShadow=function(options){const shadow=attach.call(this,options);window.testShadow=shadow;return shadow;};
    const detection=await import('/src/content/detection.js');
    const actions=await import('/src/content/actions.js');
    const {callPageMethod}=await import('/src/background/frame-call.js');
    window.__aura={execute:actions.execute};
    detection.trackSelection();
    // No answer-box click or focus: Fill must find it itself.
    let plan;
    window.chrome={runtime:{getURL:path=>new URL('/'+path,location.href).href,sendMessage:async message=>{
      const question=detection.snapshot();
      if(message.type==='inspect')return{ok:true,data:{signed:true,question}};
      if(message.type==='settingsStatus')return{ok:true,data:{configured:true}};
      if(message.type==='solve'){
        const solution={answer:'5',explanation:'Subtract 7. Divide by 3.',supported:true,confidence:.99,limitation:'',actions:[{kind:'text',target:question.selected,value:'5',destination:'',x:null,y:null}]};
        plan={url:question.url,hash:question.hash,mode:'field',submit:false,solution};
        return{ok:true,data:{planId:'p1',solution,question}};
      }
      if(message.type==='apply')return await callPageMethod('execute',plan);
      return{ok:true,data:{}};
    }}};
    const {createUI}=await import('/src/content/ui.js');createUI();
    testShadow.querySelector('[data-mode="field"]').click();
  });
  await fill.waitForFunction(()=>window.testShadow.querySelector('#status').textContent.startsWith('Answers filled.'));
  assert.equal(await fill.locator('#answer').inputValue(),'5');
  assert.equal(await fill.evaluate(()=>window.submits),0);
  assert.match(await fill.evaluate(()=>testShadow.querySelector('#results').textContent),/^$/);
  assert.equal(await fill.evaluate(()=>testShadow.querySelector('.panel').hidden),true);
  assert.equal(await fill.evaluate(()=>testShadow.querySelector('[data-mode="field"]').getAttribute('aria-busy')),'false');
  console.log('PASS: Fill button writes the selected native input, stays popup-free, restores its emoji, and never submits');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
