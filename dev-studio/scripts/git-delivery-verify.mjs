// Independent acceptance: application operations against local disposable Git only.
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {operation,base} from "./client.mjs";
const exec=promisify(execFile),op=(name,args={})=>operation(name,args,true);
const home=await mkdtemp(join(tmpdir(),"studio-git-delivery-")),remote=join(home,"remote.git");
const setupGit=(root,args)=>exec("git",["-C",root,"-c","core.fsmonitor=false","-c","core.hooksPath="+join(home,"disabled-hooks"),...args],{windowsHide:true,env:{...process.env,GIT_CONFIG_COUNT:"0",GIT_TERMINAL_PROMPT:"0"}});
const identity=async root=>{await setupGit(root,["config","user.name","Disposable release verification"]);await setupGit(root,["config","user.email","verification@example.invalid"]);};
const main=await op("project-create",{path:join(home,"main"),kind:"empty"});
await op("project-trust",{project:main.id,enabled:true});await op("git-init",{project:main.id});await identity(main.root);
await op("file-write",{project:main.id,path:"README.md",text:"initial\n",create:true});
await op("git-stage",{project:main.id,path:"README.md"});
assert.equal((await op("git-status",{project:main.id})).files.find(f=>f.path==="README.md").index,"A");
await op("git-commit",{project:main.id,message:"Initial fixture"});
let file=await op("file-read",{project:main.id,path:"README.md"});
await op("file-write",{project:main.id,path:"README.md",text:"local update\n",expected:file.digest});
await op("git-stage",{project:main.id,path:"README.md"});await op("git-stage",{project:main.id,path:"README.md",unstage:true});
let status=await op("git-status",{project:main.id}),changed=status.files.find(f=>f.path==="README.md");assert.equal(changed.index," ");assert.equal(changed.working,"M");
await op("git-stage",{project:main.id,path:"README.md"});await op("git-commit",{project:main.id,message:"Local update"});
assert.match((await op("git-diff",{project:main.id})).history,/Local update/);
await mkdir(remote);await setupGit(remote,["init","--bare"]);await setupGit(main.root,["remote","add","origin",remote]);
// Fixture setup supplies remote/tracking preferences; all delivery calls use the app.
await setupGit(main.root,["config","push.autoSetupRemote","true"]);
await op("git-remote",{project:main.id,action:"push"});
const peer=await op("project-clone",{path:join(home,"peer"),url:new URL("file:///"+remote.replaceAll("\\","/")).href});
await identity(peer.root);await op("project-trust",{project:peer.id,enabled:true});
file=await op("file-read",{project:peer.id,path:"README.md"});await op("file-write",{project:peer.id,path:"README.md",text:"from peer\n",expected:file.digest});
await op("git-stage",{project:peer.id,path:"README.md"});await op("git-commit",{project:peer.id,message:"Peer update"});await op("git-remote",{project:peer.id,action:"push"});
await op("git-remote",{project:main.id,action:"fetch"});await op("git-remote",{project:main.id,action:"pull"});
// Git's configured checkout EOL conversion is legitimate on Windows.
assert.equal((await op("file-read",{project:main.id,path:"README.md"})).text.replaceAll("\r\n","\n"),"from peer\n");assert.equal((await op("git-status",{project:main.id})).files.length,0);
const history=(await op("git-diff",{project:main.id})).history;assert.match(history,/Peer update/);assert.match(history,/Initial fixture/);
const result={checkedAt:new Date().toISOString(),base,home,project:main.id,clone:peer.id,remote,checks:["explicit init","stage","unstage","commit","history","local push","app clone","peer app commit/push","fetch","fast-forward pull","clean working tree"],history,passed:true};
await mkdir(new URL("../.a2app/evidence/",import.meta.url),{recursive:true});await writeFile(new URL("../.a2app/evidence/git-delivery.json",import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
