import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve(import.meta.dirname,'..');
createServer(async(req,res)=>{
 if(req.url==='/tests/popup-fixture.html'){
   const html=await readFile(resolve(root,'src/popup/popup.html'),'utf8');
   res.setHeader('Content-Type','text/html');res.end(html.replace('<head>','<head><base href="/src/popup/">').replace('<script type="module" src="popup.js">','<script src="/tests/popup-fixture.js"></script><script type="module" src="popup.js">'));return;
 }
 const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(!path.startsWith(root+'/') || !['src','tests'].some(dir=>path.startsWith(root+'/'+dir+'/'))){res.writeHead(404).end();return;}
 try{const body=await readFile(path);res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[extname(path)] || 'application/octet-stream');res.end(body);}
 catch{res.writeHead(404).end();}
}).listen(4320,'127.0.0.1',()=>console.log('Browser scenarios: http://127.0.0.1:4320/tests/browser-scenarios.html'));
