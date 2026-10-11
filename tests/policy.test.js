import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,requirePractice,validateConsent} from '../src/shared/policy.js';
test('ungraded and study plan are recognized',()=>{for(const name of ['Ungraded practice','Not graded','Study plan'])assert.equal(classify(name).state,'practice');});
test('graded indicators override practice wording',()=>{for(const name of ['Practice quiz','Ungraded practice / Exam','Study plan / Homework','Practice points possible'])assert.equal(classify(name).state,'blocked');});
test('unknown pages cannot pass the mutation gate',()=>assert.throws(()=>requirePractice(['Math course','Question 4']),/not clearly/));
test('one blocked iframe blocks the whole page',()=>assert.throws(()=>requirePractice(['Ungraded practice','Final test']),/indicator/));
test('a practice parent can qualify an unlabeled question frame',()=>assert.doesNotThrow(()=>requirePractice(['Ungraded practice','Question 4'])));
test('consent binds to page and expires',()=>{const grant={url:'https://example.com/practice',signature:'Student',expires:1000};assert.doesNotThrow(()=>validateConsent(grant,grant.url,500));assert.throws(()=>validateConsent(grant,'https://example.com/exam',500));assert.throws(()=>validateConsent(grant,grant.url,1001));assert.throws(()=>validateConsent(null,grant.url));});
