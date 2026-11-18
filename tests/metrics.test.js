import test from "node:test";
process.env.INSTALL_SECRET = "unit-test-secret";
import assert from "node:assert/strict";
import {once} from "node:events";
import {createServer, setBillingDeps} from "../server/index.js";
import {createMemoryUsers} from "../server/users.js";
import {createMemoryStatsStore, estimateCostUsd} from "../server/stats.js";
import {issueSession} from "../server/billing.js";

test("estimateCostUsd returns a positive estimate", () => {
  const cost = estimateCostUsd("gpt-4.1", 1_000_000, 1_000_000);
  assert.equal(cost, 10);
});

test("admin metrics page API requires ADMIN_EMAILS and returns local stats", async t => {
  const directory = createMemoryUsers();
  const stats = createMemoryStatsStore();
  await directory.create({email: "owner@aurasolve.io", passwordHash: "x"});
  await directory.recordLogin("owner@aurasolve.io", "google");
  await stats.recordPageview();
  await stats.recordAiCall({model: "gpt-4.1-mini", mode: "solve", inputTokens: 1000, outputTokens: 200, costUsd: 0.01, ok: true});
  setBillingDeps({users: directory, stats});

  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "owner@aurasolve.io";
  t.after(() => {
    if (previous === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previous;
  });

  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const denied = await fetch(`${base}/api/v1/admin/metrics`);
  assert.equal(denied.status, 401);

  const cookie = `aura_session=${encodeURIComponent(issueSession("owner@aurasolve.io"))}`;
  const ok = await fetch(`${base}/api/v1/admin/metrics?days=30`, {headers: {cookie}});
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.viewer, "owner@aurasolve.io");
  assert.ok(body.pageviews.today >= 1);
  assert.ok(body.openai.calls >= 1);
  assert.equal(body.accounts.total, 1);
  assert.equal(body.accounts.recent[0].email, "owner@aurasolve.io");
  assert.equal(body.accounts.recent[0].lastLoginMethod, "google");

  const page = await fetch(`${base}/metrics`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Metrics · AuraSolve/);
});
