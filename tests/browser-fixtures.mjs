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
    const compact=answerLines({answer:'B. A coordinate plane has a horizontal x-axis.\nD. It is a translation up four units.',choices:[],actions:[]},{fields:[{kind:'radio'}]});
    {
      const numeric=answerLines({answer:'A. y = 8',choices:['A'],actions:[]},{fields:[{kind:'text'}]});
      if(JSON.stringify(numeric)!==JSON.stringify(['y = 8']))throw new Error('Part label replaced numeric answer');
    }
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

  const pearsonListbox=await page.evaluate(async()=>{
    delete window.dijit;
    document.body.innerHTML='<main data-aura-question><p>Determine whether the following statement is always, sometimes, or never true.</p><div class="acctable"><span class="inputcell" role="listbox" id="truth" aria-controls="truth_dropdown"><span class="textbasecell"><span>Choose</span></span></span></div><iframe style="width:500px;height:300px"></iframe></main><div id="truth_dropdown" hidden><div role="option">always</div><div role="option">sometimes</div><div role="option">never</div></div>';
    const control=document.querySelector('#truth'),menu=document.querySelector('#truth_dropdown');
    control.onclick=()=>menu.hidden=false;
    for(const item of menu.children)item.onclick=()=>{control.querySelector('.textbasecell span').textContent=item.textContent;menu.hidden=true;};
    const {createUI}=await import('/src/content/ui.js');createUI();
    const shown=Boolean(document.querySelector('#aurasolve-root'));
    const {editorBridge}=await import('/src/background/editors.js');editorBridge();
    const detector=await import('/src/content/detection.js'),before=detector.snapshot();
    const field=before.fields[0];
    await editorBridge({op:'write',key:field.editorKey,adapter:field.adapter,value:'always'});
    return {shown,kind:field.kind,options:field.options.map(o=>o.label),value:control.textContent,stable:before.hash===detector.snapshot().hash};
  });
  assert.deepEqual(pearsonListbox,{shown:true,kind:'select',options:['always','sometimes','never'],value:'always',stable:true});
  console.log('PASS: Pearson listbox shows Fill before discovery and fills a linked DOM dropdown without a global registry');

  const lazyDropdowns=await page.evaluate(async()=>{
    delete window.dijit;
    document.body.innerHTML='<main data-aura-question><p>Choose both missing words.</p><div class="acctable"><span id="one" role="listbox" class="inputcell" aria-controls="one_dropdown"><span class="textbasecell"><span>Choose</span></span></span><span id="two" role="listbox" class="inputcell" aria-controls="two_dropdown"><span class="textbasecell"><span>Choose</span></span></span></div></main>';
    for(const id of ['one','two']){
      const control=document.getElementById(id);
      control.onclick=()=>setTimeout(()=>{
        document.getElementById(id+'_dropdown')?.remove();
        const menu=document.createElement('div');menu.id=id+'_dropdown';
        for(const word of ['always','sometimes','never']){
          const option=document.createElement('div');option.setAttribute('role','option');option.textContent=word;
          option.onclick=()=>setTimeout(()=>{control.querySelector('.textbasecell span').textContent=word;menu.remove();},60);
          menu.append(option);
        }
        document.body.append(menu);
      },60);
    }
    document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('[id$="_dropdown"]').forEach(el=>el.remove());});
    const {editorBridge}=await import('/src/background/editors.js');
    await editorBridge({op:'prepare'});editorBridge();
    const {snapshot}=await import('/src/content/detection.js');const before=snapshot();
    for(const [i,field] of before.fields.entries())await editorBridge({op:'write',key:field.editorKey,adapter:field.adapter,value:i?'never':'always'});
    return {count:before.fields.length,values:[...document.querySelectorAll('.textbasecell span')].map(el=>el.textContent),stable:before.hash===snapshot().hash};
  });
  assert.deepEqual(lazyDropdowns,{count:2,values:['always','never'],stable:true});
  console.log('PASS: two delayed dropdowns discovered, reopened after menu removal, and filled with verified asynchronous readback');

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
      if(message.type==='inspect')return{ok:true,data:{signed:false,question}};
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
    testShadow.querySelector('button').click();
  });
  await fill.waitForFunction(()=>document.querySelector('#answer').value==='5' && testShadow.querySelector('button').getAttribute('aria-busy')==='false');
  assert.equal(await fill.evaluate(()=>window.submits),0);
  assert.equal(await fill.evaluate(()=>testShadow.querySelectorAll('button').length),1);
  assert.equal(await fill.evaluate(()=>testShadow.querySelector('button').textContent),'Fill answers');
  assert.equal(await fill.evaluate(()=>testShadow.querySelector('.panel')),null);
  assert.equal(await fill.evaluate(()=>document.querySelector('[data-aura-question]').firstElementChild.id),'aurasolve-root');
  console.log('PASS: one inline blue Fill button, no signature or popup, successful fill, no submission');
  await fill.evaluate(()=>{document.querySelector('main').innerHTML='<h1>Course dashboard</h1><input placeholder="Search courses">';});
  await fill.waitForFunction(()=>!document.querySelector('#aurasolve-root'));
  await fill.evaluate(()=>{document.querySelector('main').innerHTML='Solve 2x = 8 <input aria-label="x">';});
  await fill.waitForFunction(()=>Boolean(document.querySelector('#aurasolve-root')));
  await fill.evaluate(()=>{document.querySelector('main').removeAttribute('data-aura-question');document.querySelector('main').innerHTML='<h1>Account settings</h1><input aria-label="Display name">';});
  await fill.waitForFunction(()=>!document.querySelector('#aurasolve-root'));
  console.log('PASS: Fill disappears on dashboards and settings and returns for answerable questions');
  const placement=await fill.evaluate(async()=>{
    document.querySelector('main').innerHTML='<div id="generatedPrompt"><p>If the transformation to the right is an isometry, find the value of y.</p></div><div><input aria-label="y"></div><div id="diagram"><svg width="200" height="200"></svg></div>';
    document.querySelector('main').setAttribute('data-aura-question','');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const host=document.querySelector('#aurasolve-root'),button=testShadow.querySelector('button');
    return {inPrompt:Boolean(host.closest('#generatedPrompt')),height:getComputedStyle(button).height,weight:getComputedStyle(button).fontWeight};
  });
  assert.deepEqual(placement,{inPrompt:true,height:'30px',weight:'400'});
  console.log('PASS: compact regular-weight button stays inside text prompt instead of diagram panel');
  const inventory=await fill.evaluate(async()=>{
    document.querySelector('main').innerHTML='<p>Choose a reason for this statement.</p><select aria-label="Reason"><option value="v">Vertical angles</option></select><input value="private-answer">';
    const {inspectControls}=await import('/src/content/diagnostics.js');return inspectControls();
  });
  assert.ok(inventory.controls.some(c=>c.tag==='SELECT' && c.options[0].label==='Vertical angles'));
  assert.ok(!JSON.stringify(inventory).includes('private-answer'));
  console.log('PASS: read-only inspector reports dropdown options without entered input values');
  const side=await browser.newPage();
  await side.addInitScript(()=>{
    window.chrome={runtime:{sendMessage:async message=>({ok:true,data:message.type==='settingsStatus'?{configured:true}:message.type==='solve'?{solution:{answer:'5',explanation:'Subtract 7, then divide by 3.',actions:[],choices:[]},question:{fields:[]}}:{}})},windows:{getCurrent:async()=>({id:7})},sidePanel:{close:async options=>{window.closedWindow=options.windowId;}}};
  });
  await side.goto(origin+'/src/popup/popup.html');
  await side.getByRole('button',{name:'Explain now'}).click();
  await side.waitForFunction(()=>document.querySelector('#results').textContent.includes('Subtract 7'));
  await side.locator('header').click();
  assert.match(await side.locator('#results').textContent(),/Subtract 7/);
  assert.equal(await side.locator('[data-mode="field"]').count(),0);
  await side.getByRole('button',{name:'Close',exact:true}).click();
  await side.waitForFunction(()=>window.closedWindow===7);
  console.log('PASS: extension Explain now renders internally and Close requests side-panel closure');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
