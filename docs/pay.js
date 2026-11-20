const error = document.getElementById("pay-error");
function showError(message) {
  error.hidden = !message;
  error.textContent = message || "";
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

function showTotal(session) {
  const amount = session?.total?.total?.amount;
  if (amount) {
    document.getElementById("due").textContent = amount;
    document.getElementById("line-price").textContent = amount;
  }
  if (session && Object.prototype.hasOwnProperty.call(session, "canConfirm")) {
    document.getElementById("pay").disabled = !session.canConfirm;
  }
}

document.getElementById("pay-logout").onclick = async () => {
  try {
    await post("/api/v1/auth/web/logout");
  } catch {}
  location.assign("/login");
};

const session = await fetch("/api/v1/auth/session", {credentials: "same-origin"}).then(response => response.json()).catch(() => ({}));
if (!session?.signedIn) location.replace("/login");
else if (!session.paywall || session.paid) location.replace("/install?paid=1");
else {
  try {
    const checkoutSession = await post("/api/v1/auth/web/checkout", {plan: "weekly", embedded: true});
    if (checkoutSession.url) {
      location.assign(checkoutSession.url);
    } else if (!checkoutSession.clientSecret || !checkoutSession.publishableKey) {
      showError("Checkout isn't ready yet. Add the Stripe publishable key, then try again.");
    } else {
      const stripe = await window.auraStripeReady;
      const init = stripe.initCheckoutElementsSdk?.bind(stripe) || stripe.initCheckout?.bind(stripe);
      if (!init) throw new Error("Stripe checkout isn't available in this browser. Refresh and try again.");
      let checkout = init({
        clientSecret: checkoutSession.clientSecret,
        elementsOptions: {
          appearance: {
            theme: "stripe",
            variables: {
              colorPrimary: "#3b6cff",
              borderRadius: "12px",
              fontFamily: "Inter, system-ui, sans-serif",
            },
          },
        },
      });
      if (checkout?.then) checkout = await checkout;
      checkout.on("change", showTotal);
      if (typeof checkout.createExpressCheckoutElement === "function") {
        const express = checkout.createExpressCheckoutElement({buttonHeight: 48, layout: {maxColumns: 1, maxRows: 1}});
        express.on("ready", ({availablePaymentMethods}) => {
          const available = availablePaymentMethods && Object.values(availablePaymentMethods).some(Boolean);
          document.getElementById("express-checkout").hidden = !available;
          document.getElementById("pay-or").hidden = !available;
        });
        express.on("confirm", async () => {
          const ready = await checkout.loadActions();
          if (ready.type === "error") { showError(ready.error.message); return; }
          showTotal(ready.actions.getSession?.());
          const result = await ready.actions.confirm();
          if (result?.type === "error" || result?.message) showError(result.error?.message || result.message);
        });
        express.mount("#express-checkout");
      }
      checkout.createPaymentElement({
        layout: {type: "tabs"},
        wallets: {link: "never"},
        walletOptions: {emailRequired: false, phoneNumberRequired: false},
        fields: {billingDetails: {name: "never", email: "never", phone: "never", address: "if_required"}},
      }).mount("#payment-element");
      document.getElementById("pay").onclick = async () => {
        const button = document.getElementById("pay");
        const label = button.textContent;
        button.disabled = true;
        button.textContent = "Starting your plan…";
        showError("");
        try {
          const ready = await checkout.loadActions();
          if (ready?.type === "error") throw new Error(ready.error?.message || "Payment couldn't start.");
          const actions = ready?.actions || ready;
          const session = actions.getSession?.();
          const total = session?.total?.total;
          if (total) {
            void total.amount;
            void total.minorUnitsAmount;
            void total.currency;
            void total.minorUnitsAmountDivisor;
            showTotal(session);
          }
          const confirm = actions.confirm?.bind(actions) || checkout.confirm?.bind(checkout);
          if (!confirm) throw new Error("Payment couldn't start. Refresh the page and try again.");
          const result = await confirm();
          if (result?.type === "error") throw new Error(result.error?.message || "Payment didn't go through.");
          if (result?.error?.message) throw new Error(result.error.message);
        } catch (err) {
          showError(err.message || "Payment didn't go through. Check the card and try again.");
          button.disabled = false;
          button.textContent = label;
        }
      };
    }
  } catch (err) {
    showError(err.message);
  }
}
