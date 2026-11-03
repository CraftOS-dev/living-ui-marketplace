import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hooks=path.join(root,'pb/pb_hooks');
class Rec {
 constructor(collection, fields={}) { this.collection=collection; this.id=fields.id || Math.random().toString(36).slice(2); this.fields={...fields}; }
 getString(k) { const v=this.fields[k]; return v==null?'':typeof v==='object'?JSON.stringify(v):String(v); }
 getBool(k) { return this.fields[k]===true; }
 getInt(k) { return Number(this.fields[k])||0; }
 set(k,v) { this.fields[k]=structuredClone(v); }
}
const mem=new Map();
const app={ rows:[],store:()=>({get:k=>mem.get(k),set:(k,v)=>mem.set(k,v),remove:k=>mem.delete(k)}),runInTransaction(fn){fn(this);}, save(r){if(!this.rows.includes(r))this.rows.push(r);},findCollectionByNameOrId:n=>n,
 findRecordById(c,id){const r=this.rows.find(x=>x.collection===c&&x.id===id);if(!r)throw Error('missing');return r;},
 findRecordsByFilter(c,filter='',sort='',limit=0,offset=0,params={}) {let rows=this.rows.filter(x=>x.collection===c); if(params.key || params.k)rows=rows.filter(x=>x.getString('key')===(params.key || params.k)); if(filter.includes("judge_state = 'error'"))rows=rows.filter(x=>x.getString('judge_state')==='error');else if(filter.includes("judge_state = 'queued'"))rows=rows.filter(x=>['queued','running'].includes(x.getString('judge_state')));return limit?rows.slice(offset,offset+limit):rows;},
 findFirstRecordByFilter(c,filter,params){const r=this.findRecordsByFilter(c,filter,'',1,0,params)[0];if(!r)throw Error('missing');return r;}
};
let calls=0, onLLM=()=>{}, offline=false;
const cache={};
const bridge={callLLM(prompt){calls++;onLLM(prompt);if(offline)return '';if(prompt.includes('Review each answer below')){const keys=[...prompt.matchAll(/^KEY: (.+)$/gm)].map(x=>x[1]);return JSON.stringify({answers:keys.map(key=>({key,restated:'Reviewed saved text',clear:true,strength:2,issues:[{type:'grammar',quote:'old phrase',fix:'Fix the old phrase'}],missing:[],shorter:''}))});}return JSON.stringify({summary:'New application feedback',top_fixes:['Show a customer example'],one_liner_clear:true,founder_signal:2,founder_market_fit:2,insight:2,differentiation:1,demand:2,team_history:1,complementary:true,overclaims:[],inconsistencies:[]});}};
function load(name){if(cache[name])return cache[name];if(name==='_craftbot_bridge')return bridge;if(name==='lib_bus')return {flush(){}};const mod={exports:{}};cache[name]=mod.exports;vm.runInNewContext(fs.readFileSync(path.join(hooks,name+'.js'),'utf8'),{module:mod,__hooks:'/hooks',Record:Rec,require:p=>load(path.basename(p,'.js')),console,sleep(){},Date,Math});return cache[name]=mod.exports;}
const U=load('lib_util'), Q=load('lib_questions'), A=load('lib_answers'), J=load('lib_judge'), C=load('lib_checks');
const s=new Rec('settings',{id:'srsettings00001',status:'preparing',cohort:'SR008',review:{summary:'Old application feedback',top_fixes:['Old fix'],overclaims:[],inconsistencies:[]},review_state:'done',review_at:'2026-10-31T00:00:00Z'});app.save(s);
const oldJudge={restated:'Old explanation',clear:false,strength:1,issues:[{type:'grammar',label:'Spelling or grammar',quote:'old phrase',fix:'Fix it'}],missing:[],shorter:''};
for(const [key,value] of [['s_name','Example'],['s_oneliner','Old pitch'],['s_desc','Old description']])app.save(new Rec('answers',{key,value,origin:'person',confirmed:true,judge:Q.definition(key).judge?oldJudge:null,judge_state:Q.definition(key).judge?'done':'none',judged_hash:U.hash(value)}));
s.set('review_hash',J.snapshotHash(app));
const ctx={app,isAgent:false};
const row=key=>app.findFirstRecordByFilter('answers','key = {:key}',{key});
A.set(ctx,{key:'s_oneliner',value:'New pitch'});
assert.equal(row('s_oneliner').getString('judge_state'),'done');assert.equal(J.judgeBatch(app),0);assert.equal(J.reviewApp(app),false);assert.equal(calls,0);
assert.equal(A.get(ctx,{key:'s_oneliner'}).judge.restated,'Old explanation');assert.equal(A.get(ctx,{key:'s_oneliner'}).judge_current,false);assert.equal(J.progress(app).stale,true);assert.equal(C.facts(app).review.summary,'Old application feedback');
const requested=A.recheck(ctx,{});assert.equal(requested.queued,2);assert.equal(J.progress(app).active,true);assert.equal(A.get(ctx,{key:'s_oneliner'}).judge.restated,'Old explanation');assert.equal(C.facts(app).review.summary,'Old application feedback');
assert.equal(A.recheck(ctx,{}).already_running,true);assert.equal(JSON.parse(s.getString('review_request')).id,requested.request);
A.set(ctx,{key:'s_oneliner',value:'Edited after click'});
onLLM=prompt=>{if(prompt.includes('Review each answer below')){assert.match(prompt,/ANSWER:\nNew pitch/);assert.doesNotMatch(prompt,/Edited after click/);A.set(ctx,{key:'s_oneliner',value:'Edited while reviewing'});}};
assert.equal(J.judgeBatch(app),2);assert.equal(row('s_oneliner').getString('value'),'Edited while reviewing');assert.equal(row('s_oneliner').getString('judge_state'),'done');assert.equal(row('s_oneliner').getString('judged_hash'),U.hash('New pitch'));assert.equal(A.get(ctx,{key:'s_oneliner'}).judge_current,false);onLLM=()=>{};
assert.equal(J.reviewApp(app),true);assert.equal(J.progress(app).active,false);assert.equal(J.progress(app).stale,true);assert.equal(calls,2);assert.equal(J.reviewApp(app),false);assert.equal(J.judgeBatch(app),0);assert.equal(calls,2);
// Repeated saves and founder edits do not authorize new LLM calls.
A.set(ctx,{key:'s_oneliner',value:'Another change'});assert.equal(J.judgeBatch(app),0);assert.equal(J.reviewApp(app),false);assert.equal(calls,2);
// Failure preserves old field and whole-application feedback, with no retry until clicked.
A.recheck(ctx,{});offline=true;J.judgeBatch(app);J.reviewApp(app);const n=calls;assert.equal(J.progress(app).failed,true);assert.equal(J.progress(app).active,false);assert.equal(C.facts(app).review.summary,'New application feedback');assert.equal(A.get(ctx,{key:'s_oneliner'}).judge.restated,'Reviewed saved text');assert.equal(J.judgeBatch(app),0);assert.equal(J.reviewApp(app),false);assert.equal(calls,n);
// Clearing a field also keeps prior feedback intact.
A.set(ctx,{key:'s_oneliner',value:''});assert.equal(A.get(ctx,{key:'s_oneliner'}).judge.restated,'Reviewed saved text');
console.log('PASS: no review from saving; retained field/application feedback; stale markers; explicit snapshot request; duplicate guard; edits during review do not requeue; failure retains feedback and never retries automatically; clearing retains feedback.');
