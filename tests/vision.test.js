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
