import test from 'node:test';
import assert from 'node:assert/strict';
import {cropBox} from '../src/shared/capture.js';

test('an image question is cropped to the question and its choices',()=>{
  const box = cropBox({width:1800,height:1000},{x:100,y:40,width:500,height:360},2);
  assert.deepEqual(box,{sx:168,sy:48,sw:1064,sh:784});
});

test('a text question has no crop',()=>{
  assert.equal(cropBox({width:800,height:600},null,1),null);
  assert.equal(cropBox({width:800,height:600},{x:0,y:0,width:10,height:10},1),null);
});
