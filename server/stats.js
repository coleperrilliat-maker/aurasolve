// Lightweight first-party metrics for the /metrics admin page.
// Survives restarts when DATABASE_URL is set; otherwise in-memory only.

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return dayKey(d);
}

// Rough USD per 1M tokens. Labelled as estimates on the dashboard.
const RATE_PER_M = {
  "gpt-5": {in: 1.25, out: 10},
  "gpt-5-mini": {in: 0.25, out: 2},
  "gpt-4.1": {in: 2, out: 8},
  "gpt-4.1-mini": {in: 0.4, out: 1.6},
  "gpt-4o": {in: 2.5, out: 10},
  "gpt-4o-mini": {in: 0.15, out: 0.6},
};

export function estimateCostUsd(model, inputTokens, outputTokens) {
  const key = String(model || "").toLowerCase();
  let rates = RATE_PER_M["gpt-4.1"];
  for (const [name, value] of Object.entries(RATE_PER_M)) {
    if (key.includes(name)) { rates = value; break; }
  }
  const input = Number(inputTokens) || 0;
  const output = Number(outputTokens) || 0;
  return (input * rates.in + output * rates.out) / 1_000_000;
}

function emptySeries(days) {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) out.push({day: daysAgo(i), count: 0, spendUsd: 0, calls: 0});
  return out;
}

function createMemoryStats() {
  const pageviews = new Map(); // day -> count
  const ai = []; // {at, day, model, mode, inputTokens, outputTokens, costUsd, ok}

  return {
    async recordPageview() {
      const day = dayKey();
      pageviews.set(day, (pageviews.get(day) || 0) + 1);
    },
    async recordAiCall({model, mode, inputTokens, outputTokens, costUsd, ok}) {
      ai.push({
        at: new Date().toISOString(),
        day: dayKey(),
        model: model || "unknown",
        mode: mode || "unknown",
        inputTokens: Number(inputTokens) || 0,
        outputTokens: Number(outputTokens) || 0,
        costUsd: Number(costUsd) || 0,
        ok: ok !== false,
      });
      if (ai.length > 20_000) ai.splice(0, ai.length - 20_000);
    },
    async summary({days = 30} = {}) {
      const since = daysAgo(days - 1);
      const series = emptySeries(days);
      const byDay = new Map(series.map(row => [row.day, row]));
      let pageToday = 0;
      let page7 = 0;
      let page30 = 0;
      for (const [day, count] of pageviews) {
        if (day < since) continue;
        const row = byDay.get(day);
        if (row) row.count = count;
        page30 += count;
        if (day >= daysAgo(6)) page7 += count;
        if (day === dayKey()) pageToday += count;
      }

      let spend = 0;
      let calls = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      const byModel = new Map();
      for (const row of ai) {
        if (row.day < since) continue;
        calls += 1;
        spend += row.costUsd;
        inputTokens += row.inputTokens;
        outputTokens += row.outputTokens;
        const bucket = byModel.get(row.model) || {model: row.model, calls: 0, spendUsd: 0, inputTokens: 0, outputTokens: 0};
        bucket.calls += 1;
        bucket.spendUsd += row.costUsd;
        bucket.inputTokens += row.inputTokens;
        bucket.outputTokens += row.outputTokens;
        byModel.set(row.model, bucket);
        const dayRow = byDay.get(row.day);
        if (dayRow) {
          dayRow.calls += 1;
          dayRow.spendUsd += row.costUsd;
        }
      }

      return {
        pageviews: {
          today: pageToday,
          last7: page7,
          last30: page30,
          series: series.map(({day, count}) => ({day, count})),
        },
        openai: {
          spendUsd: round4(spend),
          calls,
          inputTokens,
          outputTokens,
          byModel: [...byModel.values()]
            .map(row => ({...row, spendUsd: round4(row.spendUsd)}))
            .sort((a, b) => b.spendUsd - a.spendUsd),
          series: series.map(({day, spendUsd, calls: c}) => ({day, spendUsd: round4(spendUsd), calls: c})),
        },
      };
    },
  };
}

function round4(n) {
  return Math.round((Number(n) || 0) * 10_000) / 10_000;
}

