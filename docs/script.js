const releaseApi = "https://api.github.com/repos/coleperrilliat-maker/aurasolve/releases/latest";
const assetName = "AuraSolve-extension.zip";
const zipUrl = "https://github.com/coleperrilliat-maker/aurasolve/releases/latest/download/AuraSolve-extension.zip";

// Download buttons open the install guide, which starts the download itself.
document.querySelectorAll('a[href*="/releases/latest/download/"]:not([data-direct])').forEach(link => {
  link.addEventListener("click", event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    location.href = "install.html?download=1";
  });
});

const status = document.getElementById("download-status");
if (status) {
  const params = new URLSearchParams(location.search);
  if (params.has("download")) {
    history.replaceState(null, "", location.pathname);
    setTimeout(() => {
      const frame = document.createElement("iframe");
      frame.hidden = true;
      frame.src = document.querySelector("a[data-direct]")?.href || zipUrl;
      document.body.append(frame);
      status.classList.add("done");
      status.lastChild.textContent = "Download started. Follow the steps below.";
    }, 400);
  } else {
    status.classList.add("done");
    status.lastChild.textContent = "Already downloaded? Start at step 1.";
  }

  const pickOs = os => {
    document.body.classList.toggle("os-win", os === "win");
    document.querySelectorAll("[data-os]").forEach(button => button.setAttribute("aria-selected", String(button.dataset.os === os)));
  };
  pickOs(/Win/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent) ? "win" : "mac");
  document.querySelectorAll("[data-os]").forEach(button => button.addEventListener("click", () => pickOs(button.dataset.os)));

  document.querySelectorAll("[data-copy]").forEach(button => button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.classList.add("copied");
      button.querySelector("span").textContent = "Copied";
    } catch {}
  }));
}

fetch(releaseApi, {headers: {Accept: "application/vnd.github+json"}})
  .then(response => {
    if (!response.ok) throw new Error("Release unavailable");
    return response.json();
  })
  .then(release => {
    const asset = release.assets?.find(item => item.name === assetName);
    if (asset) {
      document.querySelectorAll('a[href*="/releases/latest/download/"]').forEach(link => {
        link.href = asset.browser_download_url;
      });
    }
    const version = String(release.tag_name || "").replace(/^v/i, "");
    const label = document.getElementById("version");
    if (version && label) label.textContent = `Version ${version} · Chrome`;
  })
  .catch(() => {});

const logoTrack = document.querySelector(".logo-track");
if (logoTrack) {
  logoTrack.append(...[...logoTrack.children].map(node => {
    const copy = node.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    copy.querySelector("img")?.setAttribute("alt", "");
    return copy;
  }));
}
