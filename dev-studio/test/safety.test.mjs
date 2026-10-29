// Independent regression tests. Inert task dispatches below test lease logic;
// they are not evidence of a real provider run or a fabricated agent result.
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,sep,basename} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
const exec=promisify(execFile);
const home=await fs.mkdtemp(join(tmpdir(),"studio-safety-"));
process.env.A2APP_DATA_DIR=join(home,"authority");
const {authority,safePath,readDocument,writeDocument,digest,registerRoot,git}=await import("../app/filesystem.mjs");
const {workRunners}=await import("../app/work-operations.mjs");
const {workspaceRunners,workspaceOperations}=await import("../app/workspace-operations.mjs");
const {inspectArtifacts}=await import("../app/artifacts.mjs");
const {cleanEnvironment}=await import("../app/jobs-worker.mjs");
const ctx={credentialId:"ui"};
test("connected agents cannot open a native folder picker", async()=>{
 await assert.rejects(()=>workspaceRunners["project-browse"]({initial:"C:\\"},{credentialId:"agent"}),/local app interface/);
});
const rows=new Map();
const store={put:(entity,value)=>{rows.set(entity+":"+value.id,value);return value;},get:(entity,id)=>rows.get(entity+":"+id),list:entity=>[...rows.entries()].filter(([k])=>k.startsWith(entity+":")).map(([,v])=>v)};
let dispatches=[];
const deps={store,trigger:(event,payload,capability)=>{const taskId="inert_test_"+(dispatches.length+1);dispatches.push({event,payload,capability,taskId});return{taskId};}};
async function folder(name){const p=join(home,name);await fs.mkdir(p);return p;}
async function rawGit(root,args){return exec("git",["-C",root,"-c","core.hooksPath="+join(home,"disabled-hooks"),...args],{windowsHide:true,env:{...process.env,GIT_CONFIG_COUNT:"0",GIT_TERMINAL_PROMPT:"0"}});}

test("case variants cannot address protected Git internals",async()=>{
 const root=await folder("case");await fs.mkdir(join(root,".git"));await fs.writeFile(join(root,".git","config"),"disposable");
 for(const path of [".git/config",".GIT/config",".Git/config"])await assert.rejects(()=>safePath(root,path),/protected/);
});

test("size-limited files retain actual digest and binary metadata",async()=>{
 const root=await folder("large"),bytes=Buffer.alloc(3*1024*1024,65);await fs.writeFile(join(root,"large.txt"),bytes);
 const result=await readDocument(root,"large.txt");assert.equal(result.large,true);assert.equal(result.text,null);assert.equal(result.size,bytes.length);assert.equal(result.digest,digest(bytes));assert.equal(result.binary,false);
 bytes[5]=0;await fs.writeFile(join(root,"large.bin"),bytes);const binary=await readDocument(root,"large.bin");assert.equal(binary.binary,true);assert.equal(binary.digest,digest(bytes));
});

test("non-UTF8 source is not exposed as lossy editable text",async()=>{
 const root=await folder("encoding"),bytes=Buffer.concat([Buffer.from("const name = 'caf"),Buffer.from([0xe9]),Buffer.from("';\n")]);
 await fs.writeFile(join(root,"legacy.js"),bytes);const result=await readDocument(root,"legacy.js");
 assert.equal(result.text,null,"A legacy code-page byte must not silently become a UTF-8 replacement character");assert.equal(result.digest,digest(bytes));
});

test("generated artifacts remain bounded to safe files with honest metadata",async()=>{
 const root=await folder("artifacts"),out=join(root,"out");await fs.mkdir(out);
 await fs.writeFile(join(out,"report.txt"),"test-generated");await fs.writeFile(join(out,".env"),"FAKE_TEST_ONLY=not-a-credential");
 const result=await inspectArtifacts(root,["out"],new Date(Date.now()-2000).toISOString());
 assert.deepEqual(result.files.map(f=>f.path),["out/report.txt"]);assert.equal(result.files[0].digest,digest("test-generated"));assert.equal(result.files[0].updatedDuringRun,true);
 const escape=await inspectArtifacts(root,["../outside"],new Date().toISOString());assert.equal(escape.files.length,0);assert.match(escape.warnings[0].message,/relative path/);
 for(let i=0;i<105;i++)await fs.writeFile(join(out,"bounded-"+i+".txt"),"x");
 const bounded=await inspectArtifacts(root,["out"],new Date().toISOString());assert.equal(bounded.files.length,100);assert.equal(bounded.truncated,true);
});

