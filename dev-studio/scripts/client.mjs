import {readFile} from "node:fs/promises";
import {ROOT,manifest} from "../app/config.mjs";
import {join} from "node:path";
const candidate=await readFile(join(ROOT,".a2app","dev.json"),"utf8").then(JSON.parse).catch(()=>null);
export const base=process.env.STUDIO_URL||candidate?.url||"http://127.0.0.1:"+manifest.port;
export async function request(path,{human=false,...init}={}) {
  const headers={"content-type":"application/json",...(init.headers||{})};
  if(human)headers.origin=base;
  else headers["x-a2app-token"]=(await readFile(join(ROOT,".agent-token"),"utf8")).trim();
  const res=await fetch(base+path,{...init,headers,signal:AbortSignal.timeout(25000)});
  const json=await res.json();
  if(!res.ok)throw Object.assign(new Error(json.message||"HTTP "+res.status),{status:res.status,body:json});
  return json;
}
export async function operation(name,args={},human=false) {
  const json=await request("/api/ops/"+name,{human,method:"POST",body:JSON.stringify(args)});
  return json.result;
}
