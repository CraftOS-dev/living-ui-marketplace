import WebSocket from "ws";
import {readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {ROOT} from "../app/config.mjs";
const evidence=join(ROOT,".a2app/evidence");
const previous=JSON.parse(await readFile(join(evidence,"craftbot.json"),"utf8"));
const {host,project}=previous;
const token=(await readFile(join(project.path,".agent-token"),"utf8")).trim();
async function api(path,body,human=false){const r=await fetch(project.url+path,{method:body?"POST":"GET",headers:{"content-type":"application/json",...(human?{origin:project.url}:{"x-a2app-token":token})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});const j=await r.json();if(!r.ok)throw new Error("App HTTP "+r.status);return j;}
const op=async(name,args={},human=false)=>(await api("/api/ops/"+name,args,human)).result;
const {token:hostToken}=await fetch(host+"/api/session-token",{signal:AbortSignal.timeout(10000)}).then(r=>r.json());
const ws=new WebSocket(host.replace("http","ws")+"/ws",["craftbot","craftbot-auth."+hostToken],{origin:host});
await new Promise((ok,no)=>{ws.once("open",ok);ws.once("error",no);});
const inbox=[]; ws.on("message",b=>{try{inbox.push(JSON.parse(b));}catch{}});
async function waitFor(check,ms=30000){const end=Date.now()+ms;while(Date.now()<end){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,200));}throw new Error("Lifecycle condition timed out");}
async function hostAction(action){ws.send(JSON.stringify({type:action,projectId:project.id}));const result=await waitFor(()=>{const i=inbox.findIndex(m=>m.type===action&&m.data.projectId===project.id);return i<0?null:inbox.splice(i,1)[0].data;},60000);if(!result.success)throw new Error("Host action failed: "+action);}
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const results={checkedAt:new Date().toISOString(),project:project.id};
try {
 // This script is run after an actual host process restart.
 await hostAction("agent_app_launch");
 const identity=await api("/api/_a2app");
 const stored=await api("/api/collections/requests/records/"+previous.request);
 results.restartPersisted=identity.app.id===project.id&&stored.status==="passed";
 const terminal=await op("open-terminal",{},true);
 const terminalWs=new WebSocket(terminal.url,["studio-v1","ticket-"+terminal.ticket],{origin:project.url});
 await new Promise((ok,no)=>{terminalWs.once("open",ok);terminalWs.once("error",no);});
 terminalWs.on("error",()=>{});
 const status=await op("studio-status");
 results.workerStarted=alive(status.runtime.pid)&&alive(terminal.pid);
 await hostAction("agent_app_stop");
 await waitFor(()=>!alive(status.runtime.pid)&&!alive(terminal.pid));
 results.workerAndShellStopped=true;
 results.appPortClosed=await fetch(project.url+"/api/_a2app",{signal:AbortSignal.timeout(2000)}).then(()=>false,()=>true);
 terminalWs.terminate();
 await hostAction("agent_app_launch");
 results.relaunchIdentity=(await api("/api/_a2app")).app.id===project.id;
 await op("run-local-proof");
 const review=await op("create-proof-request",{mode:"craftbot",title:"Cancellation lifecycle proof; cancel after host claim"});
 await waitFor(async()=>(await api("/api/_a2app/tasks/"+review.agentTask)).status==="working");
 await api("/api/_a2app/tasks/"+review.agentTask+"/cancel",{});
 await waitFor(async()=>{const s=await fetch(host+"/api/state").then(r=>r.json());return !s.busySessions.includes(project.session);},30000);
 await op("sync-proof-requests");
 results.cancelTask=(await api("/api/_a2app/tasks/"+review.agentTask)).status;
 results.cancelRequest=(await api("/api/collections/requests/records/"+review.id)).status;
 results.passed=results.restartPersisted&&results.workerStarted&&results.workerAndShellStopped&&results.appPortClosed&&results.relaunchIdentity&&results.cancelTask==="canceled"&&results.cancelRequest==="canceled";
 await writeFile(join(evidence,"craftbot-lifecycle.json"),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));
 if(!results.passed)process.exitCode=1;
} finally {ws.close();}
