import {spawn} from "node:child_process";
import {mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {ROOT} from "../app/config.mjs";
import {operation,request} from "./client.mjs";
const home=join(ROOT,".a2app","proof-home");
const useClaude=process.argv.includes("--claude");
const harnessId=useClaude?"studio-claude":"studio-codex";
const harnessName=useClaude?"Claude Code":"Codex CLI";
await mkdir(home,{recursive:true});
await writeFile(join(home,"harnesses.json"),JSON.stringify({version:1,default:harnessId,harnesses:[{
 id:harnessId,name:harnessName+" integration proof",routes:[{mode:"headless",command:process.execPath,args:[join(ROOT,"scripts",useClaude?"claude-proof-wrapper.mjs":"codex-proof-wrapper.mjs"),"{prompt}"],cwd:"app",timeoutMs:180000}]
}]}));
await operation("run-local-proof");
const review=await operation("create-proof-request",{mode:"standalone",title:"Standalone harness: inspect the real execution receipt"});
const cli=join(ROOT,"node_modules","agent-app-framework","dist","agent-app.js");
const child=spawn(process.execPath,[cli,ROOT,"bridge","start","--once","--harness",harnessId,"--capability","studio-standalone-proof","--task-timeout","180000"],{
 cwd:ROOT,env:{...process.env,A2APP_HOME:home},stdio:["ignore","pipe","pipe"],windowsHide:true,
});
let bridgeOutput="";
child.stdout.on("data",d=>{bridgeOutput=(bridgeOutput+d).slice(-15000);});
child.stderr.on("data",d=>{bridgeOutput=(bridgeOutput+d).slice(-15000);});
const exitCode=await new Promise(resolve=>child.once("exit",resolve));
await mkdir(join(ROOT,".a2app","evidence"),{recursive:true});
await writeFile(join(ROOT,".a2app","evidence","standalone-bridge.log"),bridgeOutput);
const stored=await request("/api/collections/requests/records/"+review.id);
const task=await request("/api/_a2app/tasks/"+review.agentTask);
const report={checkedAt:new Date().toISOString(),request:review.id,task:review.agentTask,harness:harnessName,route:"framework headless bridge via Node wrapper for the installed CLI",exitCode,requestStatus:stored.status,taskStatus:task.status,summary:stored.summary||null,passed:exitCode===0&&stored.status==="passed"&&task.status==="completed"};
await mkdir(join(ROOT,".a2app","evidence"),{recursive:true});
await writeFile(join(ROOT,".a2app","evidence","standalone.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.passed){console.error("Standalone round trip failed. Inspect the configured harness; no agent response was simulated.");process.exitCode=1;}
