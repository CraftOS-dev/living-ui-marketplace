/** Explicitly requested destructive maintenance; never called at boot or by a trigger. */
const PHRASE = 'RESET AND LOAD DEMO';
// Children first. This whitelist deliberately excludes users, settings and system collections.
const TABLES = ['decisions','review_records','import_logs','reviews','response_items','reviews_received','ms_changes','ms_snapshots','ms_builds','ms_blocks','manuscripts','board_items','boards','node_anchors','relations','nodes','annotations','anchors','pages','files','note_files','notes','exp_log','exp_runs','exp_templates','experiments','tasks','repo_versions','repo_items','project_works','candidates','search_runs','searches','asks','proposals','field_marks','work_refs','work_tags','collection_items','works','collections','tags','import_batches','saved_views','oa_cache','projects','activity'];
function u() { return require(`${__hooks}/lib_util.js`); }
function guard(ctx) {
  if (ctx.isAgent && ctx.app.findRecordsByFilter('projects', 'confidentiality = "confidential"', '', 1, 0).length) throw u().fail(403, 'A confidential project exists. Only a person can reset this workspace in Settings.', 'confidential_project');
  if (ctx.app.findRecordsByFilter('ms_builds', 'status = "running"', '', 1, 0).length) throw u().fail(409, 'Wait for running manuscript PDF builds to finish before resetting.', 'build_running');
}
function canonical(value) {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).sort().map((key)=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
function snapshot(ctx) {
  guard(ctx);
  const counts = {}; const stamp = [];
  for (const table of TABLES) {
    const rows = [];
    for (let offset=0;;offset+=500) {
      const batch=ctx.app.findRecordsByFilter(table, '', 'id', 500, offset);
      for (const record of batch) rows.push(record.publicExport());
      if (batch.length<500) break;
    }
    counts[table] = rows.length;
    // Activity is included in the preview, but background logging alone must not invalidate it.
    if (table !== 'activity') stamp.push([table, rows]);
  }
  return {counts:counts, fingerprint:$security.sha256(canonical(JSON.parse(JSON.stringify(stamp))))};
}
function preview(ctx) {
  const state = snapshot(ctx);
  return { counts:state.counts, fingerprint:state.fingerprint, phrase:PHRASE,
    preserves:['Account and app settings','Connected integrations','Users','Database schema','App code'],
    projects:require(`${__hooks}/lib_demo_data.js`).map((s)=>({name:s.name, question:s.question, scope:s.scope})),
    note:'Permanently removes research records and their attachments. No optional backup is made. Platform deployment backups are managed separately. Synthetic sources are labeled and cannot be cited as real publications.'};
}
function reset(ctx, p) {
  if (p.phrase !== PHRASE || p.acknowledge !== true) throw u().fail(400, 'Type RESET AND LOAD DEMO exactly and acknowledge permanent deletion.', 'confirmation_required');
  if (!p.fingerprint) throw u().fail(400, 'Preview the reset first.', 'preview_required');
  let result;
  ctx.app.runInTransaction((tx)=>{
    const tctx = Object.assign({},ctx,{app:tx});
    const before = snapshot(tctx);
    if (p.fingerprint !== before.fingerprint) throw u().fail(409, 'Research data changed since the preview. Review a fresh preview before resetting.', 'stale_preview');
    for (const table of TABLES) {
      for (;;) {
        const records = tx.findRecordsByFilter(table, '', '', 100, 0);
        if (!records.length) break;
        for (const rec of records) {
          // Self-relation cascades can already have removed a child in this batch.
          const live = u().byId(tx, table, rec.id);
          if (live) tx.delete(live);
        }
      }
    }
    // The app's deletion hooks clean its FTS rows as each paper/file/note goes.
    const made = seed(tctx);
    require(`${__hooks}/lib_activity.js`).write(tx,ctx,{op:'demo.reset',label:'Reset research data and loaded four synthetic demo projects',target:'projects',data:{deleted:before.counts, projects:made.map((x)=>x.id)},undo:false});
    result={ok:true,deleted:before.counts,projects:made,synthetic:true,backup_created:false};
  });
  return result;
}
function add(app, table, values) {
  const rec = new Record(app.findCollectionByNameOrId(table));
  for (const k of Object.keys(values)) rec.set(k,values[k]);
  app.save(rec); return rec;
}
function day(offset) { const d=new Date(); d.setDate(d.getDate()+offset); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
function iso(offset) { const d=new Date(); d.setDate(d.getDate()+offset); return d.toISOString(); }
function wrap(text) { const words=String(text).replace(/[^\x20-\x7e]/g,' ').split(/\s+/); const out=[]; let line=''; for(const w of words) { if((line+' '+w).length>78) {out.push(line);line=w;} else line+=(line?' ':'')+w; } if(line)out.push(line); return out; }
/** Small valid ASCII PDF. The exact same lines feed the stored selectable text. */
function sourcePdf(lines) {
  const escaped=(s)=>s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const stream='BT /F1 11 Tf 50 750 Td 16 TL '+lines.map((s,i)=>(i?'T* ':'')+'('+escaped(s)+') Tj').join('\n')+' ET';
  const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream'];
  let pdf='%PDF-1.4\n'; const offsets=[0];
  for(let i=0;i<objs.length;i++){offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+objs[i]+'\nendobj\n';}
  const xref=pdf.length; pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map((n)=>('0000000000'+n).slice(-10)+' 00000 n \n').join('');
  return pdf+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
}
function seed(ctx) {
  const app=ctx.app; const scenarios=require(`${__hooks}/lib_demo_data.js`); const result=[];
  for(let i=0;i<scenarios.length;i++) result.push(seedProject(ctx,scenarios[i],i));
  return result;
}
module.exports={preview:preview,reset:reset};

function seedProject(ctx,s,index) {
  const app=ctx.app; const search=require(`${__hooks}/lib_search.js`);
  const project=add(app,'projects',{name:s.name,question:s.question,description:'SYNTHETIC DEMO DATA. Not real research. '+s.scope,color:s.color,confidentiality:'normal',state:'active',pinned:true,sort:index,repo_ready:true});
  const collection=add(app,'collections',{name:s.name,sort:index});
  const tag=add(app,'tags',{name:['demo-plasticity','demo-sleep','demo-materials','demo-field'][index],color_slot:index+1});
  const works=[]; const anchors=[];
  for(let j=0;j<5;j++) {
    const authors=[{literal:'Synthetic Research Team '+(index+1)}];
    const abstract='SYNTHETIC DEMO. '+s.findings[j]+' '+s.note+' '+s.limitation;
    const w=add(app,'works',{type:'report',title:'[DEMO] '+s.papers[j],authors:authors,year:2026-j,container:'Fictional demo working papers',abstract:abstract,citekey:'demo'+index+'source'+j,resolution:'not_found',resolved_via:'manual',resolve_error:'Synthetic demo source. No registry identifier; not citable as a real publication.',identity:'agent_proposed',identify:'none',integrity:'unchecked',read_state:j<2?'read':j===2?'reading':'unread',added_by:'agent',source:'manual',keywords:['synthetic','demo'],starred:j===0,extra:{synthetic_demo:true},edited:[]});
    works.push(w); search.indexWork(app,w);
    add(app,'project_works',{project:project.id,work:w.id,role:j<3?'core':'background',status:j<2?'read':j===2?'reading':'to_read',added_by:'agent',sort:j,note:'Synthetic source for demonstration only.'});
    add(app,'collection_items',{collection:collection.id,work:w.id}); add(app,'work_tags',{work:w.id,tag:tag.id});
    const lines=['SYNTHETIC DEMO - NOT A REAL PUBLICATION'].concat(wrap(s.papers[j]),['Fictional research team | Presentation fixture','No DOI, arXiv ID or real-world study claim.',''],wrap(s.findings[j]),[''],wrap(s.note),[''],wrap(s.limitation));
    const pdf=sourcePdf(lines); const filename='demo-'+(index+1)+'-'+(j+1)+'.pdf';
    const f=add(app,'files',{work:w.id,file:$filesystem.fileFromBytes(pdf,filename),name:filename,bytes:pdf.length,sha256:$security.sha256(pdf),pages:1,version:1,current:true,text_state:'ready',engine:'demo-exact-text',pages_with_text:1,source:'agent_path',added_by:'agent',outline:[],meta:{title:s.papers[j],subject:'SYNTHETIC DEMO'},pos_page:1,max_page:1});
    let text=''; const stored=[]; const items=[];
    for(let k=0;k<lines.length;k++) {const start=text.length;text+=lines[k]+'\n';stored.push([k+1,start,text.length-1,lines[k]]);items.push([lines[k],50,33+k*16,11,lines[k].length*5.3,0,1]);}
    const pg=add(app,'pages',{file:f.id,page_no:1,width:612,height:792,rotate:0,text:text,lines:stored,items:items,origin:'pdf_text',chars:text.length}); search.indexPage(app,pg,w.id);
    const start=text.indexOf(s.findings[j]);
    const a=add(app,'anchors',{work:w.id,file:f.id,page_no:1,start:start,end:start+s.findings[j].length,quote:text.slice(start,start+s.findings[j].length),kind:'text',actor:'agent',rects:[],area:{}}); anchors.push(a);
    add(app,'annotations',{anchor:a.id,work:w.id,file:f.id,kind:'highlight',color_slot:j%4+1,meaning:'Synthetic finding',comment:'Demo highlight: this passage is invented and explicitly labeled.',actor:'agent',page_no:1,start:start});
  }
  const nodes=[];
  nodes.push(add(app,'nodes',{project:project.id,kind:'question',title:s.question,body:'SYNTHETIC DEMO: central question for the presentation.',status:'agent_proposed',actor:'agent',sort:0,x:560,y:0,placed:true}));
  for(let j=0;j<4;j++) nodes.push(add(app,'nodes',{project:project.id,kind:'claim',title:s.claims[j],body:'SYNTHETIC DEMO hypothesis. '+s.limitation,claim_basis:'hypothesis',confidence:j===0?'medium':'low',status:'agent_proposed',actor:'agent',why:'Presentation fixture, not a validated research claim.',sort:j+1,x:j%2*400+80,y:190+Math.floor(j/2)*170,placed:true}));
  const evidence=add(app,'nodes',{project:project.id,kind:'evidence',title:'[DEMO] '+s.findings[0],body:'Passage from the synthetic source PDF, not real-world evidence.',status:'agent_proposed',actor:'agent',work:works[0].id,sort:5,x:80,y:560,placed:true}); nodes.push(evidence);
  add(app,'node_anchors',{node:evidence.id,anchor:anchors[0].id,sort:0});
  const edges=[[1,0,'informs'],[2,0,'informs'],[3,1,'opposes'],[4,1,'supports'],[5,1,'supports']];
  for(const edge of edges) add(app,'relations',{project:project.id,from_node:nodes[edge[0]].id,to_node:nodes[edge[1]].id,kind:edge[2],status:'agent_proposed',actor:'agent',reason:'Synthetic demo relation: inspect the source and limitations before accepting.'});
  const notes=[];
  for(let j=0;j<2;j++) {
    const blocks=j===0?[{type:'heading',level:1,text:'Demo scope and decisions'},{type:'paragraph',text:'SYNTHETIC DEMO DATA. '+s.note},{type:'quote',anchor:anchors[0].id},{type:'node',node:nodes[1].id},{type:'todo',text:'Check the key confound before accepting the claim',checked:false}]:[{type:'heading',level:1,text:'Synthetic pilot summary'},{type:'paragraph',text:'These invented values are presentation fixtures, not observations.'},{type:'table',rows:[['Condition',s.measure+' ('+s.unit+')'],[s.levels[0],String(s.values[0][0])],[s.levels[1],String(s.values[1][0])]],header:true,align:['left','right']},{type:'paragraph',text:s.limitation}];
    const n=add(app,'notes',{project:project.id,title:j===0?'[DEMO] Research decisions and caveats':'[DEMO] Pilot comparison table',kind:'project',blocks:blocks,text:blocks.map((b)=>b.text||'').join('\n'),pinned:j===0,actor:'agent',status:'agent_proposed'}); notes.push(n);search.indexNote(app,n);
  }
  const board=add(app,'boards',{project:project.id,name:'[DEMO] Evidence to next steps',sort:0,viewport:{x:0,y:0,zoom:0.7}});
  add(app,'board_items',{board:board.id,ref_kind:'section',text:'SYNTHETIC DEMO / QUESTION',color:s.color,x:20,y:20,w:330,h:120,z:0});
  for(let j=0;j<6;j++) add(app,'board_items',{board:board.id,ref_kind:'node',node:nodes[j].id,color:j===0?s.color:'plain',x:30+(j%3)*340,y:150+Math.floor(j/3)*210,w:300,h:170,z:j+1});
  add(app,'board_items',{board:board.id,ref_kind:'note',note:notes[0].id,color:'plain',x:30,y:600,w:300,h:170,z:7});
  add(app,'board_items',{board:board.id,ref_kind:'work',work:works[0].id,color:'plain',x:370,y:600,w:300,h:170,z:8});
  add(app,'board_items',{board:board.id,ref_kind:'text',text:'DEMO TALK TRACK\n1. Start with the question\n2. Inspect the exact passage\n3. Challenge the confound\n4. Open the pilot runs',color:'amber',x:710,y:600,w:300,h:190,z:9});
  const experiment=seedExperiment(app,project,s,index,nodes);
  const manuscript=seedManuscript(app,project,s,nodes,index);
  for(let j=0;j<6;j++) add(app,'tasks',{project:project.id,title:s.taskNames[j],notes:'SYNTHETIC DEMO task. '+(j===3?s.limitation:s.note),status:['done','doing','todo','waiting','todo','done'][j],priority:['medium','high','high','medium','low','medium'][j],due:day([-2,0,1,3,5,-1][j]),assignee:'person',labels:['demo',j<3?'analysis':'writing'],checklist:[{id:'brief',text:'Review scope and caveats',done:j===0||j===5},{id:'check',text:'Check the linked record',done:j===0||j===5}],links:[{kind:j===2?'experiment':j===4?'manuscript':j===5?'board':'node',id:j===2?experiment.id:j===4?manuscript.id:j===5?board.id:nodes[1].id}],recur:'none',sort:j,actor:'agent',done_at:j===0||j===5?iso(-1):''});
  seedRepository(app,project,s);
  if(index===1) seedScreening(app,project,s,works);
  return {id:project.id,name:s.name,papers:works.length,nodes:nodes.length,relations:edges.length,board:board.id,experiment:experiment.id,manuscript:manuscript.id};
}

function seedExperiment(app,project,s,index,nodes) {
  const variables=[{id:'condition',name:s.condition,role:'condition',type:'category',unit:'',levels:s.levels,options:s.levels},{id:'replicate',name:'Replicate',role:'constant',type:'number',value:'Four replicates per group'},{id:'measure',name:s.measure,role:'measure',type:'number',unit:s.unit}];
  const steps=[{id:'prepare',text:'Lock the synthetic protocol and comparison groups',minutes:10,done:true,done_at:iso(-2)},{id:'run',text:'Record individual synthetic replicates with their condition',minutes:20,done:true,done_at:iso(-1)},{id:'audit',text:'Audit confounds and compare group distributions',minutes:15,done:false,done_at:''}];
  const e=add(app,'experiments',{project:project.id,number:1,title:'[DEMO] '+s.experiment,kind:s.kind,status:['running','paused','done','running'][index],aim:'SYNTHETIC DEMO. '+s.question,hypothesis:s.hypothesis,variables:variables,steps:steps,materials:[{name:'Synthetic fixture dataset',detail:'Eight invented rows; no external measurements'},{name:'Analysis notebook',detail:'Group comparison and reproducibility checklist'}],links:[{kind:'node',id:nodes[1].id}],started_at:iso(-2),ended_at:index===2?iso(-1):'',summary:'SYNTHETIC DEMO. '+s.limitation,next_steps:'Repeat the comparison with appropriate real-world controls before interpreting an effect.',conclusion_by:'agent',outcome:index===2?'inconclusive':'',planned_start:day(-2),planned_end:day(2),pinned:true,tags:['demo','synthetic'],actor:'agent'});
  for(let g=0;g<2;g++) for(let k=0;k<4;k++) add(app,'exp_runs',{experiment:e.id,number:g*4+k+1,values:{condition:s.levels[g],measure:s.values[g][k]},status:'done',note:'SYNTHETIC DEMO replicate '+(k+1),recorded_at:iso(-1),actor:'agent'});
  for(const row of [['note','SYNTHETIC DEMO: protocol locked before recording fixture rows.'],['observation',s.findings[0]],['deviation','SYNTHETIC DEMO deviation: one quality-control check required a second review; original values remain visible.'],['result','SYNTHETIC DEMO: inspect the results chart and individual runs. '+s.limitation]]) add(app,'exp_log',{experiment:e.id,kind:row[0],text:row[1],at:iso(-1),actor:'agent',ref:{},edits:[]});
  return e;
}
function seedManuscript(app,project,s,nodes,index) {
  const m=add(app,'manuscripts',{project:project.id,title:'[DEMO] '+s.manuscript,style:'apa',template:'generic',status:'draft',sort:0,words:0,authors:[],preamble:''});
  const sections=[['abstract','SYNTHETIC DEMO MANUSCRIPT. '+s.question+' This document illustrates a research workflow with invented data. '+s.limitation],['h1','Introduction'],['paragraph',s.note],['h1','Methods'],['paragraph','SYNTHETIC DEMO: compare '+s.levels.join(' and ')+' with four fixture replicates per group. Keep individual run values and quality-control notes in the project repository. No real participants, materials or locations were used.'],['h1','Illustrative results'],['paragraph','SYNTHETIC DEMO RESULT. '+s.findings[0]+' '+s.findings[1]+' These values describe only the invented demonstration dataset.'],['h1','Limitations and next steps'],['paragraph',s.limitation+' '+s.claims[3]]];
  const blocks=[]; let words=0;
  for(let j=0;j<sections.length;j++){const text=sections[j][1];words+=text.split(/\s+/).length;blocks.push(add(app,'ms_blocks',{manuscript:m.id,sort:j+1,type:sections[j][0],content:[{t:'text',v:text}],text:text,origin:'agent_generated',agent_chars:text.length,typed_chars:0,pasted_chars:0,data:{}}));}
  m.set('words',words);app.save(m);
  add(app,'ms_changes',{manuscript:m.id,block:blocks[8].id,kind:'replace',before:{type:'paragraph',content:[{t:'text',v:sections[8][1]}],data:{}},after:{type:'paragraph',content:[{t:'text',v:'SYNTHETIC DEMO proposed clarification. '+s.limitation+' A real study would require preregistered controls, independent replication and an uncertainty analysis.'}],data:{}},base_updated:blocks[8].getString('updated'),status:'proposed',actor:'agent',why:'Demo tracked change: make the limits of synthetic results explicit.'});
  if(index===1){
    const comments=['Clarify how practice effects are separated from the retention interval.','Explain how missing diary entries would affect eligibility.','Show the prespecified exclusion reasons beside the PRISMA flow.','State explicitly that no synthetic result supports a clinical conclusion.'];
    const review=add(app,'reviews_received',{manuscript:m.id,label:'[DEMO] Fictional Reviewer 1',body:'SYNTHETIC DEMO REVIEW.\n'+comments.map((c,j)=>(j+1)+'. '+c).join('\n'),received_on:day(-1)});
    for(let j=0;j<comments.length;j++) add(app,'response_items',{manuscript:m.id,review:review.id,sort:j,comment:'[DEMO] '+comments[j],kind:j===0?'major':'minor',strategy:j===1?'experiment':'clarify',status:'open',response:'SYNTHETIC DEMO DRAFT RESPONSE: We will '+['expand the confound-control paragraph and separate practice from delay','report a sensitivity analysis for missing diary entries','align the flow diagram labels with the protocol reasons','add a prominent limitation statement'][j]+'. This response is not a real peer-review exchange.',change_note:'Proposed revision, not yet accepted.',actor:'agent',confirmed:false});
  }
  return m;
}
function seedRepository(app,project,s) {
  const folders={};
  for(const path of ['data','data/raw','data/processed','code','results','docs']) {const parts=path.split('/');const parent=parts.length>1?folders[parts[0]].id:'';folders[path]=add(app,'repo_items',{project:project.id,parent:parent,kind:'folder',name:parts[parts.length-1],actor:'agent'});}
  const csv=['synthetic,condition,replicate,'+s.measure+' ('+s.unit+')'];
  for(let g=0;g<2;g++) for(let k=0;k<4;k++) csv.push('true,'+s.levels[g]+','+(k+1)+','+s.values[g][k]);
  const files=[['','README.md','# '+s.name+'\n\nSYNTHETIC DEMO DATA. Nothing here is a real study result.\n\n## Question\n'+s.question+'\n\n## Presentation route\n'+s.scope+'\n\n## Reproduce\nOpen data/raw/synthetic_runs.csv and run code/summarize.py. Compare the run sheet with the Experiments Results tab.\n\n## Limits\n'+s.limitation+'\n\n## Provenance\nGenerated explicitly for a user-requested presentation demo. No real identifiers or personal data.\n'],['data/raw','synthetic_runs.csv',csv.join('\n')+'\n'],['code','summarize.py','# SYNTHETIC DEMO: run from the project repository root.\nimport csv\nfrom collections import defaultdict\nfrom statistics import mean, stdev\ngroups = defaultdict(list)\nwith open("data/raw/synthetic_runs.csv", newline="", encoding="utf-8") as f:\n    for row in csv.DictReader(f):\n        groups[row["condition"]].append(float(list(row.values())[-1]))\nfor name, values in groups.items():\n    print(name, "n=", len(values), "mean=", round(mean(values), 3), "sd=", round(stdev(values), 3))\n'],['docs','presentation-notes.md','# Synthetic demonstration talk track\n\n1. Open the project question and to-do board.\n2. Open a synthetic paper and select its labeled passage.\n3. Follow the passage into the claims map.\n4. Compare individual runs in Experiments.\n5. Inspect the manuscript tracked change without treating it as accepted.\n\n'+s.limitation+'\n']];
  for(const file of files){const content=file[2];add(app,'repo_items',{project:project.id,parent:file[0]?folders[file[0]].id:'',kind:'file',name:file[1],file:$filesystem.fileFromBytes(content,file[1]),bytes:unescape(encodeURIComponent(content)).length,version:1,actor:'agent'});}
}
function seedScreening(app,project,s,works) {
  const review=add(app,'reviews',{project:project.id,title:'[DEMO] Sleep and memory evidence screen',question:s.reviewQuestion,criteria:{include:['Synthetic comparative design','Defined recall delay','Explicit practice-effect control'],exclude:['No comparator','No recall outcome','Editorial only']},reasons:[{key:'design',label:'No comparator'},{key:'outcome',label:'No recall outcome'},{key:'format',label:'Editorial only'}],dual:true,blind:true,agent_seat:true,stage:'title_abstract',sort:0});
  const log=add(app,'import_logs',{review:review.id,source_db:'Synthetic demo fixture',query:'DEMO: sleep AND delayed recall AND practice effects',searched_on:day(-3),count:12,added:12,actor:'agent'});
  for(let j=0;j<12;j++){
    const abstract='SYNTHETIC DEMO ABSTRACT. This fictional comparison examines delayed recall with a defined retention interval. '+(j%3===0?'Practice effects were not controlled.':'A counterbalanced assessment controlled practice effects.')+' No real participants or findings are described.';
    add(app,'review_records',{review:review.id,work:j<5?works[j].id:'',import_log:log.id,title:'[DEMO] '+['Counterbalanced recall comparison','Practice-only training series','Circadian-matched retention pilot','Sleep diary sensitivity analysis','Delayed recall scoring comparison','Assessment-order crossover','Retention interval pilot','Editorial on recall measures','Matched-comparator learning study','Diary missingness audit','Multi-session recall protocol','Blinded scoring feasibility'][j],authors:[{literal:'Fictional Demo Group '+(j+1)}],year:2021+j%5,venue:'Synthetic demo records',abstract:abstract,source_db:'Synthetic demo fixture',ta:'pending',ft:'none',sort:j});
  }
}
