import test from 'node:test';
import assert from 'node:assert/strict';
import {premiseText} from '../src/content/canvas.js';

function node(tag, {className = '', text = '', children = []} = {}) {
  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    className,
    textContent: text,
    childNodes: text ? [{nodeType: 3, textContent: text}] : [],
    children,
    parentElement: null,
    getAttribute: () => null,
    querySelectorAll(selector) {
      return walk(el).filter(item => matches(item, selector));
    },
    querySelector(selector) {
      return el.querySelectorAll(selector)[0] || null;
    },
    closest(selector) {
      let current = el;
      while (current) {
        if (matches(current, selector)) return current;
        current = current.parentElement;
      }
      return null;
    },
    contains(other) {
      return other === el || walk(el).includes(other);
    },
  };
  for (const child of children) {
    child.parentElement = el;
    el.childNodes.push(child);
    el.textContent += ` ${child.textContent}`;
  }
  return el;
}

function walk(el) {
  return el.children.flatMap(child => [child, ...walk(child)]);
}

function matches(el, selector) {
  return selector.split(',').some(part => {
    const name = part.trim();
    if (name.startsWith('.')) return el.className.split(/\s+/).includes(name.slice(1));
    return el.tagName === name.toUpperCase();
  });
}

test('a Canvas matching row keeps the left item as the dropdown label', () => {
  const select = node('SELECT', {children: [node('OPTION', {text: 'Produces ATP'})]});
  const row = node('TR', {children: [
    node('TD', {className: 'matching_answer_text', text: 'Mitochondria'}),
    node('TD', {children: [select]}),
  ]});
  assert.equal(premiseText(select), 'Mitochondria');
  assert.equal(row.querySelectorAll('td').length, 2);
});

test('a matching pair wrapped in answer_match uses the left column', () => {
  const select = node('SELECT');
  node('DIV', {className: 'answer_match', children: [
    node('DIV', {className: 'answer_match_left', text: 'Slope-intercept form'}),
    node('DIV', {className: 'answer_match_right', children: [select]}),
  ]});
  assert.equal(premiseText(select), 'Slope-intercept form');
});
