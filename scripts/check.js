import {readFile,readdir,access} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {resolve,join} from "node:path";
const root=resolve(import.meta.dirname,"..");
async function scan(path){const entries=await readdir(path,{withFileTypes:true});for(const e of entries){const p=join(path,e.name);if(e.isDirectory())await scan(p);else if(p.endsWith('.js'))execFileSync(process.execPath,['--check',p]);}}
await scan(root);
const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
if(manifest.manifest_version!==3)throw new Error('Manifest must be v3');
for(const file of [manifest.background.service_worker,manifest.action.default_popup,...manifest.content_scripts.flatMap(s=>s.js)])await access(join(root,file));
console.log('JavaScript syntax and manifest entry files verified.');
