// Independent HTTP regression: preserve true empty text through framework guards.
import assert from "node:assert/strict";
import {mkdtemp,stat,readFile,mkdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {operation,base} from "./client.mjs";
const op=(name,args={})=>operation(name,args,true);
const root=join(await mkdtemp(join(tmpdir(),"studio-empty-verify-")),"plain");
const project=await op("project-create",{path:root,kind:"empty"});
let doc=await op("file-write",{project:project.id,path:"empty.txt",text:"",create:true});
assert.equal((await stat(join(root,"empty.txt"))).size,0);
doc=await op("file-write",{project:project.id,path:"empty.txt",text:"real text",expected:doc.digest});
doc=await op("file-write",{project:project.id,path:"empty.txt",text:"",expected:doc.digest});
assert.equal(doc.text,"");assert.equal(await readFile(join(root,"empty.txt"),"utf8"),"");
const result={checkedAt:new Date().toISOString(),base,project:project.id,root,createdZeroBytes:true,clearedZeroBytes:true,passed:true};
await mkdir(new URL("../.a2app/evidence/",import.meta.url),{recursive:true});
await writeFile(new URL("../.a2app/evidence/empty-file.json",import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
