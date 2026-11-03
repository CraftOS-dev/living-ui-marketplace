// Drives the REAL running host. No substitute agent or response is provided.
import WebSocket from "ws";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve,join} from "node:path";
import {ROOT} from "../app/config.mjs";
const host=process.env.CRAFTBOT_URL||"http://127.0.0.1:8926";
const zip=process.argv[2];
if(!zip)throw new Error("Usage: node scripts/craftbot-proof.mjs <clean ZIP path> | --existing");
const {token}=await fetch(host+"/api/session-token",{signal:AbortSignal.timeout(10000)}).then(r=>r.json());
const ws=new WebSocket(host.replace("http","ws")+"/ws",["craftbot","craftbot-auth."+token],{origin:host});
await new Promise((ok,no)=>{ws.once("open",ok);ws.once("error",no);});
const inbox=[];
ws.on("message",bytes=>{try{inbox.push(JSON.parse(bytes));if(inbox.length>1000)inbox.shift();}catch{}});
async function message(type, predicate=()=>true,timeout=600000) {
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){const i=inbox.findIndex(m=>m.type===type&&predicate(m.data));if(i>=0)return inbox.splice(i,1)[0].data;await new Promise(r=>setTimeout(r,200));}
 throw new Error("Host response timed out: "+type);
}
let project;
try {
 if(zip==="--existing") {
  const previous=JSON.parse(await readFile(join(ROOT,".a2app/evidence/craftbot.json"),"utf8"));
  project={...previous.project,projectType:previous.project.type,agentAppVersion:previous.project.format,sessionId:previous.project.session};
 } else {
  ws.send(JSON.stringify({type:"agent_app_import",source:resolve(zip),name:"Development Studio M0 native proof"}));
  const imported=await message("agent_app_import_result");
  if(!imported.success)throw new Error(imported.error);
  project=(await message("agent_app_create",d=>d.projectId===imported.projectId)).project;
 }
 if(project.projectType!=="native"||project.agentAppVersion!=="0.1.0")throw new Error("Host did not import as new-framework native");
 console.log(JSON.stringify({phase:"imported",id:project.id,path:project.path,url:project.url,format:project.agentAppVersion}));
 const agentToken=(await readFile(join(project.path,".agent-token"),"utf8")).trim();
 async function api(path,body){const res=await fetch(project.url+path,{method:body?"POST":"GET",headers:{"content-type":"application/json","x-a2app-token":agentToken},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});const data=await res.json();if(!res.ok)throw new Error("App HTTP "+res.status+": "+(data.message||data.error));return data;}
 const op=async(name,args={})=>(await api("/api/ops/"+name,args)).result;
 const local=await op("run-local-proof");
 const review=await op("create-proof-request",{mode:"craftbot",title:"CraftBot native host: inspect real execution evidence"});
 console.log(JSON.stringify({phase:"queued",request:review.id,task:review.agentTask,session:project.sessionId}));
 let task,stored;
 const deadline=Date.now()+600000;
 while(Date.now()<deadline){
  task=await api("/api/_a2app/tasks/"+review.agentTask);
  stored=await api("/api/collections/requests/records/"+review.id);
  if(["completed","failed","canceled"].includes(task.status))break;
  await new Promise(r=>setTimeout(r,2000));
 }
 const report={checkedAt:new Date().toISOString(),host,project:{id:project.id,path:project.path,url:project.url,format:project.agentAppVersion,type:project.projectType,session:project.sessionId},localProof:review.evidence,newlyRunProof:local.id,request:review.id,task:review.agentTask,requestStatus:stored.status,taskStatus:task.status,claim:task.claim,summary:stored.summary,passed:stored.status==="passed"&&task.status==="completed"};
 await mkdir(join(ROOT,".a2app/evidence"),{recursive:true});
 await writeFile(join(ROOT,".a2app/evidence/craftbot.json"),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 if(!report.passed)process.exitCode=1;
} finally {ws.close();}
