import test from 'node:test';
import assert from 'node:assert/strict';
import {GEOMETRY_CHECKS} from '../server/instructions.js';
import {congruenceQuestion, hardGeometryQuestion} from '../server/openai.js';

test('range-of-values hinge questions are hard geometry', () => {
  assert.equal(hardGeometryQuestion({
    question: 'Find the range of possible values for y.',
    fields: [{kind: 'text', label: 'lower', context: 'The range of possible values is'}],
    visual: true,
  }), true);
});

test('explicit hinge wording is hard geometry', () => {
  assert.equal(hardGeometryQuestion({
    question: 'Use the Hinge Theorem to compare the angles.',
    fields: [{kind: 'select', label: 'blank', options: [{label: '<'}, {label: '>'}]}],
  }), true);
});

test('ordinary algebra is not hard geometry', () => {
  assert.equal(hardGeometryQuestion({
    question: 'Solve 2x + 5 = 17.',
    fields: [{kind: 'text', label: 'x'}],
  }), false);
});

test('a fan of isosceles triangles is not sorted by the printed angles', () => {
  assert.match(GEOMETRY_CHECKS, /180° − 2×/);
  assert.match(GEOMETRY_CHECKS, /AB, CD, EF, DE, BC/);
  assert.equal(hardGeometryQuestion({
    question: 'List the lengths of AB, BC, CD, DE, and EF in order from least to greatest. Note the figure is not drawn to scale.',
    fields: [{kind: 'radio', label: 'A. AB, CD, EF, DE, BC'}],
    visual: true,
  }), true);
});

test('congruence questions still detect ASA/AAS wording', () => {
  assert.equal(congruenceQuestion({
    question: 'Which postulate proves the triangles congruent? ASA or AAS?',
    fields: [{kind: 'radio', label: 'ASA', options: [{label: 'ASA'}, {label: 'AAS'}]}],
  }), true);
});
