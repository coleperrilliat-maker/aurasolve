import test from 'node:test';
process.env.INSTALL_SECRET = 'unit-test-secret';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from '../server/index.js';

test('bad requests cannot take the API offline', async t => {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const {token} = await (await fetch(base + '/api/v1/install', {method: 'POST', body: '{}'})).json();
  const auth = {authorization: `Bearer ${token}`};
  const badRequests = [
    ['/%ZZ', {}],
    ['/api/v1/solve', {method: 'POST', body: 'null'}],
    ['/api/v1/solve', {method: 'POST', body: '[]'}],
    ['/api/v1/solve', {method: 'POST', body: '{"mode":"field","snapshot":[]}'}],
    ['/api/v1/ask', {method: 'POST', body: 'null'}],
  ];
  for (const [path, options] of badRequests) {
    const response = await fetch(base + path, {...options, headers: auth});
    assert.equal(response.status, 400, path);
    assert.equal(typeof (await response.json()).error, 'string');
    const health = await fetch(base + '/api/v1/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
  }
});

test('the API refuses callers without their own install token, and websites', async t => {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({messages: [{role: 'user', content: 'hi'}]});
  assert.equal((await fetch(base + '/api/v1/ask', {method: 'POST', body})).status, 401);
  assert.equal((await fetch(base + '/api/v1/ask', {method: 'POST', body, headers: {authorization: 'Bearer v1.fake.signature'}})).status, 401);
  const {token} = await (await fetch(base + '/api/v1/install', {method: 'POST', body: '{}'})).json();
  const forged = token.replace(/.$/, c => c === 'A' ? 'B' : 'A');
  assert.equal((await fetch(base + '/api/v1/ask', {method: 'POST', body, headers: {authorization: `Bearer ${forged}`}})).status, 401);
  const site = await fetch(base + '/api/v1/ask', {method: 'POST', body, headers: {authorization: `Bearer ${token}`, origin: 'https://evil.example'}});
  assert.equal(site.status, 403);
  assert.equal(site.headers.get('access-control-allow-origin'), null);
  const install = await fetch(base + '/api/v1/install', {method: 'POST', body: '{}', headers: {origin: 'https://evil.example'}});
  assert.equal(install.status, 403);
  const ext = await fetch(base + '/api/v1/ask', {method: 'OPTIONS', headers: {origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'}});
  assert.equal(ext.headers.get('access-control-allow-origin'), 'chrome-extension://abcdefghijklmnopabcdefghijklmnop');
});
