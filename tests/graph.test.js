import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSolution, withDrawing, solutionSchema} from '../src/shared/solution.js';
import {drawingSteps} from '../src/shared/render.js';
import {solveWithOpenAI} from '../server/openai.js';
import {drawingKey, majorityDrawing} from '../server/verification.js';

const base={explanation:'- Midpoint D is (9, 3).',answer:'Line through (9, 3) and (10, 7)',choices:[],confidence:.9,supported:false,limitation:'',actions:[]};
const bisector=[{tool:'line',points:[{x:9,y:3},{x:10,y:7}]}];

test('a drawing is validated and kept in explain mode',()=>{
  const solution=validateSolution({...base,drawing:bisector},{fields:[]},'explain');
  assert.deepEqual(solution.drawing,bisector);
  assert.throws(()=>validateSolution({...base,drawing:[{tool:'line',points:[{x:1,y:1}]}]},{fields:[]},'explain'),/invalid drawing/);
  assert.throws(()=>validateSolution({...base,drawing:[{tool:'spiral',points:[{x:1,y:1}]}]},{fields:[]},'explain'),/invalid drawing/);
  assert.throws(()=>validateSolution({...base,drawing:[{tool:'line',points:[{x:2,y:2},{x:2,y:2}]}]},{fields:[]},'explain'),/two different points/);
});

test('the drawing schema is strict and required only when asked for',()=>{
  const schema=withDrawing(solutionSchema);
  assert.ok(schema.required.includes('drawing'));
  assert.equal(schema.properties.drawing.items.additionalProperties,false);
  assert.ok(!solutionSchema.required.includes('drawing'));
});

test('drawing steps tell the student which tool and which points',()=>{
  const steps=drawingSteps(bisector);
  assert.match(steps[0],/Click to enlarge graph/);
  assert.match(steps[1],/\*\*Line\*\* tool\. Click \*\*\(9, 3\)\*\*, then \*\*\(10, 7\)\*\*/);
  assert.match(steps.at(-1),/Save/);
  assert.deepEqual(drawingSteps(undefined),[]);
});

test('a graphing-tool question gets three careful solves that must return a drawing',async()=>{
  const original=globalThis.fetch,previous=process.env.OPENAI_API_KEY;
  const bodies=[];
  process.env.OPENAI_API_KEY='test';
  globalThis.fetch=async(url,options)=>{
    bodies.push(JSON.parse(options.body));
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...base,drawing:bisector})}]}]})};
  };
  try{
    const solution=await solveWithOpenAI({question:'Use the graphing tool to graph the perpendicular bisector of AB.',fields:[],graphTool:true,visual:true,image:'data:image/jpeg;base64,AAAA'},'explain');
    assert.equal(bodies.length,3);
    assert.equal(bodies[0].reasoning.effort,'high');
    assert.ok(bodies[0].text.format.schema.required.includes('drawing'));
    assert.match(bodies[0].instructions,/graphing tool/);
    assert.deepEqual(solution.drawing,bisector);
  }finally{
    globalThis.fetch=original;
    if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;
  }
});

test('the same line through different points counts as one drawing, and the majority wins',()=>{
  const line=(a,b,confidence=.9)=>({confidence,drawing:[{tool:'line',points:[{x:a[0],y:a[1]},{x:b[0],y:b[1]}]}]});
  assert.equal(drawingKey(line([9,3],[10,7])),drawingKey(line([11,11],[8,-1])));
  assert.notEqual(drawingKey(line([9,3],[10,7])),drawingKey(line([9.5,3],[10.5,7])));
  const winner=majorityDrawing([line([9.5,3],[10.5,7],1),line([9,3],[10,7],.8),line([10,7],[9,3],.85)]);
  assert.deepEqual(winner.drawing[0].points,[{x:10,y:7},{x:9,y:3}]);
  const onGrid=majorityDrawing([line([8,-1],[10,7],1),line([9,3],[10,7],.8),line([9,3],[10,7],.7)]);
  assert.deepEqual(onGrid.drawing[0].points,[{x:9,y:3},{x:10,y:7}]);
  const split=majorityDrawing([line([9.5,3],[10.5,7],.9),line([9,3],[10,7],.95)]);
  assert.ok(split.confidence<=.6);
});
