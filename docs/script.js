const releaseApi = "https://api.github.com/repos/coleperrilliat-maker/aurasolve/releases/latest";
const assetName = "AuraSolve-extension.zip";

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
