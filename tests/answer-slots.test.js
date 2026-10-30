import test from 'node:test';
import assert from 'node:assert/strict';
import {answerSlots, answerSlotsSchema, slotsToActions} from '../src/shared/answer-slots.js';
import {solveWithOpenAI} from '../server/openai.js';

const mixed=[
  {id:'a',kind:'radio',group:'why',label:'A. SAS'},{id:'b',kind:'radio',group:'why',label:'B. SSS'},
  {id:'a1',kind:'text',choice:'a',label:'angle'},{id:'b1',kind:'text',choice:'b',label:'side'},
  {id:'tri',kind:'text',label:'triangle ABC is congruent to triangle'},
  {id:'FL1',kind:'select',options:[{value:'FL1-0',label:'Given'},{value:'FL1-1',label:'SAS Postulate'},{value:'FL1-2',label:'Taken',disabled:true}]},
  {id:'c1',kind:'checkbox',label:'AB = DE'},{id:'c2',kind:'checkbox',label:'BC = EF'}
];

test('a mixed question gets one required typed slot per blank',()=>{
  const slots=answerSlots(mixed);
  const schema=answerSlotsSchema(slots);
  assert.deepEqual(schema.required,['choice_1','blank_2','blank_3','blank_4','blank_5','blank_6','blank_7']);
  assert.deepEqual(schema.properties.choice_1.enum,['1) A. SAS','2) B. SSS']);
  assert.deepEqual(schema.properties.blank_5.enum,['1) Given','2) SAS Postulate']);
  assert.equal(schema.properties.blank_6.type,'boolean');
  assert.match(schema.properties.blank_2.description,/use "" unless that option is chosen/);
});

test('slot answers become one action per blank, skipping boxes of unchosen choices',()=>{
  const slots=answerSlots(mixed);
  const actions=slotsToActions({choice_1:'2) B. SSS',blank_2:'ignored',blank_3:'5',blank_4:'DEF',blank_5:'2) SAS Postulate',blank_6:true,blank_7:false},slots);
  assert.deepEqual(actions.map(a=>[a.kind,a.target,a.value]),[
    ['radio','b','B. SSS'],['text','b1','5'],['text','tri','DEF'],['select','FL1','FL1-1'],['checkbox','c1','true'],['checkbox','c2','false']
  ]);
});

test('ungrouped radios share one slot and unknown field kinds fall back to free actions',()=>{
  assert.equal(answerSlots([{id:'x',kind:'radio',label:'A'},{id:'y',kind:'radio',label:'B'}]).length,1);
  assert.equal(answerSlots([{id:'s',kind:'select',options:[]}]),null);
  assert.equal(answerSlots([{id:'m',kind:'matrix'}]),null);
});

const reply=solution=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({choices:[],explanation:'Work.',limitation:'',...solution})}]}]})});
async function withFetch(handler,run){
  const original=globalThis.fetch,previous=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='fixture-only';
  globalThis.fetch=async(_url,options)=>handler(JSON.parse(options.body));
  try{return await run();}
  finally{globalThis.fetch=original;if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
}
const question={question:'Why are the triangles congruent?',dropTargets:[],limitations:[],fields:[
  {id:'a',kind:'radio',group:'why',label:'A. SAS'},{id:'b',kind:'radio',group:'why',label:'B. SSS'},
  {id:'FL1',kind:'select',options:[{value:'FL1-0',label:'Given'},{value:'FL1-1',label:'SAS Postulate'}]}
]};

test('a confident cheap answer is used without calling the strong model',async()=>{
  const models=[];
  const solution=await withFetch(body=>{models.push(body.model);return reply({answer:'A',confidence:.95,supported:true,answers:{choice_1:'1) A. SAS',blank_2:'2) SAS Postulate'}});},
    ()=>solveWithOpenAI(question,'field'));
  assert.deepEqual(models,['gpt-5-mini']);
  assert.deepEqual(solution.actions.map(a=>a.target),['a','FL1']);
});

test('an unsure or unusable cheap answer is re-solved once by the strong model',async()=>{
  const models=[];
  const solution=await withFetch(body=>{
    models.push(body.model);
    return body.model==='gpt-5-mini'
      ? reply({answer:'?',confidence:.4,supported:true,answers:{choice_1:'1) A. SAS',blank_2:'1) Given'}})
      : reply({answer:'A',confidence:.95,supported:true,answers:{choice_1:'1) A. SAS',blank_2:'2) SAS Postulate'}});
  },()=>solveWithOpenAI(question,'field'));
  assert.deepEqual(models,['gpt-5-mini','gpt-5']);
  assert.equal(solution.actions[1].value,'FL1-1');

  models.length=0;
  await withFetch(body=>{
    models.push(body.model);
    if(body.model==='gpt-5-mini')return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'not json'}]}]})};
    return reply({answer:'A',confidence:.95,supported:true,answers:{choice_1:'1) A. SAS',blank_2:'2) SAS Postulate'}});
  },()=>solveWithOpenAI(question,'field'));
  assert.deepEqual(models,['gpt-5-mini','gpt-5']);
});

test('a retry after Pearson marked it wrong goes straight to the strong model',async()=>{
  const models=[];
  await withFetch(body=>{models.push(body.model);return reply({answer:'B',confidence:.9,supported:true,answers:{choice_1:'2) B. SSS',blank_2:'1) Given'}});},
    ()=>solveWithOpenAI({...question,retryContext:[{actions:[{kind:'radio',target:'a',value:'A'}],feedback:'Incorrect.'}]},'field'));
  assert.deepEqual(models,['gpt-5']);
});
