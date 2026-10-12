export const RECONNECT_MESSAGE='AuraSolve was reloaded or disconnected. Refresh this lab page to reconnect, then try Fill again.';
export function disconnected() {
  return Object.assign(new Error(RECONNECT_MESSAGE),{code:'AURA_DISCONNECTED'});
}
export async function sendExtension(message) {
  let response;
  try {
    const runtime=globalThis.chrome?.runtime;
    if (typeof runtime?.sendMessage!=='function') throw disconnected();
    response=await runtime.sendMessage(message);
  } catch(error) {
    if (error?.code==='AURA_DISCONNECTED' || /extension context invalidated|receiving end does not exist|could not establish connection|message port closed|message channel closed/i.test(error?.message || '')) throw disconnected();
    throw error;
  }
  if (!response || typeof response.ok!=='boolean') throw disconnected();
  if (!response.ok) {
    const error=new Error(response.error || 'AuraSolve could not complete this action.');
    if (/AuraSolve was reloaded or disconnected/.test(error.message))error.code='AURA_DISCONNECTED';
    throw error;
  }
  return response.data;
}
