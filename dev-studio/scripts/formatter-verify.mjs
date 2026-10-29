// Independent large-buffer formatter acceptance through real app operations.
import assert from "node:assert/strict";
import {mkdtemp,writeFile,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {operation,base} from "./client.mjs";
const op=(name,args={})=>operation(name,args,true);
const python=process.argv[2]||resolve("../.milestone-tools/python-tools/Scripts/python.exe");
const previous=(await op("workspace-state")).preferences;
const root=join(await mkdtemp(join(tmpdir(),"studio-format-verify-")),"python");
const project=await op("project-create",{path:root,kind:"empty"});await op("project-trust",{project:project.id,enabled:true});
let result;
try{
 await op("preferences-save",{theme:previous.theme||"system",python});
 const prefix="value={'a':[1,2,3]}\n",padding="# "+"x".repeat(100)+"\n";
 let text=prefix;while(text.length+padding.length<=65536)text+=padding;
 const remaining=65536-text.length;if(remaining)text+="#"+"x".repeat(remaining-1);
 assert.equal(Buffer.byteLength(text),65536);
 await op("file-write",{project:project.id,path:"large.py",text,create:true});
 const formatted=await op("format-text",{project:project.id,path:"large.py",text});
 assert.match(formatted.text,/value = \{"a": \[1, 2, 3\]\}/);assert.ok(formatted.text.includes("x".repeat(100)));assert.ok(formatted.text.length>64000);
 result={checkedAt:new Date().toISOString(),base,project:project.id,python,inputBytes:65536,outputBytes:Buffer.byteLength(formatted.text),stdinFormatter:true,passed:true};
}finally{await op("preferences-save",{theme:previous.theme||"system",python:previous.python||""});}
await mkdir(new URL("../.a2app/evidence/",import.meta.url),{recursive:true});await writeFile(new URL("../.a2app/evidence/formatter.json",import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
