// This driver requests development; it never supplies code or an agent result.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {ROOT} from '../app/config.mjs';
import {operation,request,base} from './client.mjs';
const op=(name,args={})=>operation(name,args,true);
const mode=process.argv[2]||'standalone';
const fixture=JSON.parse(await readFile(join(ROOT,'.a2app/workspace-fixtures.json'),'utf8'));
if(mode==='standalone')console.log('CONNECT',JSON.stringify(await op('connector-control',{action:'connect'})));
const work=await op('work-create',{project:fixture.project,mode,title:mode+' real coding acceptance',goal:'Add an exported farewell(name) function to main.js that returns `Goodbye, ${name}!`. Add a real node:test case in main.test.js for farewell("Ada"). Keep the existing greeting behavior. Run the saved test configuration in the isolated work copy and submit changes for human review.',criteria:'farewell("Ada") returns "Goodbye, Ada!"; existing greeting test still passes; actual saved test run exits 0.',context:'This is a disposable release acceptance fixture. Use the declared isolated file operations and saved test command.'});
const started=await op('work-start',{work:work.id});
console.log(JSON.stringify({phase:'queued',mode,base,work:work.id,task:started.task}));
let result,task;
for(let i=0;i<240;i++){
 result=await op('work-sync',{work:work.id});task=await request('/api/_a2app/tasks/'+started.task);
 if(i%10===0)console.log(JSON.stringify({phase:'progress',status:result.status,delivery:task.status,progress:result.progress?.at(-1)?.message}));
 if(['completed','failed','canceled','input-required'].includes(task.status))break;
 await new Promise(r=>setTimeout(r,2000));
}
const review=await op('review-changes',{work:work.id});
const report={checkedAt:new Date().toISOString(),mode,base,project:fixture.project,work:work.id,task:started.task,status:result.status,delivery:task.status,summary:result.summary,files:review.files.map(f=>({path:f.path,status:f.status})),passed:result.status==='ready'&&task.status==='completed'&&review.files.some(f=>f.path==='main.js')&&review.files.some(f=>f.path==='main.test.js')};
await mkdir(join(ROOT,'.a2app/evidence'),{recursive:true});await writeFile(join(ROOT,'.a2app/evidence/development-'+mode+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
