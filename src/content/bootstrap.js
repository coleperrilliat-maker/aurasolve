if (!globalThis.__auraReady) {
  globalThis.__auraReady = import(chrome.runtime.getURL("src/content/app.js")).then(module => module.start());
  globalThis.__auraReady.catch(error => console.warn("AuraSolve could not start:", error.message));
}
