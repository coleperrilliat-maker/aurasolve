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
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({answer:'B',choices:['B'],explanation:'Compare the graphs.',confidence:.9,supported:true,limitation:'',actions:[]})}]}]})};
  };
  try{await solveWithOpenAI({question:'Which graph?',fields:[],dropTargets:[],limitations:[],image},'explain');}
  finally{globalThis.fetch=original;if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
});

test('the extension model preference overrides a legacy Railway mini default',async()=>{
 const original=globalThis.fetch,previousKey=process.env.OPENAI_API_KEY,previousModel=process.env.OPENAI_MODEL;
 process.env.OPENAI_API_KEY='fixture-only';process.env.OPENAI_MODEL='gpt-4.1-mini';
 const models=[];
 globalThis.fetch=async(url,options)=>{
  models.push(JSON.parse(options.body).model);
  return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({answer:'5',choices:[],explanation:'Divide by 2.',confidence:.99,supported:true,limitation:'',actions:[]})}]}]})};
 };
 try{
  const question={question:'Solve 2x = 10',fields:[],dropTargets:[],limitations:[]};
  await solveWithOpenAI(question,'explain','gpt-4.1');
  await solveWithOpenAI(question,'explain');
  assert.deepEqual(models,['gpt-4.1','gpt-4.1-mini']);
 }finally{
  globalThis.fetch=original;
  if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;
  if(previousModel===undefined)delete process.env.OPENAI_MODEL;else process.env.OPENAI_MODEL=previousModel;
 }
});
