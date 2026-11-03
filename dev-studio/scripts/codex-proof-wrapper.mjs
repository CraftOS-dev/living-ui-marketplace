import {spawn} from "node:child_process";
import {mkdir,writeFile,appendFile} from "node:fs/promises";
import {join} from "node:path";
const prompt=process.argv[2];
if(!prompt){console.error("No claimed framework task supplied.");process.exit(2);}
const instruction="You are the real standalone harness in a bounded integration test. The bridge already owns the task claim: do not claim or complete framework tasks. Find the request id in the supplied task payload. Run node scripts/agent-proof-client.mjs inspect <request-id>; it reads the request and linked evidence over A2App without exposing credentials. Review the evidence, calculate left+right yourself, then run node scripts/agent-proof-client.mjs submit <request-id> <answer> passed-or-blocked followed by a quoted concise evidence-based summary. Do not edit any source, start other agents, change settings or print credentials. Stop after submitting.\n\n"+prompt;
await mkdir(join(process.cwd(),".a2app","evidence"),{recursive:true});
const child=spawn(process.env.STUDIO_CODEX_ENTRY||"codex",["exec","--ephemeral","--json","--approve-for-me","-"],{cwd:process.cwd(),env:process.env,stdio:["pipe","pipe","pipe"],windowsHide:true});
child.stdin.end(instruction);
let pending="",events=0,errors=0,lastError=null;
child.stdout.on("data",chunk=>{
 pending+=chunk.toString();const lines=pending.split("\n");pending=lines.pop();
 for(const line of lines){try{const event=JSON.parse(line);events++;void appendFile(join(process.cwd(),".a2app","evidence","codex-events.jsonl"),JSON.stringify({type:event.type,itemType:event.item?.type,exitCode:event.item?.exit_code,command:event.item?.command?.replace(/(?:sk-|Bearer\s+)\S+/g,"[redacted]").slice(0,300)})+"\n");if(event.type==="error"||event.type==="turn.failed"){errors++;lastError=String(event.error?.message||event.message||"Harness error").replace(/(?:sk-|Bearer\s+)\S+/g,"[redacted]").slice(0,200);}}catch{}}
});
child.stderr.on("data",()=>{});
child.on("error",()=>{console.error("Codex CLI could not start. Check it is installed and authenticated.");process.exitCode=3;});
child.on("close",async code=>{
 const report={harness:"codex",exitCode:code,events,errors,lastError};
 await mkdir(join(process.cwd(),".a2app","evidence"),{recursive:true});
 await writeFile(join(process.cwd(),".a2app","evidence","codex-envelope.json"),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));process.exitCode=code|| (errors?1:0);
});
