const $=id=>document.getElementById(id);
await chrome.storage.local.setAccessLevel({accessLevel:"TRUSTED_CONTEXTS"});
const {settings={}}=await chrome.storage.local.get("settings");
$("key").value=settings.apiKey || "";$("model").value=settings.model || "gpt-4.1-mini";
$("settings").onsubmit=async event=>{event.preventDefault();try{
  const apiKey=$("key").value.trim(),model=$("model").value.trim();
  if(!apiKey || !model)throw new Error("Enter a key and a model.");
  await chrome.storage.local.set({settings:{apiKey,model}});
  $("status").textContent="Saved. Return to your practice page and choose a mode. The key is checked when you make your first request.";
}catch(error){$("status").textContent=error.message;}};
$("forget").onclick=async()=>{await chrome.storage.local.remove("settings");$("key").value="";$("status").textContent="API key removed from this extension.";};
$("env").onchange=async event=>{try{
  const file=event.target.files[0];if(!file)return;if(file.size>16000)throw new Error("Choose a small .env text file.");
  const content=await file.text();
  const entries=Object.fromEntries(content.split(/\r?\n/).filter(l=>/^\s*(OPENAI_API_KEY|OPENAI_MODEL)\s*=/.test(l)).map(l=>{const index=l.indexOf("=");return[l.slice(0,index).trim(),l.slice(index+1).trim().replace(/^(['"])(.*)\1$/,"$2")];}));
  if(!entries.OPENAI_API_KEY)throw new Error("No OPENAI_API_KEY value found.");
  $("key").value=entries.OPENAI_API_KEY;if(entries.OPENAI_MODEL)$("model").value=entries.OPENAI_MODEL;
  $("status").textContent="Imported locally. Click Save settings to use this key.";
}catch(error){$("status").textContent=error.message;}};
