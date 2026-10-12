import test from 'node:test';
import assert from 'node:assert/strict';
import {callPageMethod,frameCall} from '../src/background/frame-call.js';

test('page exceptions survive the scripting boundary with their actual message',async()=>{
  globalThis.__auraReady=Promise.resolve();
  globalThis.__aura={execute(){throw new Error('The page did not retain the requested value.');}};
  globalThis.chrome={scripting:{executeScript:async input=>[{result:await input.func(...input.args)}]}};
  await assert.rejects(()=>frameCall(1,'doc','execute',{}),/did not retain/);
});
test('async editor failures are returned rather than disappearing into null',async()=>{
  globalThis.__aura={execute:async()=>{throw new Error('Pearson editor rejected the value.');}};
  assert.deepEqual(await callPageMethod('execute',{}),{ok:false,error:'Pearson editor rejected the value.'});
});
test('successful field writes return the confirmation',async()=>{
  globalThis.__aura={execute:async()=>({filled:1,submitted:false})};
  assert.deepEqual(await frameCall(1,'doc','execute',{}),{filled:1,submitted:false});
});
test('stale content script gives a refresh instruction',async()=>{
  globalThis.__aura={};
  assert.match((await callPageMethod('execute',{})).error,/outdated.*Refresh/);
  delete globalThis.__aura;
  assert.match((await callPageMethod('execute',{})).error,/Refresh the lab page/);
});
