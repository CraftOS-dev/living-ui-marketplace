import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {languageQuery,stopLanguages} from '../app/language-worker.mjs';
import {debugStart,debugState,debugControl,stopDebuggers} from '../app/debug-worker.mjs';
import {jobStart,jobState,jobStop,stopJobs} from '../app/jobs-worker.mjs';
const root=await mkdtemp(join(tmpdir(),'studio-execution-'));
process.env.STUDIO_DATA_DIR=join(root,'private');
const python=process.argv[2]?resolve(process.argv[2]):'python';
async function until(fn,check){for(let i=0;i<70;i++){const v=await fn();if(check(v))return v;await new Promise(r=>setTimeout(r,150));}throw new Error('Timed out waiting for real engine state.');}
try{
 await writeFile(join(root,'main.js'),'function add(a,b) {\n const total=a+b;\n return total;\n}\nconsole.log(add(2,3));\n');
 await writeFile(join(root,'typed.ts'),'const count: number = "bad";\nconsole.log(count);\n');
 await writeFile(join(root,'main.py'),'def add(a, b):\n    total = a + b\n    return total\n\nprint(add(2, 3))\n');
 const ts=await until(()=>languageQuery({root,path:'typed.ts',text:'const count: number = "bad";\nconsole.log(count);\n'}),v=>v.diagnostics.length>0);
 assert.ok(ts.diagnostics.some(d=>/string|number/.test(d.message)));console.log('PASS real TypeScript diagnostic');
 const py=await until(()=>languageQuery({root,path:'main.py',text:'value: int = "bad"\n'}),v=>v.diagnostics.length>0);
 assert.ok(py.diagnostics.length);console.log('PASS real Python diagnostic');
 for(const kind of ['javascript','python']){
  const started=await debugStart({root,path:kind==='python'?'main.py':'main.js',kind,python,breakpoints:[3]});
  let s=await until(()=>debugState({id:started.id}),v=>v.status==='paused');assert.ok(s.frames.length);
  await debugControl({id:s.id,action:'continue'});
  s=await until(()=>debugState({id:s.id}),v=>v.status==='paused'&&v.variables.some(v=>v.name==='total'));
  assert.equal(s.variables.find(v=>v.name==='total').value,'5');
  await debugControl({id:s.id,action:'next'});await until(()=>debugState({id:s.id}),v=>v.status==='paused');
  await debugControl({id:s.id,action:'continue'});await until(()=>debugState({id:s.id}),v=>v.status==='terminated');
  console.log('PASS '+kind+' breakpoint, stack, locals, step and termination');
 }
 const job=await jobStart({id:'owned-cancel',cwd:root,command:`& '${process.execPath}' -e "setInterval(()=>{},1000)"`});
 await new Promise(r=>setTimeout(r,700));const stopped=await jobStop(job.id);assert.equal(stopped.status,'canceled');assert.equal(stopped.stopConfirmed,true);assert.throws(()=>process.kill(job.pid,0));console.log('PASS owned process cancellation confirmed');
 console.log(JSON.stringify({root,python}));
}finally{await stopLanguages();await stopDebuggers();await stopJobs();}
