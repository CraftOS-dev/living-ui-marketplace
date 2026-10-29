import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT} from '../app/config.mjs';
const target=resolve(process.argv[2]||ROOT),mode=process.argv[3]||'standalone';
const {operation,request,base}=await import(pathToFileURL(join(target,'scripts/client.mjs')));
const op=(n,a={})=>operation(n,a,true);
const state=await op('workspace-state');
const p=state.projects.find(p=>p.root.includes('javascript'))||state.projects.find(p=>p.kind==='javascript')||state.projects[0];
assert.ok(p);
const w=await op('work-create',{project:p.id,mode,title:'Actual active cancellation acceptance',goal:'Inspect the isolated work context and existing source. Report an inspection plan with work-progress. Do not change files or run commands. This is a cancellation acceptance fixture; the human will stop the task shortly.',criteria:'No main-project edits; cancellation revokes the managed write lease.'});
const started=await op('work-start',{work:w.id});
let claimed,processEvidence;
for(let i=0;i<180;i++){
 const task=await request('/api/_a2app/tasks/'+started.task);
 if(task.status==='working'){
  if(mode==='craftbot'){
   const host=process.env.CRAFTBOT_URL||'http://127.0.0.1:8926';
   const hostState=await fetch(host+'/api/state').then(r=>r.json());
   const manifest=JSON.parse(await readFile(join(target,'manifest.json'),'utf8'));
   if(hostState.busySessions?.includes('agentapp_'+manifest.id)){claimed=task;processEvidence={busySession:true,app:manifest.id};break;}
  }else{
   const dev=await readFile(join(target,'.a2app/dev.json'),'utf8').then(JSON.parse).catch(()=>null);
   const data=dev?join(dev.bootDir,'data'):join(target,'data');
   const receipt=await readFile(join(data,'agent-processes',started.task+'.json'),'utf8').then(JSON.parse).catch(()=>null);
   if(receipt?.pid&&!receipt.finished){try{process.kill(receipt.pid,0);claimed=task;processEvidence={pid:receipt.pid};break;}catch{}}
  }
 }
 if(['completed','failed','canceled'].includes(task.status))throw Error('Task ended before active-cancellation observation: '+task.status);
 await new Promise(r=>setTimeout(r,500));
}
assert.ok(claimed,'Actual working task and owned process must be observed');
console.log(JSON.stringify({phase:'active-observed',mode,task:started.task,processEvidence}));
let canceled=await op('work-cancel',{work:w.id});
for(let i=0;i<80&&canceled.status!=='canceled';i++){await new Promise(r=>setTimeout(r,500));canceled=await op('work-sync',{work:w.id});}
assert.equal(canceled.status,'canceled');assert.equal(canceled.stopConfirmed,true);
const task=await request('/api/_a2app/tasks/'+started.task);assert.equal(task.status,'canceled');
await assert.rejects(()=>operation('work-progress',{work:w.id,message:'Late progress must be refused'},false));
if(processEvidence.pid){assert.throws(()=>process.kill(processEvidence.pid,0));}
const report={checkedAt:new Date().toISOString(),base,mode,work:w.id,task:started.task,processEvidence,status:canceled.status,stopConfirmed:canceled.stopConfirmed,delivery:task.status,lateAgentWriteRefused:true,passed:true};
await writeFile(join(ROOT,'.a2app/evidence/active-cancel-'+mode+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
