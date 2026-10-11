import test from 'node:test';
import assert from 'node:assert/strict';
import {sendExtension} from '../src/shared/messaging.js';
test('missing chrome or runtime gives a reconnect instruction, not a TypeError',async()=>{
  for(const chrome of [undefined,{}, {runtime:{}}]){
    globalThis.chrome=chrome;
    await assert.rejects(()=>sendExtension({type:'inspect'}),error=>error.code==='AURA_DISCONNECTED' && /Refresh this lab page/.test(error.message));
  }
});
test('invalidated extension contexts and missing receivers use reconnect recovery',async()=>{
  for(const message of ['Extension context invalidated.','Could not establish connection. Receiving end does not exist.']){
    globalThis.chrome={runtime:{sendMessage:async()=>{throw new Error(message);}}};
    await assert.rejects(()=>sendExtension({type:'inspect'}),error=>error.code==='AURA_DISCONNECTED');
  }
});
test('valid messaging preserves successful results and real field errors',async()=>{
  globalThis.chrome={runtime:{sendMessage:async()=>({ok:true,data:{filled:1}})}};
  assert.deepEqual(await sendExtension({type:'apply'}),{filled:1});
  chrome.runtime.sendMessage=async()=>({ok:false,error:'The field disappeared.'});
  await assert.rejects(()=>sendExtension({type:'apply'}),error=>error.message==='The field disappeared.' && !error.code);
});
test('missing replies never automatically retry a potentially completed write',async()=>{
  let calls=0;
  globalThis.chrome={runtime:{sendMessage:async()=>{calls++;return undefined;}}};
  await assert.rejects(()=>sendExtension({type:'apply'}),error=>error.code==='AURA_DISCONNECTED');
  assert.equal(calls,1);
});
