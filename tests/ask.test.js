import test from 'node:test';
import assert from 'node:assert/strict';
import {askOpenAI} from '../server/openai.js';

const text=reply=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:reply}]}]})});
async function withFetch(handler,run){
  const original=globalThis.fetch,previous=process.env.OPENAI_API_KEY;
  const bodies=[];
  process.env.OPENAI_API_KEY='test';
  globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);bodies.push(body);return handler(body,bodies.length);};
  try{await run(bodies);}finally{globalThis.fetch=original;if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
}

test('chat sends the conversation and attaches the screenshot to the latest question',async()=>{
  await withFetch(()=>text('  **Answer:** 4  '),async bodies=>{
    const reply=await askOpenAI({messages:[{role:'user',content:'Hi'},{role:'assistant',content:'Hello'},{role:'user',content:'Solve this'}],image:'data:image/png;base64,AAAA',solve:true});
    assert.equal(reply,'**Answer:** 4');
    const input=bodies[0].input;
    assert.equal(input.length,3);
    assert.equal(input[1].role,'assistant');
    assert.deepEqual(input[2].content.map(part=>part.type),['input_text','input_image']);
    assert.equal(bodies[0].reasoning.effort,'medium');
    assert.equal(bodies[0].store,false);
  });
});

test('plain chat uses low effort and keeps only the last 12 messages',async()=>{
  await withFetch(()=>text('Sure.'),async bodies=>{
    const messages=Array.from({length:21},(_,i)=>({role:i%2?'assistant':'user',content:`m${i}`}));
    await askOpenAI({messages});
    assert.equal(bodies[0].input.length,12);
    assert.equal(bodies[0].input.at(-1).content,'m20');
    assert.equal(bodies[0].reasoning.effort,'low');
  });
});

test('chat rejects a missing question and a non-image attachment',async()=>{
  await withFetch(()=>text('x'),async bodies=>{
    await assert.rejects(askOpenAI({messages:[{role:'assistant',content:'Hello'}]}),/Ask a question first/);
    await assert.rejects(askOpenAI({messages:[{role:'user',content:'Hi'}],image:'https://example.com/a.png'}),/screenshot is invalid/);
    assert.equal(bodies.length,0);
  });
});

test('chat falls back to another model when the first one is unavailable',async()=>{
  await withFetch((body,count)=>count===1?{ok:false,status:404,text:async()=>'The model does not exist'}:text('Fallback answer'),async bodies=>{
    assert.equal(await askOpenAI({messages:[{role:'user',content:'Hi'}]}),'Fallback answer');
    assert.equal(bodies.length,2);
    assert.notEqual(bodies[0].model,bodies[1].model);
  });
});
