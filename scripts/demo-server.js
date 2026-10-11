import http from "node:http";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
const routes={"/":"../demo/index.html","/demo.js":"../demo/demo.js","/demo.css":"../demo/demo.css"};
http.createServer(async(req,res)=>{
  const path=new URL(req.url,"http://localhost").pathname;
  if(!routes[path]){res.writeHead(404);res.end("Not found");return;}
  try{const body=await readFile(fileURLToPath(new URL(routes[path],import.meta.url)));res.setHeader("Content-Type",path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":"text/html");res.end(body);}catch{res.writeHead(500);res.end("Unable to read demo file.");}
}).listen(4318,"127.0.0.1",()=>console.log("AuraSolve practice lab: http://localhost:4318 (Ctrl+C to stop)"));
