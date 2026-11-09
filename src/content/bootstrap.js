// A tab that outlived an extension reload keeps a dead copy; start a fresh one.
const alive = () => { try { return Boolean(chrome.runtime?.id) && globalThis.__auraAlive?.() !== false; } catch { return false; } };
if (!globalThis.__auraReady || !alive()) {
  globalThis.__auraReady = import(chrome.runtime.getURL("src/content/app.js")).then(module => module.start());
  globalThis.__auraReady.catch(error => console.warn("AuraSolve could not start. Open chrome://extensions and click Reload on AuraSolve, then refresh this page.", error.message));
}
