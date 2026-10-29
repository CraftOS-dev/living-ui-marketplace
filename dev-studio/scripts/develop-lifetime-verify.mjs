// Independent HTTP verification using only disposable project records and files.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {operation,base} from './client.mjs';
const op=(name,args={})=>operation(name,args,true);
const root=join(await mkdtemp(join(tmpdir(),'studio-develop-lifetime-')),'plain');
let service;
try {
  const project=await op('project-create',{path:root,kind:'empty'});
  await op('file-write',{project:project.id,path:'service.mjs',text:'console.log("INDEPENDENT_SERVICE_READY");setInterval(()=>{},1000);\n',create:true});
  await op('project-trust',{project:project.id,enabled:true});
  const config=await op('config-save',{project:project.id,name:'Independent persistent development service',kind:'develop',command:'node service.mjs'});
  service=await op('run-start',{config:config.id});
  assert.equal(service.timeoutMs,null);
  let running;
  for(let i=0;i<60;i++) {
    running=await op('run-inspect',{run:service.id});
    if(running.output.includes('INDEPENDENT_SERVICE_READY'))break;
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(running.status,'running');
  assert.match(running.output,/INDEPENDENT_SERVICE_READY/);
  const check=await op('config-save',{project:project.id,name:'Independent bounded check',kind:'test',command:'node --version'});
  const bounded=await op('run-start',{config:check.id});
  assert.equal(bounded.timeoutMs,600000);
  const stopped=await op('run-stop',{run:service.id});
  assert.equal(stopped.status,'canceled');
  assert.equal(stopped.stopConfirmed,true);
  assert.throws(()=>process.kill(service.pid,0));
  const result={checkedAt:new Date().toISOString(),base,project:project.id,service:{id:service.id,timeoutMs:service.timeoutMs,observedOutput:running.output,statusBeforeStop:running.status,statusAfterStop:stopped.status,stopConfirmed:stopped.stopConfirmed},ordinaryCheck:{id:bounded.id,timeoutMs:bounded.timeoutMs},passed:true};
  await mkdir(new URL('../.a2app/evidence/',import.meta.url),{recursive:true});
  await writeFile(new URL('../.a2app/evidence/develop-lifetime-independent.json',import.meta.url),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally {
  if(service)await op('run-stop',{run:service.id}).catch(()=>{});
}
