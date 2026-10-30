import test from 'node:test';
import assert from 'node:assert/strict';
import {assignmentKey,controlKind,footerAdvanceKind,pickCheckAnswer,questionStatus,decidePlayer} from '../src/shared/player-state.js';
const view=overrides=>({fields:[{id:'a1'}],controls:{submitPresent:1},progress:{current:21,part:3,totalParts:3,status:'partial',questions:[]},feedback:{state:'unknown',modal:false},...overrides});
test('Continue never aliases Check answer or Next question despite reused command',()=>{
 assert.equal(controlKind(['Continue'],'checkanswer'),'continue');
 assert.equal(controlKind(['Next question'],'checkanswer'),'next');
 assert.equal(controlKind(['Final Check'],'checkanswer'),'submit');
 assert.equal(controlKind(['Final Check ›','Submit'],''),'submit');
 assert.equal(controlKind(['Submit','Final Check'],''),'submit');
 assert.equal(controlKind(['Submit assignment','Final Check'],''),null);
 for(const text of ['Submit','Submit assignment','Save','Save best score','Leave question'])assert.equal(controlKind([text],'checkanswer'),null);
});
test('assignment Submit and unlabeled command metadata can never check an answer',()=>{
 assert.equal(controlKind([],'checkanswer'),null);
 assert.equal(controlKind(['Submit','Check answer'],'checkanswer'),null);
 for(const text of ['Finish homework','Turn in test','Submit quiz','Finish assignment'])
   assert.equal(controlKind([text],'checkanswer'),null);
 assert.equal(controlKind(['Check answer'],'checkanswer'),'submit');
 assert.equal(footerAdvanceKind('Check answer'),'check');
 assert.equal(footerAdvanceKind('Check my answer'),'check');
 assert.equal(footerAdvanceKind('Final check'),'check');
 assert.equal(footerAdvanceKind('Final Check ›'),'check');
 assert.equal(footerAdvanceKind('Submit your answer Final Check'),'check');
 assert.equal(footerAdvanceKind('Next'),'next');
 assert.equal(footerAdvanceKind('Next ›'),'next');
 assert.equal(footerAdvanceKind('Next question'),'next');
 for(const text of ['Submit','Submit assignment','Save best score','Clear all',''])assert.equal(footerAdvanceKind(text),'');
 assert.equal(controlKind([],'checkanswer',{nav:true}),'submit');
 assert.equal(controlKind(['Continue'],'checkanswer',{nav:true}),'continue');
 assert.equal(controlKind([],'similarexercise'),'similar');
 assert.equal(controlKind([],'nextquestion'),'next');
 assert.equal(controlKind(['Next'],''),'next');
 assert.equal(controlKind(['Submit'],''),null);
 assert.equal(controlKind(['Submit answer'],'checkanswer'),null);
 const lower={bottom:40,right:20,nav:false,dialog:false,command:''};
 const check={bottom:700,right:900,nav:true,dialog:false,command:'checkanswer'};
 const dialog={bottom:800,right:1000,nav:true,dialog:true,command:'checkanswer'};
 assert.equal(pickCheckAnswer([lower,dialog,check]),check);
 assert.equal(pickCheckAnswer([dialog]),null);
});
test('question status distinguishes correct, partially correct, incorrect and unanswered',()=>{
 for(const [text,status] of [['Correct','correct'],['Partially correct','partial'],['Incorrect','incorrect'],['Not attempted','unanswered'],['In progress','incomplete']])assert.equal(questionStatus('Question 21, '+text),status);
});
test('assignment identity ignores current question but separates assignments and courses',()=>{
 assert.equal(assignmentKey('https://example.com/player?homeworkId=20&questionId=11'),assignmentKey('https://example.com/player?questionId=50&homeworkId=20'));
 assert.notEqual(assignmentKey('https://example.com/player?homeworkId=21'),assignmentKey('https://example.com/player?homeworkId=20'));
});
test('unfinished warning wins over OK, Continue and Next',()=>{
 assert.equal(decidePlayer(view({incompleteWarning:true,controls:{continue:1,next:1},feedback:{modal:true,state:'incorrect'}})).kind,'stay');
});
test('correct feedback on one part closes OK then uses Continue',()=>{
 const v=view({controls:{continue:1,next:1},feedback:{modal:true,state:'correct'}});
 assert.equal(decidePlayer(v).kind,'dismiss');v.feedback.modal=false;
 assert.equal(decidePlayer(v).kind,'continue');
});
test('live Part 3 solves only enabled fields even when Next question is visible',()=>{
 assert.equal(decidePlayer(view({controls:{submitPresent:1,next:1}})).kind,'solve');
 assert.equal(decidePlayer(view({controls:{}})).kind,'solve');
});
test('terminal partial credit retries Similar, never Next or Save best score',()=>{
 assert.equal(decidePlayer(view({fields:[],controls:{similar:1,next:1}})).kind,'similar');
});
test('correct terminal question jumps to next unfinished, then wraps to earlier gaps',()=>{
 const v=view({fields:[],controls:{similar:1,next:1},progress:{current:21,status:'correct',questions:[{number:14,status:'partial'},{number:21,status:'correct'},{number:22,status:'correct'},{number:23,status:'unanswered'}]}});
 assert.deepEqual(decidePlayer(v),{kind:'question',number:23});v.progress.questions[3].status='correct';
 assert.deepEqual(decidePlayer(v),{kind:'question',number:14});v.progress.questions[0].status='correct';
 assert.deepEqual(decidePlayer(v),{kind:'done'});
});
test('a stale correct score cannot skip an active unfinished part',()=>{
 const v=view();v.progress.status='correct';assert.equal(decidePlayer(v).kind,'solve');
});
test('missing scores or controls pause rather than guess completion',()=>{
 assert.equal(decidePlayer(view({fields:[],controls:{similar:1},progress:{status:'unknown',questions:[]}})).kind,'pause');
 assert.equal(decidePlayer(view({fields:[],controls:{}})).kind,'pause');
});
