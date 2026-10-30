import test from 'node:test';
import assert from 'node:assert/strict';
import {actionsInDisplayOrder} from '../src/content/actions.js';

test('proof dropdowns run in displayed order even when the plan lists them backwards',()=>{
  const fields=[{id:'FL1'},{id:'FL2'},{id:'FL3'}];
  const actions=actionsInDisplayOrder([
    {kind:'select',target:'FL3',value:'FL3-1'},
    {kind:'select',target:'FL1',value:'FL1-0'},
    {kind:'select',target:'FL2',value:'FL2-2'}
  ], fields);
  assert.deepEqual(actions.map(action=>action.target),['FL1','FL2','FL3']);
});

test('a failed later reason keeps earlier choices and does not advance',async()=>{
  const fields=[{id:'FL1',label:'Given'},{id:'FL2',label:'Definition of midpoint'}];
  const actions=actionsInDisplayOrder([
    {kind:'select',target:'FL2',value:'Definition of midpoint'},
    {kind:'select',target:'FL1',value:'Given'}
  ], fields);
  const chosen=[];
  let advanced=false;
  const fill=async action=>{
    if(action.target==='FL2')throw new Error('FL2 did not keep "Definition of midpoint". The box still shows "nothing".');
    chosen.push(action.value);
  };
  await assert.rejects(async()=>{
    for(const action of actions)await fill(action);
    advanced=true;
  }, /FL2 did not keep "Definition of midpoint"/);
  assert.deepEqual(chosen,['Given']);
  assert.equal(advanced,false);
});
