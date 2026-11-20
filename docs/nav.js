const account = document.getElementById("nav-account");
if (account) {
  account.onclick = () => { location.href = "/login"; };
  fetch("/api/v1/auth/session", {credentials: "same-origin"}).then(response => response.json()).then(data => {
    if (!data?.signedIn) return;
    account.textContent = "Sign out";
    account.onclick = async () => {
      account.disabled = true;
      try {
        await fetch("/api/v1/auth/web/logout", {
          method: "POST",
          credentials: "same-origin",
          headers: {"Content-Type": "application/json"},
          body: "{}",
        });
      } catch {}
      location.reload();
    };
  }).catch(() => {});
}
