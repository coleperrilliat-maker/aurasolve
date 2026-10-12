import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BUILD_VERSION} from '../src/shared/version.js';
test('visible build and installable extension versions agree',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(manifest.version,BUILD_VERSION);assert.equal(pkg.version,BUILD_VERSION);
});
test('neither Fill entry point ships the removed click-first gate',async()=>{
  for (const name of ['content/ui.js','popup/popup.js','background/worker.js']) {
    const code=await readFile(new URL('../src/'+name,import.meta.url),'utf8');
    assert.doesNotMatch(code,/Click the answer field on the page first|Click the answer field on the page, then choose|Click the answer field on the page first, then choose/);
  }
});
