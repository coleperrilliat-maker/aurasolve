import test from 'node:test';
import assert from 'node:assert/strict';
import {stayOnIncompleteQuestion} from '../src/content/actions.js';
let clicks=0;
const element=extra=>({isConnected:true,getClientRects:()=>[{}],closest:()=>null,getAttribute:()=>null,...extra});
const no=element({innerText:'No',click:()=>clicks++});
const yes=element({innerText:'Yes',click:()=>{throw Error('Must not leave');}});
const dialog=element({innerText:"Important You have not completed this question; you will receive credit only for the work you've done. Are you sure you want to leave this question?",querySelectorAll:()=>[yes,no]});
globalThis.getComputedStyle=()=>({visibility:'visible'});
globalThis.document={hidden:false,querySelectorAll:()=>[dialog]};
test('incomplete-question warning chooses No',()=>{
 assert.deepEqual(stayOnIncompleteQuestion(),{stayed:true});assert.equal(clicks,1);
});
test('unrelated dialog is not clicked',()=>{
 const original=dialog.innerText;dialog.innerText='Are you sure you want to delete this?';
 try{assert.deepEqual(stayOnIncompleteQuestion(),{stayed:false});assert.equal(clicks,1);}
 finally{dialog.innerText=original;}
});
