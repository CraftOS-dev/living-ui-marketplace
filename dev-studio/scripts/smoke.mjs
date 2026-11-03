import assert from "node:assert/strict";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {WebSocket} from "ws";
import {ROOT} from "../app/config.mjs";
import {request,operation,base} from "./client.mjs";
const results=[];
async function check(name,fn){await fn();results.push({name,passed:true});console.log("PASS "+name);}
await check("identity is the new Agent App framework",async()=>{const id=await request("/api/_a2app");assert.equal(id.protocol,"0.1");assert.equal(id.adapterVersion,"0.1.0");assert.equal(id.app.name,"Development Studio");});
await check("file/watcher/child receipt is real",async()=>{const p=await operation("run-local-proof");assert.equal(p.status,"passed");const file=await readFile(p.details.file);assert.equal(createHash("sha256").update(file).digest("hex"),p.details.sha256);assert.equal(p.details.watcher,true);});
await check("agent cannot open UI-only terminal",async()=>{await assert.rejects(operation("open-terminal"),e=>e.status===500||e.status===422);});
await check("proof authority cannot be forged with CRUD",async()=>{await assert.rejects(request("/api/collections/proofs/records",{method:"POST",body:JSON.stringify({kind:"forged",status:"passed",details:{}})}),e=>e.body?.code==="read_only_field");});
await check("unique challenge rejects wrong agent result",async()=>{
 const r=await operation("create-proof-request",{mode:"standalone",title:"Negative guard test"});
 await request("/api/_a2app/tasks/"+r.agentTask+"/claim",{method:"POST",body:"{}"});
 await assert.rejects(operation("submit-proof-result",{request:r.id,answer:-1,decision:"passed",summary:"wrong"}));
 await request("/api/_a2app/tasks/"+r.agentTask+"/cancel",{method:"POST",body:"{}"});
 await operation("sync-proof-requests");
 const cancelled=await request("/api/collections/requests/records/"+r.id);assert.equal(cancelled.status,"canceled");
 await assert.rejects(operation("submit-proof-result",{request:r.id,answer:r.left+r.right,decision:"passed",summary:"late result"}));
});
await check("real PTY websocket and managed close",async()=>{
 const grant=await operation("open-terminal",{},true);
 const ws=new WebSocket(grant.url,["studio-v1","ticket-"+grant.ticket],{origin:base});
 await new Promise((resolve,reject)=>{ws.once("open",resolve);ws.once("error",reject);});
 const marker="STUDIO_WS_"+Date.now();
 const output=new Promise((resolve,reject)=>{let text="";const t=setTimeout(()=>reject(new Error("Terminal output missing")),7000);ws.on("message",raw=>{text+=JSON.parse(raw).data||"";if(text.includes(marker)){clearTimeout(t);resolve();}});});
 ws.send(JSON.stringify({type:"resize",cols:100,rows:24}));
 const tail=marker.slice("STUDIO_".length);
 ws.send(JSON.stringify({type:"input",data:process.platform==="win32"?"Write-Output ('STUDIO_'+'"+tail+"')\r":"printf '%s%s\\n' 'STUDIO_' '"+tail+"'\r"}));
 await output;await operation("close-terminal",{id:grant.id},true);ws.close();
});
await check("runtime stops and reports stopped",async()=>{await operation("stop-runtime",{},true);const s=await operation("studio-status");assert.equal(s.runtime.running,false);});
await mkdir(join(ROOT,".a2app","evidence"),{recursive:true});
await writeFile(join(ROOT,".a2app","evidence","smoke.json"),JSON.stringify({checkedAt:new Date().toISOString(),base,results},null,2));
