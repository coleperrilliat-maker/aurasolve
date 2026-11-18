/* PostHog product analytics for aurasolve.io (views, users, funnels). */
(function () {
  const KEY = "phc_mPshn4pMCDcLhghXG7Y5ZtFY8RF4y9TacmppY3cRdmAS";
  const HOST = "https://us.i.posthog.com";
  if (window.posthog?.__loaded) return;

  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  posthog.init(KEY, {
    api_host: HOST,
    // Always create person profiles so Active users / People work from pageviews
    // (not only after identify/sign-in).
    person_profiles: "always",
    capture_pageview: true,
    capture_pageleave: true,
    persistence: "localStorage+cookie",
  });

  // First-party pageview for /metrics (works even if PostHog is blocked).
  try {
    const body = JSON.stringify({path: location.pathname || "/"});
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/v1/stats/pageview", new Blob([body], {type: "application/json"}));
    } else {
      fetch("/api/v1/stats/pageview", {method: "POST", headers: {"Content-Type": "application/json"}, body, keepalive: true}).catch(() => {});
    }
  } catch {}

  window.auraPosthogIdentify = function (email, props) {
    if (!email || !window.posthog) return;
    const clean = String(email).trim().toLowerCase();
    posthog.identify(clean, {
      email: clean,
      ...(props && typeof props === "object" ? props : {}),
    });
  };

  window.auraPosthogSignedIn = function (email, method) {
    if (!email || !window.posthog) return;
    const clean = String(email).trim().toLowerCase();
    const how = String(method || "unknown");
    window.auraPosthogIdentify(clean, {
      last_login_method: how,
      last_login_at: new Date().toISOString(),
    });
    posthog.capture("user_signed_in", {
      method: how,
      email: clean,
    });
  };
})();
