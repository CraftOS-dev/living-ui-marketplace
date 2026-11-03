import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ROOT} from '../app/config.mjs';
import {operation,request} from './client.mjs';
const op=(n,a={})=>operation(n,a,true);
await op('connector-control',{action:'connect'});
const fixture=JSON.parse(await readFile(join(ROOT,'.a2app/workspace-fixtures.json'),'utf8'));
const work=await op('work-create',{project:fixture.project,title:'Real human-question and resume acceptance',mode:'standalone',goal:'Add a small exported arithmetic function and a real node:test case. Before editing, ask me via work-question whether I want multiplication or division; stop and wait for my answer. After I answer, implement multiply(a,b) if I choose multiplication, or divide(a,b) if I choose division. Keep existing behavior, run the saved test configuration, and submit isolated changes.',criteria:'A question is parked before editing; the answer controls which function is added; a real test checks the chosen function on 6 and 3; saved tests exit 0.',context:'Disposable question/resume acceptance fixture. Do not guess the answer before it is supplied.'});
const initial=await op('work-start',{work:work.id});console.log(JSON.stringify({phase:'queued',work:work.id,task:initial.task}));
let state;
for(let i=0;i<180;i++){state=await op('work-sync',{work:work.id});if(state.status==='needs-input')break;if(state.status==='failed')throw Error(state.summary);await new Promise(r=>setTimeout(r,2000));}
assert.equal(state.status,'needs-input');assert.ok(state.question);console.log(JSON.stringify({phase:'asked',question:state.question}));
let resumed;
for(let i=0;i<30;i++){try{resumed=await op('work-answer',{work:work.id,answer:'Multiplication, please. Implement multiply(a, b) and test multiply(6, 3) equals 18.'});break;}catch(e){if(!/still finishing/.test(e.message))throw e;await new Promise(r=>setTimeout(r,1000));}}
assert.ok(resumed?.task);console.log(JSON.stringify({phase:'resumed',task:resumed.task}));
for(let i=0;i<180;i++){state=await op('work-sync',{work:work.id});if(i%15===0)console.log(JSON.stringify({phase:'progress',status:state.status,delivery:state.task.status}));if(['completed','failed','canceled'].includes(state.task.status))break;await new Promise(r=>setTimeout(r,2000));}
const report={checkedAt:new Date().toISOString(),work:work.id,initial:initial.task,resumed:resumed.task,status:state.status,delivery:state.task.status,answers:state.answers,summary:state.summary,passed:state.status==='ready'&&state.task.status==='completed'&&state.answers.length===1};
const all=await op('workspace-state');const receipts={initial:await request('/api/_a2app/tasks/'+initial.task),resumed:await request('/api/_a2app/tasks/'+resumed.task),context:await op('work-context',{work:work.id}),review:await op('review-changes',{work:work.id}),runs:await Promise.all(all.runs.filter(r=>r.work===work.id).map(r=>op('run-inspect',{run:r.id})))};await writeFile(join(ROOT,'.a2app/evidence/question-resume-receipts.json'),JSON.stringify(receipts,null,2));
await writeFile(join(ROOT,'.a2app/evidence/question-resume.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));assert.equal(report.passed,true);