test("command secret variables require explicit name references",()=>{
 const key="STUDIO_TEST_FAKE_SECRET",prior=process.env[key];process.env[key]="not-a-credential";
 try{assert.equal(cleanEnvironment()[key],undefined);assert.equal(cleanEnvironment([key])[key],"not-a-credential");}
 finally{if(prior===undefined)delete process.env[key];else process.env[key]=prior;}
});

test("concurrent starts grant one writer and enforce the selected provider capability",async()=>{
 const root=await folder("writers");await fs.writeFile(join(root,"main.txt"),"disposable");authority().projects.writer={id:"writer",root,trusted:true,git:false};
 const make=title=>workRunners["work-create"]({project:"writer",title,goal:"Lease safety test",criteria:"Only one inert dispatch",mode:"standalone"},ctx,deps);
 const first=make("first"),second=make("second"),before=dispatches.length;
 const results=await Promise.allSettled([workRunners["work-start"]({work:first.id},ctx,deps),workRunners["work-start"]({work:second.id},ctx,deps)]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
 assert.equal(results.filter(r=>r.status==="rejected").length,1);
 assert.equal(dispatches.length-before,1);
 assert.equal(dispatches.at(-1).capability,"studio-development-standalone");
});

test("partial acceptance cannot reuse a revision's stale baseline or applied paths",async()=>{
 const root=await folder("revision");authority().projects.revision={id:"revision",root,trusted:true};
 authority().work.revision={id:"revision",project:"revision",status:"ready",applied:["accepted.txt"],attempt:"original-attempt"};
 const before=dispatches.length;
 await assert.rejects(()=>workRunners["work-revise"]({work:"revision",instruction:"Change the accepted file"},ctx,deps),/already accepted.*new work item/);
 assert.equal(dispatches.length,before);assert.equal(authority().work.revision.attempt,"original-attempt");assert.equal(authority().work.revision.status,"ready");
});

test("actual registered Git roots use worktrees and scrub tracked fake credentials",async()=>{
 const root=await folder("tracked");await fs.writeFile(join(root,"main.js"),"export const value=1;\n");
 await fs.writeFile(join(root,".env"),"FAKE_TEST_SECRET=not-a-credential\n");await fs.writeFile(join(root,".npmrc"),"//example.invalid/:_authToken=FAKE_TEST_ONLY\n");
 await rawGit(root,["init"]);await rawGit(root,["add","."]);await rawGit(root,["-c","user.name=Disposable verification","-c","user.email=verification@example.invalid","commit","-m","fixture"]);
 const p=await registerRoot(root);p.trusted=true;
 const w=workRunners["work-create"]({project:p.id,title:"Tracked file isolation",goal:"Safety fixture",criteria:"No fake credentials copied",mode:"craftbot"},ctx,deps);
 await workRunners["work-start"]({work:w.id},ctx,deps);const isolated=authority().work[w.id];
 assert.equal(isolated.worktree,true,"Windows slash normalization must reach the Git worktree path");
 for(const name of [".env",".npmrc"])await assert.rejects(()=>fs.access(join(isolated.root,name)));
 assert.match(await fs.readFile(join(root,".env"),"utf8"),/FAKE_TEST_SECRET/);
 assert.equal(dispatches.at(-1).capability,"studio-development-craftbot");
});

test("concurrent managed human save wins without being overwritten by review application",async()=>{
 const root=await folder("destination"),copy=await folder("isolated"),baseline=await folder("baseline");
 for(const dir of [root,baseline])await fs.writeFile(join(dir,"a.txt"),"original");await fs.writeFile(join(copy,"a.txt"),"proposed");
 authority().projects.cas={id:"cas",root,trusted:true};
 // A synthetic review structure isolates CAS logic; no provider success is claimed.
 authority().work.cas={id:"cas",project:"cas",root:copy,baselineRoot:baseline,baseline:{"a.txt":{digest:digest("original")}},status:"ready",applied:[]};
 const [saved,applied]=await Promise.all([writeDocument(root,"a.txt","human",digest("original")),workRunners["review-apply"]({work:"cas",paths:["a.txt"]},ctx,deps)]);
 assert.equal(saved.text,"human");assert.equal(await fs.readFile(join(root,"a.txt"),"utf8"),"human");assert.deepEqual(applied,{applied:[],conflicts:["a.txt"]});
});

test("empty files can be created, populated and cleared without a placeholder",async()=>{
 const root=await folder("empty");authority().projects.empty={id:"empty",root,trusted:false};
 assert.equal(workspaceOperations.find(o=>o.name==="file-write").params.text.required,false);
 let doc=await workspaceRunners["file-write"]({project:"empty",path:"empty.txt",text:"",create:true},ctx,deps);
 assert.equal(doc.text,"");assert.equal((await fs.stat(join(root,"empty.txt"))).size,0);
 doc=await workspaceRunners["file-write"]({project:"empty",path:"empty.txt",text:"populated",expected:doc.digest},ctx,deps);
 doc=await workspaceRunners["file-write"]({project:"empty",path:"empty.txt",text:"",expected:doc.digest},ctx,deps);
 assert.equal(doc.text,"");assert.equal((await fs.stat(join(root,"empty.txt"))).size,0);
});

test("binary conflict requires an explicit byte choice and rechecks the destination CAS",async()=>{
 const root=await folder("binary-destination"),copy=await folder("binary-isolated"),baseline=await folder("binary-baseline");
 const before=Buffer.from([0,1,2,3]),human=Buffer.from([0,4,5,6]),proposed=Buffer.from([0,7,8,9]);
 await fs.writeFile(join(root,"asset.bin"),human);await fs.writeFile(join(copy,"asset.bin"),proposed);await fs.writeFile(join(baseline,"asset.bin"),before);
 authority().projects.binary={id:"binary",root,trusted:true};
 authority().work.binary={id:"binary",project:"binary",root:copy,baselineRoot:baseline,baseline:{"asset.bin":{digest:digest(before)}},status:"ready",applied:[]};
 assert.deepEqual(await workRunners["review-apply"]({work:"binary",paths:["asset.bin"]},ctx,deps),{applied:[],conflicts:["asset.bin"]});
 await assert.rejects(()=>workRunners["review-resolve"]({work:"binary",path:"asset.bin",text:"",expected:digest(human)},ctx,deps),/explicit agent-file/);
 await assert.rejects(()=>workRunners["review-resolve"]({work:"binary",path:"asset.bin",useAgent:true,expected:digest(before)},ctx,deps),/conflict/);
 assert.deepEqual(await fs.readFile(join(root,"asset.bin")),human);
 await workRunners["review-resolve"]({work:"binary",path:"asset.bin",useAgent:true,expected:digest(human)},ctx,deps);
 assert.deepEqual(await fs.readFile(join(root,"asset.bin")),proposed);
 const recovery=Object.values(authority().checkpoints).find(c=>c.project==="binary");assert.ok(recovery);assert.deepEqual(await fs.readFile(join(process.env.A2APP_DATA_DIR,"checkpoints",recovery.id)),human);
});

test("inspection does not execute a repository-configured fsmonitor",async()=>{
 const root=await folder("monitor");await rawGit(root,["init"]);const marker=join(root,"invoked.txt");
 const monitor=join(root,process.platform==="win32"?"monitor.cmd":"monitor.sh");
 await fs.writeFile(monitor,process.platform==="win32"?'@echo off\r\necho invoked>>"%~dp0invoked.txt"\r\nexit /b 0\r\n':`#!/bin/sh\nprintf invoked >> '${marker.replaceAll("'","'\\''")}'\n`,{mode:0o700});
 await rawGit(root,["config","core.fsmonitor",monitor.replaceAll("\\","/")]);
 // Positive control proves this fixture would execute with ordinary Git.
 await rawGit(root,["status","--porcelain=v1","-z"]);await fs.access(marker);await fs.unlink(marker);
 await git(root,["status","--porcelain=v1","-z"]);await assert.rejects(()=>fs.access(marker));
});

test("declared build outputs stay fresh while actual source edits invalidate checks", async()=>{
 const {snapshot,outputExclusions}=await import("../app/filesystem.mjs");
 const root=await folder("output-fingerprint");await fs.writeFile(join(root,"input.js"),"source v1");
 const options={excludePaths:["build-result.txt","generated"]};const before=await snapshot(root,options);
 await fs.writeFile(join(root,"build-result.txt"),"output v1");await fs.mkdir(join(root,"generated"));await fs.writeFile(join(root,"generated","bundle.js"),"generated");
 assert.equal((await snapshot(root,options)).fingerprint,before.fingerprint);
 assert.ok((await snapshot(root)).files["build-result.txt"]);
 await fs.writeFile(join(root,"input.js"),"source v2");assert.notEqual((await snapshot(root,options)).fingerprint,before.fingerprint);
 for(const path of ["", ".", "../", "/", "C:/"])assert.throws(()=>outputExclusions([path]),/output files or folders/);
});

test.after(async()=>{
 const target=resolve(home),parent=resolve(tmpdir());
 if(!target.startsWith(parent+sep)||!basename(target).startsWith("studio-safety-"))throw new Error("Refusing cleanup outside the owned disposable fixture");
 await fs.rm(target,{recursive:true,force:true});
});
