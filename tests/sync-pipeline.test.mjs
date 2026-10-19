import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {registerHooks} from 'node:module';
import {extname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const data=source=>({url:`data:text/javascript,${encodeURIComponent(source)}`,shortCircuit:true});
globalThis.__syncEnv={};globalThis.__syncHeaders=new Headers();
registerHooks({resolve(s,c,n){if(s==='cloudflare:workers')return data('export const env=globalThis.__syncEnv;');if(s==='next/headers')return data('export async function headers(){return globalThis.__syncHeaders;}');if(s==='next/navigation')return data('export function redirect(){throw Error("redirect");}');if(s.startsWith('@/'))return{url:pathToFileURL(resolve(s.slice(2)+'.ts')).href,shortCircuit:true};return n(s.startsWith('.')&&!extname(s)&&c.parentURL?.endsWith('.ts')?s+'.ts':s,c);}});
const {StudioStore}=await import('../lib/studio-store.ts');
const {GET}=await import('../app/api/studio/route.ts');
const {runWorkTool}=await import('../lib/work-connection.ts');
const {packageProgress,academicTaskOf}=await import('../lib/task-progress.ts');
const {executionOf}=await import('../lib/execution-state.ts');
class D1{
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec('CREATE TABLE documents(id TEXT PRIMARY KEY,body TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE events(id TEXT PRIMARY KEY,package_id TEXT,kind TEXT NOT NULL,raw_text TEXT NOT NULL,base_revision INTEGER NOT NULL,created_at TEXT NOT NULL,result TEXT NOT NULL);');}
 prepare(sql){const db=this;return{sql,values:[],bind(...values){return{...this,values};},async first(){return db.db.prepare(sql).get(...this.values)??null;},async all(){return{results:db.db.prepare(sql).all(...this.values)};},async run(){return{meta:{changes:Number(db.db.prepare(sql).run(...this.values).changes)}};}};}
 async batch(statements){this.db.exec('BEGIN');try{const result=statements.map(s=>({meta:{changes:Number(this.db.prepare(s.sql).run(...s.values).changes)}}));this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
const at='2026-10-19T00:00:00Z',portal='https://courses.example.edu/user/index';
async function setup(){const db=new D1(),store=new StudioStore(db);await store.importDocument({schema_version:1,current_package_id:'material',paused:false,mode:'gentle',packages:[{id:'material',revision:1,content:{domain:'admissions',title:'保留素材',revision:1,fields:[{id:'name',candidate:'本人素材'}]},facts:[{id:'name',status:'confirmed',content:{id:'name',candidate:'本人素材'}}]}],plan:{date:'2026-10-19',items:[]},cinema:{earned_cards:[]}});return{db,store};}
const homework=(id='123',extra={})=>({id:`lms:100001:${id}`,platform_id:id,course_id:'100001',course_name:'物联网',title:'实验 '+id,activity_type:'homework',source:'lms',source_url:portal,identity_verified:true,submission_state:'unknown',deadline_status:'exact_timestamp',deadline_iso:'2026-10-21T16:00:00Z',...extra});
const plan=(revision,items,time=at,event='lms-initial',status='synced')=>({event_id:event,expected_revision:revision,packages:[],plan:{date:'2026-10-19',items:[]},source_updates:{academics:{status,checked_at:time,last_success_at:time,items,provenance:{kind:'lms',authenticated_read:true,read_status:'success',source_url:portal}}}});
const report=(id,status='in_progress')=>({event_id:'checkpoint-'+status,package_id:id,expected_content_revision:1,expected_execution_revision:0,expected_source_revision:1,status,summary:'实际留下的作业结果',next_action:status==='submitted'?null:'继续实际工作',evidence:[{kind:'file',title:'实际结果',locator:'/workspace/examples/report.md',observed_at:at,quote:'可核查的实际结果'}],...(status==='submitted'?{completion_basis:{kind:'verified_result',detail:'实际结果与回执',evidence_indices:[0]},evidence:[{kind:'file',title:'实际报告',locator:'/workspace/examples/report.md',observed_at:at,quote:'实际交付内容'},{kind:'submission_receipt',title:'学校回执',locator:'https://courses.example.edu/receipt/123',observed_at:at,quote:'提交成功'}]}:{})});

test('conditional browser reads require identity and include ledger-only conflicts in their validator',async()=>{
 const {db,store}=await setup();globalThis.__syncEnv.DB=db;globalThis.__syncHeaders=new Headers({'oai-authenticated-user-id':'owner-test','oai-authenticated-user-email':'owner@example.test'});
 const request=tag=>new Request('https://desk.example/api/studio',{headers:tag?{'If-None-Match':tag}:{}});
 const first=await GET(request());assert.equal(first.status,200);const tag=first.headers.get('ETag');assert(tag);assert.match(first.headers.get('Server-Timing'),/db;dur=/);assert.equal(first.headers.get('X-Workspace-Owner'),'owner-test');
 const before=await store.snapshot(),same=await GET(request(tag));assert.equal(same.status,304);assert.equal(await same.text(),'');
 db.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run('stale-reply','material','conflict:reply','尚未核对的本人修正',before.revision,at,JSON.stringify({outcome:'reply_pending_review'}));
 const changed=await GET(request(tag));assert.equal(changed.status,200);assert.notEqual(changed.headers.get('ETag'),tag);const body=await changed.json();assert.equal(body.revision,before.revision);assert.equal(body.doc.packages[0].pending_review,true);
 globalThis.__syncHeaders=new Headers();assert.equal((await GET(request(changed.headers.get('ETag')))).status,401);
});

test('LMS new assignments, deadline changes and repeated reads preserve actual submission, binding and material',async()=>{
 const {store}=await setup(),before=await store.snapshot();const first=await store.updateWorkplan(plan(before.revision,[homework()]));const id=first.event.result.lms.registered_package_ids[0];assert(id);assert.equal(first.doc.packages.length,2);
 await store.bindWorkConversation({event_id:'bound-course',package_id:id,expected_binding_revision:0,conversation:{surface:'codex',thread_id:'real-course-thread',title:'原课程对话',url:'codex://threads/real-course-thread'}});
 const submitted=await store.recordExecution(report(id,'submitted'));assert.equal(packageProgress(submitted.doc.packages[1]).complete,true);
 const updated=await store.updateWorkplan(plan(submitted.revision,[homework('123',{deadline_iso:'2026-10-28T16:00:00Z'}),homework('456')],'2026-10-19T01:00:00Z','new-assignment'));
 assert.equal(updated.doc.packages.length,3);assert.equal(updated.doc.packages[1].id,id);assert.equal(updated.doc.packages[1].academic_task.due.at,'2026-10-28T16:00:00Z');assert.equal(packageProgress(updated.doc.packages[1]).complete,true);
 assert.deepEqual(updated.doc.packages[1].execution,submitted.doc.packages[1].execution);assert.deepEqual(updated.doc.packages[1].conversation_binding,submitted.doc.packages[1].conversation_binding);assert.deepEqual(updated.doc.packages[0],before.doc.packages[0]);assert.equal(updated.doc.current_package_id,before.doc.current_package_id);assert.deepEqual(updated.doc.cinema,before.doc.cinema);
 const again=await store.updateWorkplan(plan(updated.revision,[homework('123',{deadline_iso:'2026-10-28T16:00:00Z'}),homework('456')],'2026-10-19T02:00:00Z','same-homework'));
 assert.equal(again.doc.packages.length,3);assert.equal(again.doc.packages[1].academic_task.source_revision,2);assert.equal(again.event.result.lms.registered_package_ids.length,0);
 const absent=await store.updateWorkplan(plan(again.revision,[],'2026-10-19T03:00:00Z','missing-todos'));assert.equal(absent.doc.packages.length,3);assert.equal(packageProgress(absent.doc.packages[2]).complete,false);
});

test('changed assignment requirements keep earlier evidence and require review, while stale source writes are rejected',async()=>{
 const {store}=await setup();let snap=await store.updateWorkplan(plan(1,[homework()]));const id=snap.doc.packages[1].id;snap=await store.recordExecution(report(id));
 const prior=academicTaskOf(snap.doc.packages[1]),{source_revision,sourced_at,...task}=prior;
 const {expected_source_revision,...missingVersion}=report(id);await assert.rejects(store.recordExecution({...missingVersion,event_id:'missing-source-version',expected_execution_revision:1}),/execution_source_revision_required/);
 const updated=await store.updateAcademicTasks({event_id:'changed-goal',expected_revision:snap.revision,tasks:[{package_id:id,expected_source_revision:source_revision,task:{...task,deliverables:['新增的另一份实际交付要求']}}]});
 assert.equal(executionOf(updated.doc.packages[1]),null);assert.equal(packageProgress(updated.doc.packages[1]).status,'pending_review');assert.equal(updated.doc.packages[1].execution.summary,report(id).summary);
 await assert.rejects(store.recordExecution({...report(id),event_id:'old-source',expected_execution_revision:1}),/execution_source_revision_conflict/);
});

test('unverified platform items and source failures never add or complete assignments',async()=>{
 const {store}=await setup();const first=await store.updateWorkplan(plan(1,[homework('1',{identity_verified:false}),homework('2',{activity_type:'discussion'})]));assert.equal(first.doc.packages.length,1);
 const failed=await store.updateWorkplan(plan(first.revision,[homework('3')],'2026-10-19T01:00:00Z','lms-failed','error'));assert.equal(failed.doc.packages.length,1);
 const before=await store.snapshot();await assert.rejects(store.updateWorkplan(plan(before.revision,[homework('1',{id:'wrong-identity'})],'2026-10-19T02:00:00Z','bad-identity')),/invalid_lms_task/);assert.deepEqual((await store.snapshot()).doc,before.doc);
});

test('research and collaboration can register a sourced task without fake progress or duplicate source tasks',async()=>{
 const {store}=await setup(),before=await store.snapshot();const input={event_id:'new-research',expected_revision:before.revision,domain:'research',source_key:'conversation:real-message-123',title:'新的实际研究工作',deliverable:'一份可审阅的研究结果',next_action:'从已有真实文件开始',owner_quote:'请推进这项实际研究工作',source:{kind:'owner_statement',title:'本人明确提出的实际工作',locator:'original-conversation:real-message-123',quote:'请推进这项实际研究工作',observed_at:at}};
 const created=await runWorkTool(store,'register_work_item',input),id=created.work.package_id;assert.equal(created.event.result.created,true);assert.equal(created.work.execution,null);assert.equal(created.work.material,null);assert.equal(created.work.progress.complete,false);assert.equal(created.work.registration.source_key,input.source_key);
 const replay=await runWorkTool(store,'register_work_item',input);assert.equal(replay.idempotent,true);assert.equal(replay.work.package_id,id);
 const again=await runWorkTool(store,'register_work_item',{...input,event_id:'same-source-again',expected_revision:(await store.snapshot()).revision,title:'不覆盖原工作标题'});assert.equal(again.work.package_id,id);assert.equal(again.event.result.created,false);assert.equal(again.work.title,input.title);
 await assert.rejects(store.registerWorkItem({...input,event_id:'fake-complete',expected_revision:(await store.snapshot()).revision,execution:{status:'completed'}}),/invalid_work_registration/);
 const collaboration=await runWorkTool(store,'register_work_item',{...input,event_id:'new-collaboration',domain:'collaboration',expected_revision:(await store.snapshot()).revision});assert.notEqual(collaboration.work.package_id,id);assert.equal(collaboration.work.domain,'collaboration');
 const after=await store.snapshot();assert.deepEqual(after.doc.packages[0],before.doc.packages[0]);assert.equal(after.doc.current_package_id,before.doc.current_package_id);assert.deepEqual(after.doc.cinema,before.doc.cinema);
});

test('startup copy is owner-scoped, expires, and gracefully handles blocked storage',async()=>{
 const {readWorkspaceCache,writeWorkspaceCache}=await import('../lib/workspace-cache.ts');
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const snapshot={revision:4},valid=v=>v?.revision===4,now=100000000;
 writeWorkspaceCache(storage,'owner-a',snapshot,'"v4"',now);
 assert.deepEqual(readWorkspaceCache(storage,'owner-a',valid,now),{snapshot,etag:'"v4"'});
 assert.equal(readWorkspaceCache(storage,'owner-b',valid,now),null);
 assert.equal(readWorkspaceCache(storage,'owner-a',valid,now+24*60*60*1000+1),null);
 assert.equal(readWorkspaceCache(storage,'owner-a',valid,now-300001),null);
 const [key,raw]=[...values.entries()][0];values.set(key.replace('owner-a','owner-b'),raw);assert.equal(readWorkspaceCache(storage,'owner-b',valid,now),null);
 const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('quota');},removeItem(){throw Error('blocked');}};
 assert.equal(readWorkspaceCache(blocked,'owner-a',valid,now),null);assert.doesNotThrow(()=>writeWorkspaceCache(blocked,'owner-a',snapshot,null,now));
});
