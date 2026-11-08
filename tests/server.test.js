import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from '../server/index.js';

test('bad requests cannot take the API offline', async t => {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const badRequests = [
    ['/%ZZ', {}],
    ['/api/v1/solve', {method: 'POST', body: 'null'}],
    ['/api/v1/solve', {method: 'POST', body: '[]'}],
    ['/api/v1/solve', {method: 'POST', body: '{"mode":"field","snapshot":[]}'}],
    ['/api/v1/ask', {method: 'POST', body: 'null'}],
  ];
  for (const [path, options] of badRequests) {
    const response = await fetch(base + path, options);
    assert.equal(response.status, 400, path);
    assert.equal(typeof (await response.json()).error, 'string');
    const health = await fetch(base + '/api/v1/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
  }
});
