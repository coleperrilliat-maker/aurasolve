// Catch exceptions inside the injected function: Chrome does not reliably
// propagate page-world exceptions through InjectionResult on every version.
export async function callPageMethod(method, payload) {
  try {
    await globalThis.__auraReady;
    const runtime=globalThis.__aura;
    if (!runtime) throw new Error('AuraSolve is no longer attached. Refresh the lab page after reloading the extension.');
    if (typeof runtime[method]!=='function') throw new Error(`AuraSolve's page code is outdated (${method}). Refresh the lab page.`);
    const data=await runtime[method](payload);
    if (data == null) throw new Error(`The ${method} action returned no confirmation. Review the field before retrying.`);
    return {ok:true,data};
  } catch(error) {
    return {ok:false,error:error instanceof Error ? error.message : String(error)};
  }
}
export async function frameCall(tabId,documentId,method,payload) {
  const results=await chrome.scripting.executeScript({target:{tabId,documentIds:[documentId]},func:callPageMethod,args:[method,payload??null]});
  const response=results[0]?.result;
  if (!response) throw new Error('The question frame stopped responding. Refresh the lab page, then click the answer field again.');
  if (!response.ok) throw new Error(response.error || `The ${method} action failed without an explanation.`);
  return response.data;
}
