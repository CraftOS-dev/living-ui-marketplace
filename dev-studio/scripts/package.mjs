import {readdir,mkdir,readFile,writeFile} from "node:fs/promises";
import {join,relative,resolve} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHash} from "node:crypto";
import {ROOT} from "../app/config.mjs";
const exec=promisify(execFile);
const ignored=new Set(["node_modules","data","dist",".a2app",".agent-token",".principal",".superuser",".claude",".env",".git"]);
const files=[];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
 if(ignored.has(entry.name)||/^\.env(?:\.|$)|^\.npmrc$|^\.ssh$/i.test(entry.name)||entry.name.endsWith(".log"))continue;
 const p=join(dir,entry.name);if(entry.isSymbolicLink())throw new Error("Package refuses symbolic links: "+relative(ROOT,p));
 if(entry.isDirectory())await walk(p);else files.push(relative(ROOT,p).replaceAll("\\","/"));
}}
await walk(ROOT);
const out=resolve(ROOT,"../.milestone-tools/deliverables");
await mkdir(out,{recursive:true});
await writeFile(join(out,"files.txt"),files.join("\n"));
const zip=join(out,"development-studio-v1.zip");
await exec("tar.exe",["-a","-cf",zip,"-C",ROOT,"-T",join(out,"files.txt")],{windowsHide:true});
const sha256=createHash("sha256").update(await readFile(zip)).digest("hex");
console.log(JSON.stringify({zip,sha256,files:files.length,excluded:[...ignored]},null,2));
