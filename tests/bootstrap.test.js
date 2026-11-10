import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('the content bootstrap can run twice in one page without a SyntaxError', () => {
  const source = fs.readFileSync(new URL('../src/content/bootstrap.js', import.meta.url), 'utf8');
  let imports = 0;
  const context = vm.createContext({console, chrome: {runtime: {id: 'x', getURL: path => path}}});
  context.globalThis = context;
  context.__auraImport = () => { imports++; return Promise.resolve({start: () => true}); };
  const script = source.replace(/\bimport\(/g, '__auraImport(');
  vm.runInContext(script, context);
  assert.doesNotThrow(() => vm.runInContext(script, context));
  assert.equal(imports, 1);
});
