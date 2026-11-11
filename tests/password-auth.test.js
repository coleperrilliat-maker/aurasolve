import test from 'node:test';
process.env.INSTALL_SECRET = 'unit-test-secret';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer, setBillingDeps} from '../server/index.js';
import {createMemoryUsers} from '../server/users.js';
import {hashPassword, verifyPassword} from '../server/passwords.js';
import {issueReset, readReset, pkceChallenge, readSession} from '../server/billing.js';

test('password hashes do not keep the password', async () => {
  const hash = await hashPassword('correct-horse');
  assert.equal(hash.includes('correct-horse'), false);
  assert.equal(await verifyPassword('correct-horse', hash), true);
  assert.equal(await verifyPassword('wrong-horse', hash), false);
  const reset = issueReset('a@b.co', 'nonce-1', 1000);
  assert.deepEqual(readReset(reset, 2000), {email: 'a@b.co', nonce: 'nonce-1'});
  assert.equal(readReset(reset, 1000 + 31 * 60_000), null);
});

test('email and password sign-in, reset, and Google all stay on the website session', async t => {
  const directory = createMemoryUsers();
  let resetLink = null;
  setBillingDeps({
    users: directory,
    resetMailer: async (_email, link) => { resetLink = link; },
    googleFetcher: async url => {
      if (String(url).includes('oauth2.googleapis.com/token')) return {ok: true, json: async () => ({access_token: 'tok'})};
      if (String(url).includes('userinfo')) return {ok: true, json: async () => ({sub: 'google-user-1', email: 'google@x.co', email_verified: true})};
      throw new Error(String(url));
    },
  });
  const previousGoogle = {id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET, pub: process.env.PUBLIC_URL};
  process.env.GOOGLE_CLIENT_ID = 'client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
  process.env.PUBLIC_URL = 'https://aurasolve.io';
  t.after(() => {
    if (previousGoogle.id === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = previousGoogle.id;
    if (previousGoogle.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = previousGoogle.secret;
    if (previousGoogle.pub === undefined) delete process.env.PUBLIC_URL; else process.env.PUBLIC_URL = previousGoogle.pub;
  });

  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const origin = base;
  const cookieOf = response => (response.headers.getSetCookie?.() || []).find(value => value.startsWith('aura_session='))?.split(';')[0] || '';
  const web = (path, body, cookie) => fetch(base + path, {method: 'POST', body: JSON.stringify(body || {}), headers: {origin, 'content-type': 'application/json', ...(cookie ? {cookie} : {})}});

  const evil = await fetch(base + '/api/v1/auth/web/register', {method: 'POST', body: JSON.stringify({email: 'a@b.co', password: 'longpassword'}), headers: {origin: 'https://evil.example', 'content-type': 'application/json'}});
  assert.equal(evil.status, 403);
  assert.equal((await web('/api/v1/auth/web/register', {email: 'a@b.co', password: 'short'})).status, 400);

  const created = await web('/api/v1/auth/web/register', {email: 'Person@Example.com', password: 'longpassword'});
  const createdBody = await created.json();
  assert.equal(created.status, 200);
  assert.equal(createdBody.email, 'person@example.com');
  assert.equal(createdBody.session, undefined);
  const cookie = cookieOf(created);
  assert.match(cookie, /^aura_session=/);
  assert.equal((await web('/api/v1/auth/web/register', {email: 'person@example.com', password: 'longpassword'})).status, 409);
  assert.equal((await web('/api/v1/auth/web/login', {email: 'person@example.com', password: 'nope-nope'})).status, 400);

  const signedIn = await web('/api/v1/auth/web/login', {email: 'person@example.com', password: 'longpassword'});
  assert.equal((await signedIn.json()).email, 'person@example.com');
  const session = readSession(decodeURIComponent(cookieOf(signedIn).slice('aura_session='.length)));
  assert.equal(session, 'person@example.com');

  const verifier = 'verifier-value-verifier-value-verifier';
  const handed = await (await web('/api/v1/auth/handoff', {challenge: pkceChallenge(verifier)}, cookie)).json();
  const {token} = await (await fetch(base + '/api/v1/install', {method: 'POST', body: '{}'})).json();
  const redeemed = await (await fetch(base + '/api/v1/auth/redeem', {method: 'POST', body: JSON.stringify({handoff: handed.handoff, verifier}), headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}})).json();
  assert.equal(redeemed.account.email, 'person@example.com');

  assert.equal((await web('/api/v1/auth/web/forgot', {email: 'missing@x.co'})).status, 200);
  assert.equal(resetLink, null);
  assert.equal((await web('/api/v1/auth/web/forgot', {email: 'person@example.com'})).status, 200);
  assert.match(resetLink, /^https:\/\/aurasolve\.io\/login\?reset=/);
  const resetToken = new URL(resetLink).searchParams.get('reset');
  assert.equal((await web('/api/v1/auth/web/reset', {token: resetToken, password: 'tiny'})).status, 400);
  const reset = await web('/api/v1/auth/web/reset', {token: resetToken, password: 'newer-password'});
  assert.equal((await reset.json()).email, 'person@example.com');
  assert.equal((await web('/api/v1/auth/web/login', {email: 'person@example.com', password: 'longpassword'})).status, 400);
  assert.equal((await web('/api/v1/auth/web/login', {email: 'person@example.com', password: 'newer-password'})).status, 200);
  assert.equal((await web('/api/v1/auth/web/reset', {token: resetToken, password: 'newer-password'})).status, 400);

  const started = await fetch(`${base}/api/v1/auth/google?state=abcdefghijklmnop&challenge=${pkceChallenge(verifier)}`, {redirect: 'manual'});
  assert.equal(started.status, 302);
  const location = new URL(started.headers.get('location'));
  assert.equal(location.origin, 'https://accounts.google.com');
  assert.equal(location.searchParams.get('redirect_uri'), `${base}/api/v1/auth/google/callback`);
  const oauth = (started.headers.getSetCookie?.() || []).find(value => value.startsWith('aura_oauth=')).split(';')[0];
  const callback = await fetch(`${base}/api/v1/auth/google/callback?code=abc&state=${location.searchParams.get('state')}`, {headers: {cookie: oauth}, redirect: 'manual'});
  assert.equal(callback.status, 302);
  const back = new URL(callback.headers.get('location'), base);
  assert.equal(back.pathname, '/login');
  assert.equal(back.searchParams.get('state'), 'abcdefghijklmnop');
  const googleCookie = (callback.headers.getSetCookie?.() || []).find(value => value.startsWith('aura_session='));
  assert.match(googleCookie, /^aura_session=/);
  assert.equal(readSession(decodeURIComponent(googleCookie.split(';')[0].slice('aura_session='.length))), 'google@x.co');

  const again = await fetch(`${base}/api/v1/auth/google/callback?code=abc&state=wrong-state`, {headers: {cookie: oauth}, redirect: 'manual'});
  assert.equal(new URL(again.headers.get('location'), base).searchParams.get('error'), 'google');
});
