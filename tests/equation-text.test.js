import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeEquationSrc, equationAnswerOk, equationFromImage, spaceEquation, textWithEquations} from '../src/shared/equation-text.js';

const text = (value, children = []) => ({nodeType: 3, textContent: value, childNodes: children});
const el = (tag, attrs, children = []) => ({
  nodeType: 1,
  tagName: tag,
  alt: attrs.alt || '',
  title: attrs.title || '',
  src: attrs.src || '',
  type: attrs.type || '',
  textContent: children.map(child => child.textContent || '').join(''),
  childNodes: children,
  getAttribute: name => attrs[name] || '',
});

test('an equation image is read from its alt text or its Canvas url', () => {
  assert.equal(equationFromImage({alt: 'y-4=2(x-5)'}), 'y-4=2(x-5)');
  assert.equal(equationFromImage({alt: 'equation', src: 'https://canvas.instructure.com/equation_images/y-4%3D2%5Cleft(x-5%5Cright)'}), 'y-4=2(x-5)');
  assert.equal(decodeEquationSrc('https://school.instructure.com/equation_images/3x%2B2y%3D7?height=20'), '3x+2y=7');
});

test('question text keeps the words and the equation image', () => {
  const root = el('DIV', {}, [
    text('Convert '),
    el('IMG', {alt: 'equation', src: 'https://canvas.wpi.edu/equation_images/y-4%3D2(x-5)'}),
    text(' into Slope-Intercept form.'),
  ]);
  assert.equal(textWithEquations(root), 'Convert y-4=2(x-5) into Slope-Intercept form.');
});

test('a fragment without an equal sign is not an equation answer', () => {
  const title = 'Convert into Slope-Intercept form. Spaces before and after the equal sign.';
  assert.equal(equationAnswerOk(title, '2x - 6'), false);
  assert.equal(equationAnswerOk(title, '-6'), false);
  assert.equal(equationAnswerOk(title, 'y = 2x - 6'), true);
  assert.equal(equationAnswerOk('What is the capital?', 'Austin'), true);
});

test('typed equations get spaces around equals and binary plus or minus', () => {
  assert.equal(spaceEquation('y=2x-6'), 'y = 2x - 6');
  assert.equal(spaceEquation('y = -5x + 8'), 'y = -5x + 8');
  assert.equal(spaceEquation('3x+4y=12'), '3x + 4y = 12');
  assert.equal(spaceEquation('y-4=2(x-5)'), 'y - 4 = 2(x - 5)');
  assert.equal(spaceEquation('y - 1 = -5(x - 1)'), 'y - 1 = -5(x - 1)');
});
