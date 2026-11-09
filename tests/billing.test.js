import test from 'node:test';
process.env.INSTALL_SECRET = 'unit-test-secret';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer, setBillingDeps} from '../server/index.js';
import {createChallenge, checkChallenge, issueSession, readSession, createStripe, normalizeEmail} from '../server/billing.js';

test('sign-in codes only work for the right code, email, and time', () => {
  const {code, challenge} = createChallenge('a@b.co', 1000);
  assert.equal(checkChallenge(challenge, code, 2000), 'a@b.co');
  assert.equal(checkChallenge(challenge, code === '000000' ? '000001' : '000000', 2000), null);
  assert.equal(checkChallenge(challenge, code, 1000 + 11 * 60_000), null);
  const [body, sig] = challenge.split('.');
  const forged = Buffer.from(JSON.stringify({email: 'x@y.co', expires: 9e15})).toString('base64url');
  assert.equal(checkChallenge(`${forged}.${sig}`, code, 2000), null);
  assert.ok(body);
});

test('sessions are signed and expire', () => {
  const session = issueSession('a@b.co', 0);
  assert.equal(readSession(session, 1000), 'a@b.co');
  assert.equal(readSession(session, 91 * 86_400_000), null);
  assert.equal(readSession(session.replace(/.$/, c => c === 'A' ? 'B' : 'A'), 1000), null);
  assert.equal(normalizeEmail(' Me@Example.COM '), 'me@example.com');
  assert.equal(normalizeEmail('nope'), null);
});

test('checkout creates prices once and gives the intro price only on a first subscription', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  const calls = [];
  const fake = async (url, options) => {
    const {pathname, search} = new URL(url);
    const body = new URLSearchParams(options.body || '');
    calls.push(`${options.method} ${pathname}`);
    const json = data => ({ok: true, status: 200, json: async () => data});
    if (pathname === '/v1/prices' && options.method === 'GET') return json({data: []});
    if (pathname === '/v1/products') return json({id: 'prod_1'});
    if (pathname === '/v1/prices') return json({id: `price_${body.get('lookup_key')}`});
    if (pathname.startsWith('/v1/coupons/')) return {ok: false, status: 404, json: async () => ({error: {message: 'No such coupon'}})};
    if (pathname === '/v1/coupons') return json({id: body.get('id')});
    if (pathname === '/v1/checkout/sessions') return json({url: `https://checkout.test/${body.get('line_items[0][price]')}/${body.get('discounts[0][coupon]') || 'full'}`});
    assert.fail(`unexpected ${pathname}${search}`);
  };
  const stripe = createStripe(fake);
  const first = await stripe.checkout({customerId: 'cus_1', hadSubscription: false}, 'weekly', 'https://x');
  assert.equal(first, 'https://checkout.test/price_aurasolve_weekly/aurasolve_first_week');
  const again = await stripe.checkout({customerId: 'cus_1', hadSubscription: true}, 'monthly', 'https://x');
  assert.equal(again, 'https://checkout.test/price_aurasolve_monthly/full');
  const yearly = await stripe.checkout({customerId: 'cus_1', hadSubscription: false}, 'yearly', 'https://x');
  assert.equal(yearly, 'https://checkout.test/price_aurasolve_yearly/full');
  assert.equal(calls.filter(call => call === 'POST /v1/products').length, 1);
  assert.equal(calls.filter(call => call === 'POST /v1/prices').length, 3);
  delete process.env.STRIPE_SECRET_KEY;
});

test('with the paywall on, solving needs sign-in, then free solves, then a plan', async t => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  t.after(() => { delete process.env.STRIPE_SECRET_KEY; });
  let sent = null;
  const accounts = {'free@x.co': {freeLeft: 2, paid: false}, 'out@x.co': {freeLeft: 0, paid: false}, 'paid@x.co': {freeLeft: 0, paid: true, plan: 'monthly'}};
  setBillingDeps({
    mailer: async (email, code) => { sent = {email, code}; },
    stripe: {
      account: async email => ({email, customerId: 'cus', freeUsed: 0, freeTotal: 5, hadSubscription: false, ...accounts[email]}),
      useFree: async () => {},
      checkout: async () => 'https://checkout.test/session',
      portal: async () => 'https://billing.test/portal',
    },
  });
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const {token} = await (await fetch(base + '/api/v1/install', {method: 'POST', body: '{}'})).json();
  const post = (path, body, session) => fetch(base + path, {method: 'POST', body: JSON.stringify(body), headers: {authorization: `Bearer ${token}`, ...(session ? {'x-aurasolve-session': session} : {})}});
  const solveBody = {mode: 'field', snapshot: {question: {text: 'x'}}};

  const anonymous = await post('/api/v1/solve', solveBody);
  assert.equal(anonymous.status, 402);
  assert.equal((await anonymous.json()).code, 'signin');

  const signIn = async email => {
    const {challenge} = await (await post('/api/v1/auth/start', {email})).json();
    assert.equal(sent.email, email);
    const wrong = await post('/api/v1/auth/verify', {challenge, code: sent.code === '111111' ? '222222' : '111111'});
    assert.equal(wrong.status, 400);
    const ok = await (await post('/api/v1/auth/verify', {challenge, code: sent.code})).json();
    assert.equal(ok.account.email, email);
    assert.equal('customerId' in ok.account, false);
    return ok.session;
  };

  const free = await signIn('free@x.co');
  assert.notEqual((await post('/api/v1/solve', solveBody, free)).status, 402);
  const out = await signIn('out@x.co');
  const blocked = await post('/api/v1/solve', solveBody, out);
  assert.equal(blocked.status, 402);
  assert.equal((await blocked.json()).code, 'paywall');
  assert.equal((await (await post('/api/v1/checkout', {plan: 'weekly'}, out)).json()).url, 'https://checkout.test/session');
  const paid = await signIn('paid@x.co');
  assert.notEqual((await post('/api/v1/solve', solveBody, paid)).status, 402);
  assert.equal((await post('/api/v1/checkout', {plan: 'weekly'}, paid)).status, 409);
  assert.equal((await (await post('/api/v1/portal', {}, paid)).json()).url, 'https://billing.test/portal');
  const account = await (await post('/api/v1/account', {}, paid)).json();
  assert.equal(account.plan, 'monthly');
});

test('with no Stripe key the paywall stays off', async t => {
  delete process.env.STRIPE_SECRET_KEY;
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const {token} = await (await fetch(base + '/api/v1/install', {method: 'POST', body: '{}'})).json();
  const response = await fetch(base + '/api/v1/solve', {method: 'POST', body: JSON.stringify({mode: 'field', snapshot: {}}), headers: {authorization: `Bearer ${token}`}});
  assert.notEqual(response.status, 402);
  const plans = await (await fetch(base + '/api/v1/plans')).json();
  assert.deepEqual(plans.plans.map(plan => plan.price), ['$0.99 first week', '$4.99 first month', '$40.00/year']);
});
