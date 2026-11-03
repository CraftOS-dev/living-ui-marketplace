import WebSocket from 'ws';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {ROOT} from '../app/config.mjs';
const host=process.env.CRAFTBOT_URL||'http://127.0.0.1:8926';
const source=resolve(process.argv[2]);
const {token}=await fetch(host+'/api/session-token',{signal:AbortSignal.timeout(10000)}).then(r=>r.json());
const ws=new WebSocket(host.replace('http','ws')+'/ws',['craftbot','craftbot-auth.'+token],{origin:host});
await new Promise((y,n)=>{ws.once('open',y);ws.once('error',n);});
const inbox=[];ws.on('message',b=>{try{inbox.push(JSON.parse(b));}catch{}});
async function wait(type,predicate=()=>true){for(let i=0;i<1800;i++){const at=inbox.findIndex(v=>v.type===type&&predicate(v.data));if(at>=0)return inbox.splice(at,1)[0].data;await new Promise(r=>setTimeout(r,200));}throw Error('Native import timed out: '+type);}
try{
 ws.send(JSON.stringify({type:'agent_app_import',source,name:'Development Studio 1 release'}));
 const imported=await wait('agent_app_import_result');if(!imported.success)throw Error(imported.error);
 const {project}=await wait('agent_app_create',v=>v.projectId===imported.projectId);
 if(project.projectType!=='native'||project.agentAppVersion!=='0.1.0')throw Error('Wrong native framework classification.');
 const identity=await fetch(project.url+'/api/_a2app',{signal:AbortSignal.timeout(10000)}).then(r=>r.json());
 if(identity.app.id!==project.id)throw Error('Fresh native identity mismatch.');
 const report={checkedAt:new Date().toISOString(),host,project:{id:project.id,path:project.path,url:project.url,session:project.sessionId,type:project.projectType,format:project.agentAppVersion},passed:true};
 await mkdir(join(ROOT,'.a2app/evidence'),{recursive:true});await writeFile(join(ROOT,'.a2app/evidence/native-release.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{ws.close();}
