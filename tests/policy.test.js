import test from 'node:test';
import assert from 'node:assert/strict';
import {HONOR_STATEMENT,statementMatches,validateConsent} from '../src/shared/policy.js';
test('honor statement must be typed exactly, ignoring case, spacing, and a final period',()=>{
  for(const text of [HONOR_STATEMENT,'this is not a graded homework assignment.','  This  is not a graded homework assignment  '])assert.equal(statementMatches(text),true);
  for(const text of ['','This is a graded homework assignment','not graded','This is not graded homework'])assert.equal(statementMatches(text),false);
});
test('consent needs the statement, a signature, the same page, and an unexpired grant',()=>{
  const grant={url:'https://example.com/practice',statement:HONOR_STATEMENT,signature:'Student',expires:1000};
  assert.doesNotThrow(()=>validateConsent(grant,grant.url,500));
  assert.throws(()=>validateConsent(grant,'https://example.com/other',500));
  assert.throws(()=>validateConsent(grant,grant.url,1001));
  assert.throws(()=>validateConsent({...grant,statement:'yes'},grant.url,500));
  assert.throws(()=>validateConsent({...grant,signature:' '},grant.url,500));
  assert.throws(()=>validateConsent(null,grant.url));
});
