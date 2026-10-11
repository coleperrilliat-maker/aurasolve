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
  assert.match(text,/Answer/);assert.match(text,/Explanation/);assert.match(text,/Subtract 7/);
  assert.equal(await ui.evaluate(()=>testShadow.querySelectorAll('.answer-card').length),1);
  console.log('PASS: AutoPilot keeps one answer and explanation visible after a failed fill');

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
    document.querySelector('#answer').focus();
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
  await fill.waitForFunction(()=>window.testShadow.querySelector('#status').textContent.startsWith('Field filled.'));
  assert.equal(await fill.locator('#answer').inputValue(),'5');
  assert.equal(await fill.evaluate(()=>window.submits),0);
  assert.match(await fill.evaluate(()=>testShadow.querySelector('#results').textContent),/Subtract 7/);
  console.log('PASS: Fill button writes the selected native input, shows tutoring, and never submits');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