export async function createPostgresStats(connectionString) {
  const internal = /railway\.internal|localhost|127\.0\.0\.1/.test(connectionString);
  const {default: pg} = await import("pg");
  const pool = new pg.Pool({
    connectionString,
    max: 3,
    ssl: internal ? false : {rejectUnauthorized: false},
  });
  await pool.query(`create table if not exists pageviews_daily (
    day date primary key,
    count integer not null default 0
  )`);
  await pool.query(`create table if not exists ai_usage (
    id bigserial primary key,
    created_at timestamptz not null default now(),
    day date not null,
    model text not null,
    mode text,
    input_tokens integer not null default 0,
    output_tokens integer not null default 0,
    cost_usd double precision not null default 0,
    ok boolean not null default true
  )`);
  await pool.query(`create index if not exists ai_usage_day_idx on ai_usage (day)`);

  return {
    async recordPageview() {
      const day = dayKey();
      await pool.query(
        `insert into pageviews_daily (day, count) values ($1::date, 1)
         on conflict (day) do update set count = pageviews_daily.count + 1`,
        [day],
      );
    },
    async recordAiCall({model, mode, inputTokens, outputTokens, costUsd, ok}) {
      await pool.query(
        `insert into ai_usage (day, model, mode, input_tokens, output_tokens, cost_usd, ok)
         values ($1::date, $2, $3, $4, $5, $6, $7)`,
        [
          dayKey(),
          model || "unknown",
          mode || null,
          Number(inputTokens) || 0,
          Number(outputTokens) || 0,
          Number(costUsd) || 0,
          ok !== false,
        ],
      );
    },
    async summary({days = 30} = {}) {
      const since = daysAgo(days - 1);
      const series = emptySeries(days);
      const byDay = new Map(series.map(row => [row.day, row]));

      const views = await pool.query(
        `select day::text as day, count from pageviews_daily where day >= $1::date order by day`,
        [since],
      );
      let pageToday = 0;
      let page7 = 0;
      let page30 = 0;
      for (const row of views.rows) {
        const day = String(row.day).slice(0, 10);
        const count = Number(row.count) || 0;
        const slot = byDay.get(day);
        if (slot) slot.count = count;
        page30 += count;
        if (day >= daysAgo(6)) page7 += count;
        if (day === dayKey()) pageToday += count;
      }

      const usage = await pool.query(
        `select day::text as day, model,
                count(*)::int as calls,
                coalesce(sum(input_tokens),0)::int as input_tokens,
                coalesce(sum(output_tokens),0)::int as output_tokens,
                coalesce(sum(cost_usd),0)::float8 as spend_usd
         from ai_usage
         where day >= $1::date
         group by day, model
         order by day`,
        [since],
      );
      let spend = 0;
      let calls = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      const byModel = new Map();
      for (const row of usage.rows) {
        const day = String(row.day).slice(0, 10);
        const c = Number(row.calls) || 0;
        const s = Number(row.spend_usd) || 0;
        const inn = Number(row.input_tokens) || 0;
        const out = Number(row.output_tokens) || 0;
        calls += c;
        spend += s;
        inputTokens += inn;
        outputTokens += out;
        const bucket = byModel.get(row.model) || {model: row.model, calls: 0, spendUsd: 0, inputTokens: 0, outputTokens: 0};
        bucket.calls += c;
        bucket.spendUsd += s;
        bucket.inputTokens += inn;
        bucket.outputTokens += out;
        byModel.set(row.model, bucket);
        const dayRow = byDay.get(day);
        if (dayRow) {
          dayRow.calls += c;
          dayRow.spendUsd += s;
        }
      }

      return {
        pageviews: {
          today: pageToday,
          last7: page7,
          last30: page30,
          series: series.map(({day, count}) => ({day, count})),
        },
        openai: {
          spendUsd: round4(spend),
          calls,
          inputTokens,
          outputTokens,
          byModel: [...byModel.values()]
            .map(row => ({...row, spendUsd: round4(row.spendUsd)}))
            .sort((a, b) => b.spendUsd - a.spendUsd),
          series: series.map(({day, spendUsd, calls: c}) => ({day, spendUsd: round4(spendUsd), calls: c})),
        },
      };
    },
  };
}

export function createMemoryStatsStore() {
  return createMemoryStats();
}

export async function queryPosthogOverview({personalKey, projectId, host, days = 30} = {}) {
  if (!personalKey || !projectId) return null;
  const appHost = String(host || "https://us.i.posthog.com").includes("eu")
    ? "https://eu.posthog.com"
    : "https://us.posthog.com";
  const sql = `
    SELECT
      countIf(event = '$pageview') AS pageviews,
      countIf(event = 'user_signed_in') AS sign_ins,
      countIf(event = 'user_signed_in' AND properties.method = 'google') AS google_sign_ins,
      countIf(event IN ('$ai_generation', '$ai_embedding')) AS ai_calls,
      round(sumIf(toFloat(properties.$ai_total_cost_usd), event IN ('$ai_generation', '$ai_embedding')), 4) AS ai_spend_usd
    FROM events
    WHERE timestamp >= now() - INTERVAL ${Number(days) || 30} DAY
  `;
  const response = await fetch(`${appHost}/api/projects/${encodeURIComponent(projectId)}/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${personalKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: {kind: "HogQLQuery", query: sql},
      name: "aurasolve_metrics_overview",
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {error: `PostHog query failed (${response.status}). ${text.slice(0, 200)}`};
  }
  const data = await response.json();
  const row = data?.results?.[0] || [];
  return {
    pageviews: Number(row[0]) || 0,
    signIns: Number(row[1]) || 0,
    googleSignIns: Number(row[2]) || 0,
    aiCalls: Number(row[3]) || 0,
    aiSpendUsd: Number(row[4]) || 0,
  };
}
