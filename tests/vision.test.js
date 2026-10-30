import test from 'node:test';
import assert from 'node:assert/strict';
import {solveWithOpenAI} from '../server/openai.js';
test('question screenshot reaches vision as a high-detail image',async()=>{
  const original=globalThis.fetch,previous=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='fixture-only';
  const image='data:image/png;base64,fixture';
  globalThis.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);
    assert.deepEqual(body.input[0].content[1],{type:'input_image',image_url:image,detail:'high'});
    assert.equal(JSON.parse(body.input[0].content[0].text).screenshotAttached,true);
    assert.match(body.instructions,/image-based/);
    assert.match(body.instructions,/every answer choice/);
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({answer:'B',choices:['B'],explanation:'Compare the graphs.',confidence:.9,supported:true,limitation:'',actions:[]})}]}]})};
  };
  try{await solveWithOpenAI({question:'Which graph?',fields:[],dropTargets:[],limitations:[],image,imageBased:true},'explain');}
  finally{globalThis.fetch=original;if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
});

test('a geometry diagram tells the model to read the figure and fill the blank',async()=>{
  const original=globalThis.fetch,previous=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='fixture-only';
  const image='data:image/jpeg;base64,fixture';
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);
    assert.match(body.instructions,/Read every angle, side, mark, and label/);
    assert.match(body.instructions,/only has an x blank, answer x/);
    assert.doesNotMatch(body.instructions,/every answer choice/);
    assert.equal(JSON.parse(body.input[0].content[0].text).screenshotAttached,true);
    const solution={answer:'30',choices:[],explanation:'The angle is 30 degrees.',confidence:.9,supported:true,limitation:'',actions:[{kind:'text',target:'x',value:'30',destination:'',x:null,y:null}]};
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(solution)}]}]})};
  };
  try{await solveWithOpenAI({question:'Find the values of x and y. [figure 1]',fields:[{id:'x',kind:'text',label:'x'}],dropTargets:[],limitations:[],image,imageBased:true},'field');}
  finally{globalThis.fetch=original;if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
});
test('a dropdown proof drops the diagram before the model call',async()=>{
  const original=globalThis.fetch,previous=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='fixture-only';
  let calls=0;
  globalThis.fetch=async(_url,options)=>{
    calls++;
    const body=JSON.parse(options.body);
    assert.equal(typeof body.input,'string');
    const payload=JSON.parse(body.input);
    assert.equal(payload.screenshotAttached,false);
    assert.deepEqual(payload.limitations,[]);
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({answer:'Given',choices:[],explanation:'The first statement is given.',confidence:.9,supported:true,limitation:'',actions:[{kind:'select',target:'FL1',value:'FL1-0',destination:'',x:null,y:null},{kind:'select',target:'FL2',value:'FL2-0',destination:'',x:null,y:null}]})}]}]})};
  };
  try {
    await solveWithOpenAI({
      question:'Complete the proof. [figure 1]',visual:true,image:'data:image/png;base64,fixture',
      figureImages:[{label:'triangle',image:'data:image/png;base64,figure'}],
      limitations:['A diagram needs a screenshot to read.'],dropTargets:[],
      fields:[
        {id:'FL1',kind:'select',options:[{value:'FL1-0',label:'Given'}]},
        {id:'FL2',kind:'select',options:[{value:'FL2-0',label:'Definition of midpoint'}]}
      ]
    },'field');
    assert.equal(calls,1);
  } finally {globalThis.fetch=original;if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
});
test('a mixed congruence question tells the model to answer every radio, box, and checkbox',async()=>{
  const original=globalThis.fetch,previous=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='fixture-only';
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);
    assert.match(body.instructions,/6 supplied answer fields/);
    assert.match(body.instructions,/one checkbox action for all 4/);
    assert.match(body.instructions,/congruence blank/);
    assert.match(body.instructions,/one radio action/);
    assert.match(body.instructions,/also wants the answer typed in/);
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({answer:'A',choices:[],explanation:'Matched.',confidence:.9,supported:true,limitation:'',actions:[]})}]}]})};
  };
  try {
    await solveWithOpenAI({question:'Why are the triangles congruent?',dropTargets:[],limitations:[],fields:[
      {id:'r1',kind:'radio',group:'why'},
      {id:'t1',kind:'text'},
      {id:'c1',kind:'checkbox'},{id:'c2',kind:'checkbox'},{id:'c3',kind:'checkbox'},{id:'c4',kind:'checkbox'}
    ]},'explain');
  } finally {globalThis.fetch=original;if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
});
test('a choice with blanks tells the model to fill only that choice',async()=>{
  const original=globalThis.fetch,previous=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='fixture-only';
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);
    assert.match(body.instructions,/inside a radio choice/);
    assert.match(body.instructions,/Do not fill boxes that belong to the other choices/);
    assert.match(body.instructions,/1\/30/);
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({answer:'C',choices:[],explanation:'Add 9.',confidence:.95,supported:true,limitation:'',actions:[]})}]}]})};
  };
  try {
    await solveWithOpenAI({question:'Select the correct choice and fill the boxes within it.',dropTargets:[],limitations:[],fields:[
      {id:'a',kind:'radio',group:'pick'},{id:'c',kind:'radio',group:'pick'},
      {id:'a1',kind:'text',choice:'a'},{id:'c1',kind:'text',choice:'c'},{id:'c2',kind:'text',choice:'c'}
    ]},'explain');
  } finally {globalThis.fetch=original;if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
});
test('old non-reasoning model choices are upgraded to a reasoning model',async()=>{
 const original=globalThis.fetch,previousKey=process.env.OPENAI_API_KEY,previousModel=process.env.OPENAI_MODEL;
 process.env.OPENAI_API_KEY='fixture-only';process.env.OPENAI_MODEL='gpt-4.1-mini';
 const bodies=[];
 globalThis.fetch=async(url,options)=>{
  bodies.push(JSON.parse(options.body));
  return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({answer:'5',choices:[],explanation:'Divide by 2.',confidence:.99,supported:true,limitation:'',actions:[]})}]}]})};
 };
 try{
  const question={question:'Solve 2x = 10',fields:[],dropTargets:[],limitations:[]};
  await solveWithOpenAI(question,'explain','gpt-4.1');
  await solveWithOpenAI(question,'explain');
  await solveWithOpenAI(question,'explain','gpt-5');
  assert.deepEqual(bodies.map(body=>body.model),['gpt-5-mini','gpt-5-mini','gpt-5']);
  assert.equal(bodies[0].reasoning.effort,'medium');
 }finally{
  globalThis.fetch=original;
  if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;
  if(previousModel===undefined)delete process.env.OPENAI_MODEL;else process.env.OPENAI_MODEL=previousModel;
 }
});
test('an unavailable model falls back once instead of failing the question',async()=>{
 const original=globalThis.fetch,previousKey=process.env.OPENAI_API_KEY;
 process.env.OPENAI_API_KEY='fixture-only';
 const models=[];
 globalThis.fetch=async(url,options)=>{
  const model=JSON.parse(options.body).model;models.push(model);
  if(model==='gpt-5-mini')return {ok:false,status:404,text:async()=>'{"error":{"code":"model_not_found","message":"The model does not exist"}}'};
  return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({answer:'5',choices:[],explanation:'Divide by 2.',confidence:.99,supported:true,limitation:'',actions:[]})}]}]})};
 };
 try{
  await solveWithOpenAI({question:'Solve 2x = 10',fields:[],dropTargets:[],limitations:[]},'explain');
  assert.deepEqual(models,['gpt-5-mini','gpt-4.1']);
 }finally{
  globalThis.fetch=original;
  if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;
 }
});
