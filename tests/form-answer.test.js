import test from 'node:test';
import assert from 'node:assert/strict';
import {matchOption, isGoogleForm, isCanvasQuiz} from '../src/shared/form-answer.js';
import {formSchema, quizSchema} from '../server/openai.js';

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
  assert.equal(isGoogleForm('https://docs.google.com/forms/viewform?embedded=true&id=1SXuFuADwXfuo3tDj6e8HqRG3qNbadPP2wFlyRDNDXXQ'), true);
  assert.equal(isGoogleForm('https://docs.google.com/forms/viewform'), false);
  assert.equal(isGoogleForm('https://docs.google.com/forms/d/1YkrO63f9a/edit'), false);
  assert.equal(isGoogleForm('https://docs.google.com/document/d/abc/edit'), false);
  assert.equal(isGoogleForm('http://localhost:4318/forms'), true);
});

test('Canvas quiz pages turn on highlight mode', () => {
  assert.equal(isCanvasQuiz('https://canvas.wpi.edu/courses/36755/quizzes/53024/take'), true);
  assert.equal(isCanvasQuiz('https://school.instructure.com/courses/9/quizzes/3/take?preview=1'), true);
  assert.equal(isCanvasQuiz('https://canvas.wpi.edu/courses/36755/modules'), false);
  assert.equal(isCanvasQuiz('https://docs.google.com/forms/d/e/abc/viewform'), false);
});

test('a whole quiz is answered as one list', () => {
  const schema = quizSchema();
  assert.deepEqual(schema.required, ['answers']);
  assert.deepEqual(schema.properties.answers.items.required, ['id', 'choices', 'blanks']);
});

test('the form answer schema only allows real choices', () => {
  const radio = formSchema('radio', ['A', 'B']);
  assert.deepEqual(radio.properties.choices.items.enum, ['A', 'B']);
  assert.equal(radio.properties.choices.maxItems, 1);
  assert.equal(formSchema('text', []).properties.choices.maxItems, 0);
  assert.equal(formSchema('checkbox', ['A', 'B']).properties.choices.maxItems, undefined);
});

import {selectionLooksActive, classifyFormControls} from '../src/shared/form-answer.js';

test('a space highlight is still an active selection', () => {
  assert.equal(selectionLooksActive({isCollapsed: false, rangeCount: 1, toString: () => ' '}), true);
  assert.equal(selectionLooksActive({isCollapsed: false, rangeCount: 1, toString: () => ''}), true);
  assert.equal(selectionLooksActive({isCollapsed: true, rangeCount: 0, toString: () => 'hi'}), false);
});

test('checkbox controls are classified as select-all', () => {
  const q = classifyFormControls({title: 'Pick primes', radios: [], boxes: ['2', '3', '4'], listbox: [], text: false, area: false, radiogroups: 0});
  assert.equal(q.kind, 'checkbox');
  assert.deepEqual(q.options, ['2', '3', '4']);
  assert.equal(classifyFormControls({title: 'x', radios: ['A'], boxes: [], listbox: [], text: false, area: false, radiogroups: 2}), null);
});

import {parseFormDate, parseFormTime, IMAGE_ONLY_TITLE} from '../src/shared/form-answer.js';

test('image-only questions, grids, dates, and times are classified', () => {
  const pictured = classifyFormControls({title: '', radios: ['True', 'False'], radiogroups: 1, images: 1});
  assert.equal(pictured.kind, 'radio');
  assert.equal(pictured.title, IMAGE_ONLY_TITLE);
  assert.equal(classifyFormControls({title: '', radios: ['True', 'False'], radiogroups: 1}), null);
  const grid = classifyFormControls({title: 'Rate', radios: ['A', 'B', 'A', 'B'], radiogroups: 2, grid: {multi: false, rows: ['Row 1', 'Row 2'], columns: ['A', 'B']}});
  assert.deepEqual([grid.kind, grid.rows, grid.options], ['grid', ['Row 1', 'Row 2'], ['A', 'B']]);
  assert.equal(classifyFormControls({title: 'x', grid: {multi: true, rows: ['r'], columns: ['c']}}).kind, 'checkgrid');
  assert.equal(classifyFormControls({title: 'When', text: true, date: true}).kind, 'date');
  assert.equal(classifyFormControls({title: 'At', text: true, time: true}).kind, 'time');
});

test('grid answers are constrained per row', () => {
  const schema = formSchema('grid', ['A', 'B'], ['Row 1', 'Row 2']);
  assert.equal(schema.properties.choices.maxItems, 0);
  assert.deepEqual(schema.properties.rows.items.properties.row.enum, ['Row 1', 'Row 2']);
  assert.equal(schema.properties.rows.items.properties.choices.maxItems, 1);
  assert.equal(formSchema('checkgrid', ['A'], ['r']).properties.rows.items.properties.choices.maxItems, undefined);
  assert.equal(formSchema('radio', ['A'], []).properties.rows.maxItems, 0);
});

test('form dates and times are parsed for filling', () => {
  assert.deepEqual(parseFormDate('1969-7-20'), {year: 1969, month: 7, day: 20, iso: '1969-07-20'});
  assert.equal(parseFormDate('July'), null);
  assert.deepEqual(parseFormTime('14:05'), {hour: 14, minute: 5, hour12: 2, pm: true});
  assert.deepEqual(parseFormTime('12:30 am'), {hour: 0, minute: 30, hour12: 12, pm: false});
});
