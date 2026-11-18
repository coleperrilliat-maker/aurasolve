(function () {
  const gate = document.getElementById("gate");
  const gateCopy = document.getElementById("gate-copy");
  const gateLink = document.getElementById("gate-link");
  const dash = document.getElementById("dash");
  const refreshBtn = document.getElementById("refresh");

  function money(n) {
    const v = Number(n) || 0;
    return v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
  }

  function num(n) {
    return new Intl.NumberFormat("en-US").format(Number(n) || 0);
  }

  function when(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"});
  }

  function methodLabel(row) {
    if (row.lastLoginMethod) return row.lastLoginMethod;
    if (row.hasGoogle && row.hasPassword) return "google + password";
    if (row.hasGoogle) return "google";
    if (row.hasPassword) return "password";
    return "—";
  }

  function spark(el, series, key) {
    if (!el) return;
    const values = (series || []).map(row => Number(row[key]) || 0);
    const max = Math.max(1, ...values);
    el.innerHTML = values.map(value => {
      const h = Math.max(4, Math.round((value / max) * 100));
      return `<span style="height:${h}%"></span>`;
    }).join("");
  }

  function showGate(message, href) {
    dash.hidden = true;
    gate.hidden = false;
    gateCopy.textContent = message;
    if (href) gateLink.href = href;
  }

  function fill(data) {
    gate.hidden = true;
    dash.hidden = false;
    document.getElementById("days-label").textContent = String(data.days || 30);
    document.getElementById("viewer").textContent = data.viewer ? `Signed in as ${data.viewer}` : "";

    const views = data.pageviews || {};
    const accounts = data.accounts || {};
    const openai = data.openai || {};

    document.getElementById("m-views-today").textContent = num(views.today);
    document.getElementById("m-views-sub").textContent = `${num(views.last7)} last 7d · ${num(views.last30)} last 30d`;

    document.getElementById("m-signin-today").textContent = num(accounts.signedInToday);
    document.getElementById("m-signin-sub").textContent = `${num(accounts.signedIn7d)} last 7d`;

    document.getElementById("m-accounts").textContent = num(accounts.total);
    document.getElementById("m-accounts-sub").textContent = `${num(accounts.google)} Google · ${num(accounts.password)} password`;

    document.getElementById("m-spend").textContent = money(openai.spendUsd);
    document.getElementById("m-spend-sub").textContent = `${num(openai.calls)} calls · ${num(openai.inputTokens)} in / ${num(openai.outputTokens)} out tokens`;

    spark(document.getElementById("spark-views"), views.series, "count");
    spark(document.getElementById("spark-spend"), openai.series, "spendUsd");

    const viewRows = document.getElementById("view-rows");
    const recentViews = (views.series || []).slice(-7).reverse();
    viewRows.innerHTML = recentViews.length
      ? recentViews.map(row => `<li><span>${row.day}</span><strong>${num(row.count)}</strong></li>`).join("")
      : "<li><span>No pageviews yet</span><strong>0</strong></li>";

    const modelRows = document.getElementById("model-rows");
    const models = openai.byModel || [];
    modelRows.innerHTML = models.length
      ? models.map(row => `<li><span>${row.model}</span><strong>${money(row.spendUsd)} · ${num(row.calls)}</strong></li>`).join("")
      : "<li><span>No OpenAI calls yet</span><strong>$0</strong></li>";

    const people = document.getElementById("people-rows");
    const recent = accounts.recent || [];
    people.innerHTML = recent.length
      ? recent.map(row => `<tr>
          <td>${row.email}</td>
          <td>${methodLabel(row)}</td>
          <td>${when(row.lastLoginAt)}</td>
          <td>${when(row.createdAt)}</td>
        </tr>`).join("")
      : `<tr><td colspan="4">No accounts yet.</td></tr>`;

    const note = document.getElementById("ph-note");
    if (data.posthog?.error) {
      note.hidden = false;
      note.textContent = `PostHog enrich skipped: ${data.posthog.error}`;
    } else if (data.posthog && !data.posthog.error) {
      note.hidden = false;
      note.textContent = `PostHog last ${data.days}d: ${num(data.posthog.pageviews)} views · ${num(data.posthog.signIns)} sign-ins (${num(data.posthog.googleSignIns)} Google) · ${money(data.posthog.aiSpendUsd)} AI spend`;
    } else {
      note.hidden = false;
      note.textContent = "Tip: add POSTHOG_PERSONAL_API_KEY on Railway to also show PostHog totals here.";
    }
  }

  async function load() {
    refreshBtn.disabled = true;
    try {
      const response = await fetch("/api/v1/admin/metrics?days=30", {credentials: "same-origin"});
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        showGate("Sign in with your admin email to open metrics.", "/login?next=/metrics");
        return;
      }
      if (response.status === 403 && data.code === "admin_unset") {
        showGate("Add ADMIN_EMAILS=you@email.com on Railway, redeploy, then refresh.", "/metrics");
        gateLink.textContent = "Refresh";
        return;
      }
      if (response.status === 403) {
        showGate("This signed-in account isn’t on ADMIN_EMAILS.", "/login?next=/metrics");
        return;
      }
      if (!response.ok) {
        showGate(data.error || "Couldn’t load metrics.", "/metrics");
        gateLink.textContent = "Try again";
        return;
      }
      fill(data);
    } catch {
      showGate("Couldn’t reach the AuraSolve API.", "/metrics");
      gateLink.textContent = "Try again";
    } finally {
      refreshBtn.disabled = false;
    }
  }

  refreshBtn?.addEventListener("click", load);
  load();
})();
