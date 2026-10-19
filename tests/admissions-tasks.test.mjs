import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import { resolve, extname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { test } from "node:test";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const data = source => ({url:`data:text/javascript,${encodeURIComponent(source)}`,shortCircuit:true});
globalThis.__admissionsEnv = {};
registerHooks({resolve(specifier,context,next){
  if(specifier==="cloudflare:workers")return data("export const env=globalThis.__admissionsEnv;");
  if(specifier==="next/headers")return data("export async function headers(){return new Headers();}");
  if(specifier==="next/navigation")return data("export function redirect(){throw new Error('redirect');}");
  if(specifier.startsWith("@/"))return{url:pathToFileURL(resolve(root,specifier.slice(2)+".ts")).href,shortCircuit:true};
  return next(specifier.startsWith(".")&&!extname(specifier)&&context.parentURL?.endsWith(".ts")?specifier+".ts":specifier,context);
}});
const {StudioStore}=await import("../lib/studio-store.ts");
const {ADMISSIONS_SOURCE_URL,admissionsTaskOf,admissionsSourceAvailability,admissionsPackageId}=await import("../lib/admissions-tasks.ts");
const {packageProgress,nextIncompleteInDomain}=await import("../lib/task-progress.ts");
const {workContext,workSummary}=await import("../lib/work-connection.ts");
const {POST}=await import("../app/api/system/admissions-tasks/route.ts");
class MemoryD1{
  constructor(){this.db=new DatabaseSync(":memory:");this.db.exec("CREATE TABLE documents(id TEXT PRIMARY KEY,body TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE events(id TEXT PRIMARY KEY,package_id TEXT,kind TEXT NOT NULL,raw_text TEXT NOT NULL,base_revision INTEGER NOT NULL,created_at TEXT NOT NULL,result TEXT NOT NULL);");}
  prepare(sql){const owner=this;return{sql,values:[],bind(...values){return{...this,values};},async first(){return owner.db.prepare(this.sql).get(...this.values)??null;},async all(){return{results:owner.db.prepare(this.sql).all(...this.values)};},async run(){return{meta:{changes:Number(owner.db.prepare(this.sql).run(...this.values).changes)}};}};}
  async batch(statements){this.db.exec("BEGIN");try{const results=statements.map(s=>({meta:{changes:Number(this.db.prepare(s.sql).run(...s.values).changes)}}));this.db.exec("COMMIT");return results;}catch(error){this.db.exec("ROLLBACK");throw error;}}
}
function source(id,overrides={}){return{id,title:`真实来源事项 ${id}`,status:"Not Started",category:"Application",priority:"P0",next_action:"使用已经准备的真实材料继续原对话",internal_due_date:"2026-10-20",source_modified_at:null,source_url:ADMISSIONS_SOURCE_URL,domain:"admissions",...overrides};}
function guided(id,project_key,task_record_id){return{id,revision:1,content:{package_id:id,revision:1,kind:"guided_work",domain:"research",project_key,title:`已有科研 ${id}`,description:"已有内容",deliverable:"真实成果",working_question:"已有问题",estimated_user_minutes:10,fields:[],guide_steps:[{id:"start",title:"旧步骤",body:"旧内容"}],sources:[{id:"existing",document_title:"已核来源"}],source_refs:["existing"],...(task_record_id?{task_record_id}:{})},facts:[]};}
function seed(tasks=[source("recExample010"),source("recExample013",{status:"Waiting"}),source("recExample009",{status:"Done"}),source("recExample008",{category:"Research",domain:"research"}),source("recvvuCT16DIXF",{category:"External RA"}),source("reczz28NjjzFafWJ",{category:"External RA"}),source("recExample007",{category:"External RA"})]){
  const field={id:"school",question:"学校名称",candidate:"Example University",source_refs:["existing"]};
  return{schema_version:1,current_package_id:"material",paused:true,mode:"gentle",packages:[{id:"material",revision:1,content:{revision:1,title:"教育背景局部素材",task_record_id:"recExample010",fields:[field],confirm_phrase:"确认",source_refs:["existing"]},facts:[{id:field.id,status:"confirmed",confirmed_by:"owner:already-confirmed",content:structuredClone(field)}]},guided("motion","sample-research"),guided("research_topic","research_topic"),guided("direct","another-project","recExample007")],source_context:{last_synced_at:"2026-01-01T00:00:00Z",observed_at:"2026-01-01T00:00:00Z",tasks},cinema:{earned_cards:[{event_id:"old-card",card_id:"retained-history"}]},plan:{date:"2026-10-19",items:[]}};
}
async function setup(tasks){const db=new MemoryD1(),store=new StudioStore(db);await store.importDocument(seed(tasks));return{db,store};}
const registration=(revision=1,event_id="register-source")=>({event_id,expected_revision:revision});
const update=(tasks,observed_at="2026-01-02T00:00:00Z",event_id="source-fresh")=>({event_id,observed_at,source_context:{last_synced_at:observed_at,tasks}});
const conversation={surface:"codex",thread_id:"real-existing-test",title:"已有工作对话",url:"codex://threads/real-existing-test"};
function report(package_id,overrides={}){return{event_id:"actual-progress",package_id,expected_execution_revision:0,expected_content_revision:1,status:"in_progress",summary:"已经在原对话准备好实际文书段落",next_action:"审阅这一段的真实项目证据",evidence:[{kind:"file",title:"实际文书草稿",locator:"/workspace/examples/work/draft.md",observed_at:"2026-01-01T00:00:00Z",quote:"草稿中已形成可审阅的论点段落"}],conversation,...overrides};}

test("stored source backfill creates only unfinished lightweight parent references and deduplicates real research mappings",async()=>{
  const {store}=await setup();const before=await store.snapshot();const result=await store.registerAdmissionsTasks(registration());
  assert.equal(result.event.result.outcome,"admissions_tasks_registered");
  assert.deepEqual(result.event.result.admissions.registered_package_ids,[admissionsPackageId("recExample010"),admissionsPackageId("recExample013")]);
  assert.deepEqual(result.event.result.admissions.represented_record_ids,["recvvuCT16DIXF","reczz28NjjzFafWJ","recExample007"]);
  const parent=result.doc.packages.find(p=>p.id===admissionsPackageId("recExample010"));
  assert.deepEqual(Object.keys(parent).sort(),["admissions_task","content","facts","id","revision"]);
  assert.equal(parent.content.kind,"admissions_work");assert.deepEqual(parent.facts,[]);assert.deepEqual(parent.content.fields,[]);assert.equal(parent.work,undefined);assert.equal(parent.content.guide_steps,undefined);assert.equal(parent.content.estimated_user_minutes,undefined);
  assert.equal(result.doc.packages[0].supports_task_record_id,"recExample010");
  const preserved=structuredClone(result.doc.packages[0]);delete preserved.supports_task_record_id;assert.deepEqual(preserved,before.doc.packages[0]);
  for(let i=1;i<4;i++)assert.deepEqual(result.doc.packages[i],before.doc.packages[i]);
  assert.equal(result.doc.current_package_id,before.doc.current_package_id);assert.equal(result.doc.paused,true);assert.deepEqual(result.doc.plan,before.doc.plan);assert.deepEqual(result.doc.cinema,before.doc.cinema);
  assert.equal(packageProgress(parent).complete,false);assert.equal(packageProgress(result.doc.packages[0]).complete,true);
  assert.equal((await store.registerAdmissionsTasks(registration())).idempotent,true);
  const again=await store.registerAdmissionsTasks(registration(result.revision,"backfill-again"));assert.equal(again.doc.packages.length,result.doc.packages.length);assert.equal(admissionsTaskOf(again.doc.packages.at(-2)).source_revision,1);
});

test("source refresh updates metadata, adds new work, preserves execution, binding, old confirmations and cards",async()=>{
  const {store}=await setup([source("recExample010")]);await store.registerAdmissionsTasks(registration());const id=admissionsPackageId("recExample010");
  await store.bindWorkConversation({event_id:"existing-binding",package_id:id,expected_binding_revision:0,conversation});
  const progressed=await store.recordExecution(report(id));const old=progressed.doc.packages.find(p=>p.id===id);
  const tasks=[source("recExample010",{title:"来源更新后的实际标题",next_action:"处理新的真实下一步",status:"Waiting",source_modified_at:12345}),source("recExample012")];
  const refreshed=await store.updateSource(update(tasks));const next=refreshed.doc.packages.find(p=>p.id===id);
  assert.equal(admissionsTaskOf(next).title,tasks[0].title);assert.equal(admissionsTaskOf(next).next_action,tasks[0].next_action);assert.equal(admissionsTaskOf(next).source_revision,2);
  assert.deepEqual(next.content,old.content);assert.deepEqual(next.execution,old.execution);assert.deepEqual(next.conversation_binding,old.conversation_binding);assert.equal(packageProgress(next).status,"in_progress");
  assert.deepEqual(next.admissions_source_history,[old.admissions_task]);assert.deepEqual(refreshed.doc.packages[0],progressed.doc.packages[0]);assert.deepEqual(refreshed.doc.cinema,progressed.doc.cinema);assert.equal(refreshed.doc.current_package_id,progressed.doc.current_package_id);
  assert.ok(refreshed.doc.packages.some(p=>p.id===admissionsPackageId("recExample012")));
  const freshAgain=await store.updateSource(update(tasks,"2026-01-03T00:00:00Z","fresh-same-source"));assert.equal(admissionsTaskOf(freshAgain.doc.packages.find(p=>p.id===id)).source_revision,2);
  const context=await workContext(store,id);assert.deepEqual(context.objective,[tasks[0].title,tasks[0].next_action]);assert.equal(context.sources[0].url,ADMISSIONS_SOURCE_URL);assert.equal(context.material,null);assert.equal(context.due.kind,"source_plan");assert.equal(workSummary(next).title,tasks[0].title);
});

test("source Waiting, Done and disappearance remain source claims and never manufacture owner completion",async()=>{
  const {store}=await setup([source("recExample013",{status:"Waiting"})]);const initial=await store.registerAdmissionsTasks(registration());const id=admissionsPackageId("recExample013");
  assert.equal(packageProgress(initial.doc.packages.at(-1)).status,"waiting");assert.equal(packageProgress(initial.doc.packages.at(-1)).complete,false);
  const done=await store.updateSource(update([source("recExample013",{status:"Done"})]));const pkg=done.doc.packages.find(p=>p.id===id);
  assert.equal(admissionsSourceAvailability(admissionsTaskOf(pkg)),"source_done");assert.equal(packageProgress(pkg).complete,false);assert.match(packageProgress(pkg).label,/飞书已完成/);assert.equal(pkg.execution,undefined);assert.equal(pkg.task_completion,undefined);
  const missing=await store.updateSource(update([],"2026-01-03T00:00:00Z","missing-source"));const absent=missing.doc.packages.find(p=>p.id===id);assert.equal(admissionsSourceAvailability(admissionsTaskOf(absent)),"source_missing");assert.ok(absent.admissions_source_history.length>=2);
  const restored=await store.updateSource(update([source("recExample013")],"2026-01-04T00:00:00Z","source-returned"));assert.equal(restored.doc.packages.filter(p=>p.id===id).length,1);assert.equal(admissionsSourceAvailability(admissionsTaskOf(restored.doc.packages.find(p=>p.id===id))),"actionable");
});

test("concurrent source refresh and genuine execution retain both changes and one stable source identity",async()=>{
  const {store}=await setup([source("recExample010")]);await store.registerAdmissionsTasks(registration());const id=admissionsPackageId("recExample010");
  await Promise.all([store.updateSource(update([source("recExample010",{next_action:"来源侧更新的真实下一步"}),source("recExample012")])),store.recordExecution(report(id))]);
  const snapshot=await store.snapshot(),pkg=snapshot.doc.packages.find(p=>p.id===id);
  assert.equal(snapshot.doc.packages.filter(p=>p.id===id).length,1);assert.equal(pkg.execution.summary,report(id).summary);assert.equal(admissionsTaskOf(pkg).next_action,"来源侧更新的真实下一步");assert.equal(pkg.execution.revision,1);
});

test("source refresh and registration reject malformed, conflicting or untrusted inputs atomically",async()=>{
  const {store}=await setup([source("recExample010")]);const before=await store.snapshot();
  await assert.rejects(store.registerAdmissionsTasks({...registration(),tasks:[source("recExample006")]}),/invalid_admissions_registration/);
  await assert.rejects(store.registerAdmissionsTasks(registration(99)),/revision_conflict/);
  for(const tasks of [[source("recExample005"),source("recExample005")],[source("recExample004",{source_url:"https://attacker.example/base/anything"})],[source("recExample003",{status:"Completed"})],[source("recExample001",{internal_due_date:"2026-02-30"})],[source("recExample002",{domain:"research"})],Array.from({length:501},(_,i)=>source(`recLimit${i}`))])await assert.rejects(store.updateSource(update(tasks)),/admissions_source/);
  assert.deepEqual((await store.snapshot()).doc,before.doc);
  const injected=source("recExample010",{execution:{status:"completed"},work:{status:"session_complete"},task_completion:{status:"completed"},confirmed_by:"source"});
  const safe=await store.updateSource(update([injected]));const parent=safe.doc.packages.at(-1);assert.equal(parent.execution,undefined);assert.equal(parent.work,undefined);assert.equal(parent.task_completion,undefined);assert.equal(parent.admissions_task.execution,undefined);
  await assert.rejects(store.updateSource(update([injected],"2025-12-31T00:00:00Z","older-snapshot")),/not_newer/);
});

test("only actual evidence-backed execution completes parent; legacy form writes cannot mutate source references",async()=>{
  const {store}=await setup([source("recExample010")]);const registered=await store.registerAdmissionsTasks(registration());const id=admissionsPackageId("recExample010");
  const active=await store.apply({event_id:"activate-parent",expected_revision:registered.revision,package_id:id,kind:"activate"},"owner");
  await assert.rejects(store.apply({event_id:"old-form",expected_revision:active.revision,package_id:id,kind:"reply",text:"任意原话"},"owner"),/admissions_work_managed_in_execution/);
  const completed=await store.recordExecution(report(id,{event_id:"actual-completed",status:"completed",next_action:null,completion_basis:{kind:"verified_result",detail:"原对话报告的实际文书成果",evidence_indices:[0]}}));
  const pkg=completed.doc.packages.find(p=>p.id===id);assert.equal(packageProgress(pkg).complete,true);assert.equal(admissionsTaskOf(pkg).source_status,"Not Started");assert.deepEqual(completed.doc.cinema,registered.doc.cinema);
  await assert.rejects(store.importDocument({...seed(),packages:[{...pkg,execution:undefined,task_completion:{status:"completed"}}],current_package_id:id}),/invalid_admissions_reference|new_work_cannot_contain_user_progress/);
});

test("admissions next item prioritizes actionable parents and keeps source completion out without changing other domains",async()=>{
  const {store}=await setup([source("recExample013",{status:"Waiting"}),source("recExample010"),source("recExample011")]);const result=await store.registerAdmissionsTasks(registration());
  const waiting=result.doc.packages.find(p=>p.id===admissionsPackageId("recExample013")),first=result.doc.packages.find(p=>p.id===admissionsPackageId("recExample010")),later=result.doc.packages.find(p=>p.id===admissionsPackageId("recExample011"));
  const child={...result.doc.packages[0],facts:result.doc.packages[0].facts.map(f=>({...f,status:"pending"}))};
  const current={id:"current",content:{domain:"admissions"},facts:[]};
  assert.equal(nextIncompleteInDomain([current,child,waiting,first,later],current.id).id,first.id);
  const done={...first,admissions_task:{...first.admissions_task,source_status:"Done"}};
  assert.equal(nextIncompleteInDomain([current,done,child,waiting,later],current.id).id,later.id);
  assert.equal(nextIncompleteInDomain([current,child,waiting],current.id).id,child.id);
  assert.equal(nextIncompleteInDomain([current,waiting],current.id),null);
  assert.equal(nextIncompleteInDomain([current,child],current.id).id,child.id);
  assert.equal(nextIncompleteInDomain([current,done],current.id),null);
  const a=guided("a","demo_project"),b=guided("b","other");assert.equal(nextIncompleteInDomain([a,b],a.id).id,"b");
});

test("registration route is private service-only, bounded and accepts only existing-source registration",async()=>{
  const {db}=await setup([source("recExample010")]);globalThis.__admissionsEnv.DB=db;
  const request=(headers={},body=registration())=>new Request("https://owner.example/api/system/admissions-tasks",{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(body)});
  assert.equal((await POST(request({Origin:"https://owner.example"}))).status,403);
  assert.equal((await POST(request({"Sec-Fetch-Site":"same-origin"}))).status,403);
  assert.equal((await POST(request({}, {...registration(),document:{}}))).status,400);
  assert.equal((await POST(request({}, {...registration(),extra:"x".repeat(5000)}))).status,413);
  const accepted=await POST(request());assert.equal(accepted.status,200);assert.match(accepted.headers.get("Cache-Control"),/private, no-store/);assert.equal((await accepted.json()).event.result.outcome,"admissions_tasks_registered");
});
