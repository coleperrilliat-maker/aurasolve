/* Google Analytics 4 for aurasolve.io (views, sign-ins). */
(function () {
  const MEASUREMENT_ID = "G-0KX4536S47";
  if (!MEASUREMENT_ID) return;
  if (window.gtag && window.__auraGaLoaded) return;
  window.__auraGaLoaded = true;

  window.dataLayer = window.dataLayer || [];
  function gtag(){ window.dataLayer.push(arguments); }
  window.gtag = gtag;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);

  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID, {
    anonymize_ip: true,
    send_page_view: true,
  });

  window.auraPosthogIdentify = function (email, props) {
    if (!email || !window.gtag) return;
    const clean = String(email).trim().toLowerCase();
    gtag("set", "user_properties", {
      email_domain: clean.includes("@") ? clean.split("@")[1] : undefined,
      ...(props && typeof props === "object" ? props : {}),
    });
    gtag("config", MEASUREMENT_ID, { user_id: clean });
  };

  window.auraPosthogSignedIn = function (email, method) {
    if (!email || !window.gtag) return;
    const clean = String(email).trim().toLowerCase();
    const how = String(method || "unknown");
    window.auraPosthogIdentify(clean, {
      last_login_method: how,
    });
    gtag("event", "login", {
      method: how,
    });
    gtag("event", "user_signed_in", {
      method: how,
    });
  };
})();
