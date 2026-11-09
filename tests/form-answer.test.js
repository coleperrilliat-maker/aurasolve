import test from 'node:test';
import assert from 'node:assert/strict';
import {matchOption, isGoogleForm} from '../src/shared/form-answer.js';
import {formSchema} from '../server/openai.js';

test('answers are matched back to the exact Google Forms choice', () => {
  const options = ['Allele', 'Genotype', '3:1', 'B) Phenotype'];
  assert.equal(matchOption(options, 'Allele'), 'Allele');
  assert.equal(matchOption(options, ' allele '), 'Allele');
  assert.equal(matchOption(options, '3 : 1'), '3:1');
  assert.equal(matchOption(options, 'Phenotype'), 'B) Phenotype');
  assert.equal(matchOption(options, 'Dominant'), null);
});

test('only Google Forms answer pages turn on highlight mode', () => {
  assert.equal(isGoogleForm('https://docs.google.com/forms/d/e/1FAIpQLSf9/viewform'), true);
  assert.equal(isGoogleForm('https://docs.google.com/forms/u/0/d/e/1FAIpQLSf9/viewform?usp=sf_link'), true);
  assert.equal(isGoogleForm('https://docs.google.com/forms/d/1YkrO63f9a/edit'), false);
  assert.equal(isGoogleForm('https://docs.google.com/document/d/abc/edit'), false);
});

test('the form answer schema only allows real choices', () => {
  const radio = formSchema('radio', ['A', 'B']);
  assert.deepEqual(radio.properties.choices.items.enum, ['A', 'B']);
  assert.equal(radio.properties.choices.maxItems, 1);
  assert.equal(formSchema('text', []).properties.choices.maxItems, 0);
  assert.equal(formSchema('checkbox', ['A', 'B']).properties.choices.maxItems, undefined);
});
