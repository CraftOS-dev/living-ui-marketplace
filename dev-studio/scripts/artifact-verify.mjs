// Independent real build output acceptance through app HTTP operations.
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {operation,base} from "./client.mjs";
const op=(name,args={})=>operation(name,args,true);
const root=join(await mkdtemp(join(tmpdir(),"studio-artifact-verify-")),"plain");
const project=await op("project-create",{path:root,kind:"empty"});
await op("file-write",{project:project.id,path:"build.mjs",text:'import {mkdir,writeFile} from "node:fs/promises";await mkdir("dist",{recursive:true});await writeFile("dist/result.txt","INDEPENDENT_BUILD_OUTPUT\\n");console.log("build complete");\n',create:true});
await op("project-trust",{project:project.id,enabled:true});
const config=await op("config-save",{project:project.id,name:"Disposable artifact proof",kind:"build",command:"node build.mjs",artifactPaths:["dist"]});
const start=await op("run-start",{config:config.id});let run;
for(let n=0;n<80;n++){run=await op("run-inspect",{run:start.id});if(!["running","stopping"].includes(run.status))break;await new Promise(r=>setTimeout(r,100));}
assert.equal(run.status,"passed");assert.equal(run.exitCode,0);assert.equal(run.artifacts.length,1);
const record=run.artifacts[0];assert.equal(record.path,"dist/result.txt");assert.equal(record.updatedDuringRun,true);
const actual=await readFile(join(root,"dist/result.txt"));assert.equal(record.digest,createHash("sha256").update(actual).digest("hex"));assert.equal(record.size,actual.length);
const document=await op("run-artifact",{run:run.id,path:record.path});assert.equal(document.text,"INDEPENDENT_BUILD_OUTPUT\n");
await assert.rejects(()=>op("run-artifact",{run:run.id,path:"build.mjs"}),/recorded artifacts/);
const result={checkedAt:new Date().toISOString(),base,project:project.id,run:run.id,artifact:record,readback:document.text,passed:true};
await mkdir(new URL("../.a2app/evidence/",import.meta.url),{recursive:true});await writeFile(new URL("../.a2app/evidence/artifact.json",import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
