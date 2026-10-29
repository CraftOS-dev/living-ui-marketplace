import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import {fork} from "node:child_process";
import {once} from "node:events";
process.env.A2APP_DATA_DIR = await mkdtemp(join(tmpdir(),"studio-runtime-test-"));
const {runtimeCall,stopRuntime,runtimeInfo}=await import("../app/runtime.mjs");
function connect(grant,origin) {
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(grant.url,["studio-v1","ticket-"+grant.ticket],{origin});
    ws.once("open",()=>resolve(ws));ws.once("error",reject);
  });
}
test("real file, watcher, child process, authenticated terminal and shutdown",async()=>{
 try {
  const proof=await runtimeCall("probe");
  assert.equal(proof.passed,true);assert.equal(proof.watcher,true);
  assert.equal(await readFile(proof.file,"utf8"),proof.marker);
  const grant=await runtimeCall("terminal-open");
  const {manifest}=await import("../app/config.mjs");
  await assert.rejects(connect(grant,"http://untrusted.example"),/403/);
  await assert.rejects(connect({...grant,ticket:"invalid"},"http://127.0.0.1:"+manifest.port),/403/);
  const ws=await connect(grant,"http://127.0.0.1:"+manifest.port);
  await assert.rejects(connect(grant,"http://127.0.0.1:"+manifest.port),/403/);
  const marker="PTY_ACTUAL_"+Date.now();
  const output=new Promise((resolve,reject)=>{
    let text="";const timer=setTimeout(()=>reject(new Error("No real PTY output")),7000);
    ws.on("message",raw=>{const m=JSON.parse(raw);text+=m.data||"";if(text.includes(marker)){clearTimeout(timer);resolve(text);}});
  });
  ws.send(JSON.stringify({type:"resize",cols:100,rows:24}));
  const tail=marker.slice("PTY_".length);
  ws.send(JSON.stringify({type:"input",data:process.platform==="win32"?"Write-Output ('PTY_'+'"+tail+"')\r":"printf '%s%s\\n' 'PTY_' '"+tail+"'\r"}));
  assert.match(await output,new RegExp(marker));
  await runtimeCall("terminal-close",{id:grant.id});ws.close();
  const stopped=await stopRuntime();assert.equal(stopped.stopped,true);assert.equal(runtimeInfo().running,false);
 } finally {await stopRuntime();}
});
test("expired terminal tickets are refused",async()=>{
 try{
  const grant=await runtimeCall("terminal-open");
  await new Promise(resolve=>setTimeout(resolve,15100));
  const {manifest}=await import("../app/config.mjs");
  await assert.rejects(connect(grant,"http://127.0.0.1:"+manifest.port),/403/);
 }finally{await stopRuntime();}
});
test("development services outlive bounded checks and still stop explicitly",async()=>{
 try{
  const command='node -e "console.log(\'SERVICE_READY\');setInterval(()=>{},1000)"';
  const bounded=await runtimeCall('job-start',{id:'bounded-check',command,cwd:process.cwd(),timeout:1000});
  const service=await runtimeCall('job-start',{id:'long-service',command,cwd:process.cwd(),timeout:0});
  assert.equal(bounded.timeoutMs,1000);assert.equal(service.timeoutMs,null);
  let result;
  for(let i=0;i<80;i++){result=await runtimeCall('job-state',{id:bounded.id});if(result.status==='timed-out')break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(result.status,'timed-out');assert.equal(result.stopConfirmed,true);
  const running=await runtimeCall('job-state',{id:service.id});assert.equal(running.status,'running');assert.match(running.output,/SERVICE_READY/);
  const stopped=await runtimeCall('job-stop',{id:service.id});assert.equal(stopped.status,'canceled');assert.equal(stopped.stopConfirmed,true);assert.throws(()=>process.kill(service.pid,0));
 }finally{await stopRuntime();}
});
test("browser reconnect keeps the real shell and requires a fresh single-use ticket",async()=>{
 try{
  const {manifest}=await import("../app/config.mjs"),origin="http://127.0.0.1:"+manifest.port;
  const first=await runtimeCall("terminal-open");const socket=await connect(first,origin);
  const closed=once(socket,"close");socket.close();await closed;
  await new Promise(r=>setTimeout(r,100));
  const resumed=await runtimeCall("terminal-reconnect",{id:first.id});assert.equal(resumed.pid,first.pid);assert.notEqual(resumed.ticket,first.ticket);
  await assert.rejects(connect(first,origin),/403/);const next=await connect(resumed,origin);await assert.rejects(connect(resumed,origin),/403/);
  await runtimeCall("terminal-close",{id:first.id});next.close();assert.throws(()=>process.kill(first.pid,0));
 }finally{await stopRuntime();}
});
test("parent IPC disconnect closes the real shell and execution service",async()=>{
 const {ROOT,allowedOrigins}=await import("../app/config.mjs");
 const child=fork(join(ROOT,"app/runtime-worker.mjs"),[],{env:{...process.env,STUDIO_DATA_DIR:process.env.A2APP_DATA_DIR,STUDIO_ORIGINS:JSON.stringify(allowedOrigins())},stdio:["ignore","ignore","ignore","ipc"],windowsHide:true});
 const ready=(await once(child,"message"))[0];assert.equal(ready.type,"ready");
 child.send({id:"test-open",method:"terminal-open",params:{}});
 const reply=(await once(child,"message"))[0];assert.ok(reply.result.pid);
 const exited=once(child,"exit");child.disconnect();
 const [code]=await exited;assert.equal(code,0);
 assert.throws(()=>process.kill(reply.result.pid,0));
 await assert.rejects(fetch("http://127.0.0.1:"+ready.port));
});
