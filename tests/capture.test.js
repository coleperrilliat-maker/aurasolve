import test from 'node:test';
import assert from 'node:assert/strict';
import {cropBox, preferContentRect} from '../src/shared/capture.js';

test('an image question is cropped to the question and its choices',()=>{
  const box = cropBox({width:1800,height:1000},{x:100,y:40,width:500,height:360},2);
  assert.deepEqual(box,{sx:168,sy:48,sw:1064,sh:784});
});

test('a diagram crop drops the empty player area below the blank',()=>{
  const full = {x:0, y:80, width:1100, height:900};
  const tight = {x:24, y:90, width:420, height:220};
  assert.equal(preferContentRect(full, tight), tight);
  assert.equal(preferContentRect(full, {x:0, y:0, width:20, height:20}), full);
});
test('a text question has no crop',()=>{
  assert.equal(cropBox({width:800,height:600},null,1),null);
  assert.equal(cropBox({width:800,height:600},{x:0,y:0,width:10,height:10},1),null);
});
