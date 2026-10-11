if (!globalThis.__auraReady) {
  globalThis.__auraReady = import(chrome.runtime.getURL("src/content/app.js")).then(module => module.start());
  globalThis.__auraReady.catch(error => console.warn("AuraSolve could not start. Open chrome://extensions and click Reload on AuraSolve, then refresh this page.", error.message));
}
