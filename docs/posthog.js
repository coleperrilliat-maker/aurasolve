(() => {
  const missingConfiguration = (name, environment) => {
    if (environment !== "production") {
      console.error(`${name} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${name} is configured`);
    }
  };

  const loadPostHog = source => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });

  const signalPostHog = available => window.dispatchEvent(new CustomEvent("posthog:ready", {detail: {available}}));

  (async () => {
    const response = await fetch("/api/v1/posthog-config", {credentials: "same-origin"});
    if (!response.ok) return signalPostHog(false);
    const {token, host, environment} = await response.json();
    if (!token) {
      missingConfiguration("POSTHOG_PROJECT_TOKEN", environment);
      return signalPostHog(false);
    }
    if (!host) {
      missingConfiguration("POSTHOG_HOST", environment);
      return signalPostHog(false);
    }

    const assetsHost = host.includes(".i.posthog.com") ? host.replace(".i.posthog.com", "-assets.i.posthog.com") : host;
    await loadPostHog(new URL("/static/array.js", assetsHost).toString());
    window.posthog.init(token, {api_host: host, capture_exceptions: true});
    signalPostHog(true);
  })().catch(() => signalPostHog(false));
})();
