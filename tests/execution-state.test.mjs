import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { test } from "node:test";
registerHooks({resolve(specifier,context,next){return next(specifier.startsWith(".")&&!extname(specifier)&&context.parentURL?.endsWith(".ts")?specifier+".ts":specifier,context);}});
const {StudioStore}=await import("../lib/studio-store.ts");
const {parseExecutionUpdate,executionOf,validateWorkConversation}=await import("../lib/execution-state.ts");
class MemoryD1 {
  constructor(){this.db=new DatabaseSync(":memory:");this.db.exec("CREATE TABLE documents(id TEXT PRIMARY KEY,body TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE events(id TEXT PRIMARY KEY,package_id TEXT,kind TEXT NOT NULL,raw_text TEXT NOT NULL,base_revision INTEGER NOT NULL,created_at TEXT NOT NULL,result TEXT NOT NULL);");}
  prepare(sql){const owner=this;return{sql,values:[],bind(...values){return{...this,values};},async first(){return owner.db.prepare(this.sql).get(...this.values)??null;},async all(){return{results:owner.db.prepare(this.sql).all(...this.values)};},async run(){return{meta:{changes:Number(owner.db.prepare(this.sql).run(...this.values).changes)}};}};}
  async batch(statements){this.db.exec("BEGIN");try{const result=statements.map(s=>({meta:{changes:Number(this.db.prepare(s.sql).run(...s.values).changes)}}));this.db.exec("COMMIT");return result;}catch(error){this.db.exec("ROLLBACK");throw error;}}
}
const conversation={surface:"codex",thread_id:"test-original-work",title:"测试已有工作对话",url:"codex://threads/test-original-work"};
const evidence={kind:"file",title:"测试运行产物",locator:"/workspace/examples/work/result.json",observed_at:"2026-01-01T00:00:00Z",quote:"测试日志显示一个实际结果和其限制。"};
function guided(id,domain,project_key){return{id,revision:1,content:{package_id:id,revision:1,kind:"guided_work",domain,project_key,title:`测试工作 ${id}`,description:"仅测试用的旧工作内容",deliverable:"真实可审阅产物",working_question:"现有输入是什么",estimated_user_minutes:10,fields:[],guide_steps:[{id:"start",title:"原始步骤",body:"旧步骤内容"}],sources:[{id:"fixture",document_title:"测试来源"}],source_refs:["fixture"]},facts:[]};}
function seed(){const fields=[{id:"school",question:"学校名称",candidate:"Example University",source_refs:["source"]},{id:"start",question:"入学时间",candidate:"2023-09",source_refs:["source"]}];return{schema_version:1,current_package_id:"personal",paused:false,mode:"gentle",packages:[{id:"personal",revision:1,content:{revision:1,title:"教育背景候选",confirm_phrase:"确认",fields,source_refs:["source"]},facts:fields.map(field=>({id:field.id,status:"pending",confirmed_by:null,content:structuredClone(field)}))},guided("research","research","demo_project"),guided("edu","collaboration","collaboration-pm"),guided("course","academics","iot-resnet")],source_context:{observed_at:"2026-01-01T00:00:00Z"},cinema:{anchor_date:"2026-12-16"}};}
async function setup(){const db=new MemoryD1(),store=new StudioStore(db);await store.importDocument(seed());return{db,store};}
function report(overrides={}){return{event_id:"execution-report",package_id:"research",expected_execution_revision:0,expected_content_revision:1,status:"in_progress",summary:"测试：原对话留下了具体工作结果",next_action:"接着解决实际存在的下一步",evidence:[structuredClone(evidence)],conversation:structuredClone(conversation),...overrides};}
function review(overrides={}){return{event_id:"material-review",package_id:"personal",expected_content_revision:1,expected_package_revision:1,conversation:structuredClone(conversation),owner_quote:"我确认学校名称这一项准确，入学时间先不确认。",field_reviews:[{field_id:"school",expected_candidate:"Example University",decision:"confirmed"}],...overrides};}
function academic(revision,sourceRevision=0){return{event_id:`academic-source-${sourceRevision}`,expected_revision:revision,tasks:[{package_id:"course",expected_source_revision:sourceRevision,task:{id:"assignment-test",kind:"assignment",title:"真实课程实验",course_name:"测试课程",deliverables:["真实实验产物"],sources:[{id:"source",title:"平台要求",url:"https://courses.example.edu/course/1/learning-activity#/2"}],source_refs:["source"],due:{at:"2026-10-22T00:00:00+08:00",kind:"platform_deadline",source_id:"source"}}}]};}

test("execution validation requires next action, bounded evidence and explicit terminal-state provenance",()=>{
  assert.equal(parseExecutionUpdate(report()).status,"in_progress");
  for(const change of [v=>{v.status="done";},v=>{v.status="blocked";v.next_action=null;},v=>{v.next_action=" ";},v=>{v.evidence=[];},v=>{v.evidence[0].locator="relative.json";},v=>{v.evidence[0].observed_at="2026-01-01T00:00:00";},v=>{v.evidence[0].observed_at="2999-01-01T00:00:00Z";},v=>{v.evidence[0].kind="url";v.evidence[0].locator="https://u:secret@example.org";},v=>{v.claimed_verified_by_server=true;},v=>{v.status="completed";v.next_action=null;}]){const value=report();change(value);assert.throws(()=>parseExecutionUpdate(value));}
  const completed=report({status:"completed",next_action:null,completion_basis:{kind:"verified_result",detail:"测试产物支持此项结果，仍为代理转述",evidence_indices:[0]}});
  assert.equal(parseExecutionUpdate(completed).status,"completed");
  const noResult=structuredClone(completed);delete noResult.evidence[0].quote;
  assert.throws(()=>parseExecutionUpdate(noResult),/execution_result_evidence_required/);
  const owner=report({status:"completed",next_action:null,evidence:[{kind:"owner_statement",title:"本人明确确认",locator:"codex:test-original-work:owner-turn",observed_at:evidence.observed_at,quote:"这项工作已经完成。"}],completion_basis:{kind:"owner_explicit",detail:"本人明确确认本项完成",evidence_indices:[0]}});
  assert.equal(parseExecutionUpdate(owner).completion_basis.kind,"owner_explicit");
  const badOwner=structuredClone(owner);delete badOwner.evidence[0].quote;
  assert.throws(()=>parseExecutionUpdate(badOwner),/owner_statement_quote_required/);
  const submitted={...completed,status:"submitted"};
  assert.throws(()=>parseExecutionUpdate(submitted),/execution_submission_receipt_required/);
  submitted.evidence=[...submitted.evidence,{kind:"submission_receipt",title:"平台真实回执",locator:"https://courses.example.edu/course/1/submission/2",observed_at:evidence.observed_at,quote:"已提交；回执编号 test-only-2"}];
  assert.equal(parseExecutionUpdate(submitted).status,"submitted");
  assert.throws(()=>parseExecutionUpdate(report({milestone_id:"demo-core-loop",evidence:[{kind:"conversation",title:"聊过这个问题",locator:"codex:test-original-work",observed_at:evidence.observed_at}]})),/execution_milestone_evidence_required/);
});

test("conversation binding validates real destination format and writes metadata without starting work",async()=>{
  validateWorkConversation(conversation);
  validateWorkConversation({surface:"chatgpt",thread_id:"test-chat",title:"已有GPT会话",url:"https://chatgpt.com/c/test-chat"});
  for(const value of [{...conversation,url:"codex://threads/wrong-id"},{...conversation,url:"https://attacker.example"},{surface:"chatgpt",thread_id:"test-chat",title:"测试",url:"https://attacker.example/c/test-chat"}])assert.throws(()=>validateWorkConversation(value));
  const{store}=await setup();const before=await store.snapshot();
  const input={event_id:"bind-original",package_id:"research",expected_binding_revision:0,conversation};
  const bound=await store.bindWorkConversation(input);const pkg=bound.doc.packages[1];
  assert.equal(bound.event.result.outcome,"work_conversation_bound");
  assert.equal(pkg.conversation_binding.source,"existing_conversation");
  const stripped=structuredClone(pkg);delete stripped.conversation_binding;assert.deepEqual(stripped,before.doc.packages[1]);
  assert.equal(bound.doc.current_package_id,before.doc.current_package_id);assert.deepEqual(bound.doc.cinema,before.doc.cinema);
  assert.equal((await store.bindWorkConversation(input)).idempotent,true);
  await assert.rejects(store.bindWorkConversation({...input,event_id:"stale-binding"}),/conversation_binding_revision_conflict/);
  const next=await store.bindWorkConversation({...input,event_id:"second-binding",expected_binding_revision:1,conversation:{...conversation,title:"同一原对话的新标题"}});
  assert.deepEqual(next.doc.packages[1].conversation_binding_history,[pkg.conversation_binding]);
});

test("execution writes all four task domains without touching fact confirmation, legacy progress, selection or rewards",async()=>{
  const{store}=await setup();const before=await store.snapshot();
  for(const package_id of ["personal","research","edu","course"]){const result=await store.recordExecution(report({event_id:`domain-${package_id}`,package_id}));const pkg=result.doc.packages.find(item=>item.id===package_id);assert.equal(executionOf(pkg).reported_by,"agent_report");assert.equal(pkg.execution.revision,1);assert.equal(pkg.execution.content_revision,1);const stripped=structuredClone(pkg);delete stripped.execution;assert.deepEqual(stripped,before.doc.packages.find(item=>item.id===package_id));assert.deepEqual(result.doc.cinema,before.doc.cinema);assert.equal(result.doc.current_package_id,"personal");}
  const snapshot=await store.snapshot();assert.ok(snapshot.doc.packages[0].facts.every(fact=>fact.status==="pending"));
});

test("execution retries are idempotent and stale execution/content versions preserve the rejected summary",async()=>{
  const{store}=await setup();const first=await store.recordExecution(report());
  assert.equal((await store.recordExecution(report())).idempotent,true);
  const stale=report({event_id:"stale-execution",summary:"另一处尚未应用的原始执行说明"});
  await assert.rejects(store.recordExecution(stale),error=>error.message==="execution_revision_conflict"&&error.details.raw_preserved);
  const content=report({event_id:"stale-content",expected_execution_revision:1,expected_content_revision:99});
  await assert.rejects(store.recordExecution(content),/execution_content_revision_conflict/);
  assert.deepEqual((await store.snapshot()).doc,first.doc);
  const events=(await store.listEvents("research")).events;assert.equal(events.find(event=>event.id===stale.event_id).raw_text,stale.summary);
  const second=await store.recordExecution(report({event_id:"execution-next",expected_execution_revision:1,status:"blocked",summary:"诊断结果表明还存在阻碍",next_action:"处理明确的阻碍"}));
  assert.equal(second.doc.packages[1].execution.revision,2);assert.deepEqual(second.doc.packages[1].execution_history,[first.doc.packages[1].execution]);
});

test("execution source revision is checked independently and binding does not overwrite execution",async()=>{
  const{store}=await setup();const sourced=await store.updateAcademicTasks(academic(1));
  const first=await store.recordExecution(report({event_id:"academic-execution",package_id:"course",expected_source_revision:1}));
  const newer=await store.updateAcademicTasks(academic(first.revision,1));
  assert.equal(executionOf(newer.doc.packages[3]).event_id,first.doc.packages[3].execution.event_id);
  await assert.rejects(store.recordExecution(report({event_id:"old-source-report",package_id:"course",expected_execution_revision:1,expected_source_revision:1})),/execution_source_revision_conflict/);
  const current=await store.recordExecution(report({event_id:"new-source-report",package_id:"course",expected_execution_revision:1,expected_source_revision:2}));
  assert.equal(current.doc.packages[3].execution.academic_source_revision,2);
  assert.equal(executionOf(current.doc.packages[3]).revision,2);
  assert.equal(executionOf({...current.doc.packages[3],content:{...current.doc.packages[3].content,revision:99}}),null);
  const bound=await store.bindWorkConversation({event_id:"bind-after-execution",package_id:"course",expected_binding_revision:0,conversation});
  assert.deepEqual(bound.doc.packages[3].execution,current.doc.packages[3].execution);assert.deepEqual(bound.doc.packages[3].academic_task,newer.doc.packages[3].academic_task);assert.equal(sourced.doc.packages[3].work.status,"ready");
});

test("execution concurrency retains independent package changes and rejects a stale report on the same package",async()=>{
  const{store}=await setup();
  const independent=await Promise.all([store.recordExecution(report({event_id:"research-a"})),store.recordExecution(report({event_id:"edu-a",package_id:"edu"}))]);assert.equal(independent.length,2);
  const race=await Promise.allSettled([store.recordExecution(report({event_id:"race-a",expected_execution_revision:1})),store.recordExecution(report({event_id:"race-b",expected_execution_revision:1}))]);assert.equal(race.filter(result=>result.status==="fulfilled").length,1);assert.equal(race.find(result=>result.status==="rejected").reason.message,"execution_revision_conflict");
  const doc=(await store.snapshot()).doc;assert.equal(doc.packages[1].execution.revision,2);assert.equal(doc.packages[2].execution.revision,1);
});

test("execution archives the last fifty snapshots while immutable events retain the earlier complete reports",async()=>{
  const{store}=await setup();let latest;
  for(let index=0;index<53;index++)latest=await store.recordExecution(report({event_id:`history-${index}`,expected_execution_revision:index,summary:`测试执行报告${index}`}));
  assert.equal(latest.doc.packages[1].execution_history.length,50);assert.equal(latest.doc.packages[1].execution_history[0].revision,3);
  const earliest=(await store.listEvents("research",null,100)).events.find(event=>event.id==="history-0");assert.equal(earliest.result.execution.summary,"测试执行报告0");assert.equal(earliest.result.execution.revision,1);
});

test("only evidence-backed optional execution milestones issue a linked card once",async()=>{
  const{store}=await setup();const input=report({milestone_id:"demo-core-loop"});const first=await store.recordExecution(input);
  assert.equal(first.doc.cinema.earned_cards.length,1);assert.equal(first.doc.cinema.milestones[0].basis,"agent_report");assert.equal(first.doc.cinema.earned_cards[0].event_id,input.event_id);assert.equal(first.doc.packages[1].task_completion,undefined);
  assert.equal((await store.recordExecution(input)).doc.cinema.earned_cards.length,1);
  await assert.rejects(store.recordExecution(report({event_id:"same-stage-again",expected_execution_revision:1,milestone_id:"demo-core-loop"})),/milestone_already_recorded/);
  const next=await store.recordExecution(report({event_id:"ordinary-after-stage",expected_execution_revision:1}));assert.equal(next.doc.cinema.earned_cards.length,1);
});

test("material review confirms exactly the current candidate with owner quotation and leaves unrelated fields and task selection intact",async()=>{
  const{store}=await setup();const before=await store.snapshot();
  const selected=await store.apply({event_id:"select-research",expected_revision:1,kind:"activate",package_id:"research"},"owner");
  const result=await store.recordMaterialReview(review());const pkg=result.doc.packages[0];
  assert.equal(result.event.result.outcome,"material_fields_reviewed");assert.equal(pkg.facts[0].status,"confirmed");assert.equal(pkg.facts[0].confirmed_by,"conversation:codex:test-original-work");assert.deepEqual(pkg.facts[1],before.doc.packages[0].facts[1]);assert.deepEqual(pkg.content,before.doc.packages[0].content);assert.equal(pkg.fact_review_history[0].owner_quote,review().owner_quote);assert.equal(pkg.revision,2);assert.equal(result.doc.current_package_id,selected.doc.current_package_id);assert.deepEqual(result.doc.cinema,before.doc.cinema);assert.equal((await store.recordMaterialReview(review())).idempotent,true);
  const revise=await store.recordMaterialReview(review({event_id:"needs-revision",expected_package_revision:2,owner_quote:"学校名称这一项需要修改，但现在不替我改候选。",field_reviews:[{field_id:"school",expected_candidate:"Example University",decision:"needs_revision",comment:"保留原候选，等待新材料"}]}));
  assert.equal(revise.doc.packages[0].facts[0].status,"pending");assert.equal(revise.doc.packages[0].facts[0].confirmed_by,null);assert.equal(revise.doc.packages[0].facts[0].content.candidate,"Example University");assert.equal(revise.doc.packages[0].fact_review_history.length,2);
});

test("material review never confirms a stale candidate or partially applies a mixed invalid review",async()=>{
  const{store}=await setup();
  for(const value of [review({owner_quote:" "}),review({field_reviews:[{field_id:"school",expected_candidate:"Wrong school",decision:"confirmed"}]}),review({field_reviews:[{field_id:"school",expected_candidate:"Example University",decision:"confirmed"},{field_id:"missing",expected_candidate:null,decision:"confirmed"}]}),review({conversation:{...conversation,url:"codex://threads/other"}})])await assert.rejects(store.recordMaterialReview(value));
  assert.equal((await store.snapshot()).revision,1);assert.ok((await store.snapshot()).doc.packages[0].facts.every(item=>item.status==="pending"));
  const completed=await store.recordMaterialReview(review());
  await assert.rejects(store.recordMaterialReview(review({event_id:"stale-review",owner_quote:"另一对话里旧版本的确认原话"})),error=>error.message==="material_review_package_revision_conflict"&&error.details.raw_preserved);
  await assert.rejects(store.recordMaterialReview(review({event_id:"stale-review-content",expected_content_revision:99,expected_package_revision:2})),/material_review_content_revision_conflict/);
  assert.deepEqual((await store.snapshot()).doc,completed.doc);
});

test("pending material replies remain pending until the review explicitly consumes their real package-owned ledger IDs",async()=>{
  const{store}=await setup();
  await store.apply({event_id:"raw-owner-correction",expected_revision:1,kind:"reply",package_id:"personal",text:"本人额外补充，不应被普通确认吞掉"},"owner");
  const first=await store.recordMaterialReview(review());assert.equal(first.doc.packages[0].pending_review,true);assert.deepEqual(first.doc.packages[0].pending_reply_event_ids,["raw-owner-correction"]);
  await assert.rejects(store.recordMaterialReview(review({event_id:"invalid-reviewed-id",expected_package_revision:2,reviewed_reply_event_ids:["not-found"]})),/invalid_reviewed_reply_event/);
  const second=await store.recordMaterialReview(review({event_id:"explicit-reply-reviewed",expected_package_revision:2,reviewed_reply_event_ids:["raw-owner-correction"],owner_quote:"我确认已核对这条补充，学校候选准确。"}));
  assert.equal(second.doc.packages[0].pending_review,false);assert.deepEqual(second.doc.packages[0].reviewed_reply_event_ids,["raw-owner-correction"]);assert.equal((await store.event("raw-owner-correction")).raw_text,"本人额外补充，不应被普通确认吞掉");
});

test("generic execution cannot bypass fact confirmation or turn material review into a submission",async()=>{
  const{store}=await setup();
  const completed=report({event_id:"material-generic-complete",package_id:"personal",status:"completed",next_action:null,completion_basis:{kind:"verified_result",detail:"测试结果描述",evidence_indices:[0]}});
  await assert.rejects(store.recordExecution(completed),/execution_material_review_required/);
  assert.equal((await store.snapshot()).revision,1);
  const reviewed=await store.recordMaterialReview(review({owner_quote:"学校名称和入学时间这两项候选都准确。",field_reviews:[{field_id:"school",expected_candidate:"Example University",decision:"confirmed"},{field_id:"start",expected_candidate:"2023-09",decision:"confirmed"}]}));
  const allowed=await store.recordExecution(completed);assert.ok(allowed.doc.packages[0].facts.every(fact=>fact.status==="confirmed"));
  const submission={...completed,event_id:"cannot-submit-material",expected_execution_revision:1,status:"submitted",evidence:[evidence,{kind:"submission_receipt",title:"测试回执",locator:"https://courses.example.edu/course/1/submission/2",observed_at:evidence.observed_at,quote:"测试提交回执"}]};
  await assert.rejects(store.recordExecution(submission),/execution_material_submission_not_applicable/);
  const correction=await store.apply({event_id:"after-review-correction",expected_revision:allowed.revision,kind:"reply",package_id:"personal",text:"还有一处需要重新核实"},"owner");
  await assert.rejects(store.recordExecution({...completed,event_id:"cannot-ignore-new-correction",expected_execution_revision:1}),/execution_material_review_required/);
  assert.deepEqual((await store.snapshot()).doc,correction.doc);assert.deepEqual(reviewed.doc.cinema,allowed.doc.cinema);
  const needsRevision=await store.recordMaterialReview(review({event_id:"correct-after-completed-report",expected_package_revision:2,owner_quote:"这条补充已看过，学校字段需要修订，旧完成不能沿用。",field_reviews:[{field_id:"school",expected_candidate:"Example University",decision:"needs_revision"}],reviewed_reply_event_ids:["after-review-correction"]}));
  assert.equal(needsRevision.doc.packages[0].pending_review,false);
  assert.equal(needsRevision.doc.packages[0].execution.status,"completed");
  assert.equal(executionOf(needsRevision.doc.packages[0]),null);
});

test("concurrent field reviews preserve the losing owner quote and never consume another package's raw reply",async()=>{
  const{store}=await setup();
  const results=await Promise.allSettled([store.recordMaterialReview(review({event_id:"owner-review-a"})),store.recordMaterialReview(review({event_id:"owner-review-b",owner_quote:"入学时间这一项正确，学校名称这次不确认。",field_reviews:[{field_id:"start",expected_candidate:"2023-09",decision:"confirmed"}]}))]);
  assert.equal(results.filter(result=>result.status==="fulfilled").length,1);const failure=results.find(result=>result.status==="rejected").reason;assert.equal(failure.message,"material_review_package_revision_conflict");assert.equal(failure.details.raw_preserved,true);
  const events=(await store.listEvents("personal")).events;assert.ok(events.find(event=>event.kind==="conflict:material_review").raw_text);
  const db=new MemoryD1(),isolated=new StudioStore(db),document=seed();const other=structuredClone(document.packages[0]);other.id="other-facts";document.packages.push(other);await isolated.importDocument(document);
  const selected=await isolated.apply({event_id:"select-other-fact",expected_revision:1,kind:"activate",package_id:"other-facts"},"owner");
  await isolated.apply({event_id:"other-owner-raw",expected_revision:selected.revision,kind:"reply",package_id:"other-facts",text:"另一个材料的原话"},"owner");
  await assert.rejects(isolated.recordMaterialReview(review({reviewed_reply_event_ids:["other-owner-raw"]})),/invalid_reviewed_reply_event/);
  assert.ok((await isolated.snapshot()).doc.packages[0].facts.every(fact=>fact.status==="pending"));
});

function correction(overrides={}){return{event_id:"owner-correction",package_id:"personal",expected_content_revision:1,expected_package_revision:1,conversation:structuredClone(conversation),owner_quote:"入学时间不是2023年9月，改成2022年9月，我确认这个新值。",field_updates:[{field_id:"start",expected_candidate:"2023-09",candidate:"2022-09",decision:"confirmed"}],...overrides};}

test("quoted material correction patches the true new value while preserving every unchanged confirmation and old content snapshot",async()=>{
  const{store}=await setup();
  await store.recordMaterialReview(review({owner_quote:"学校名称和原候选时间暂按这两项确认。",field_reviews:[{field_id:"school",expected_candidate:"Example University",decision:"confirmed"},{field_id:"start",expected_candidate:"2023-09",decision:"confirmed"}]}));
  await store.recordExecution(report({event_id:"before-correction-execution",package_id:"personal"}));
  const before=await store.snapshot();
  const input=correction({expected_package_revision:2});
  const result=await store.recordMaterialCorrection(input),pkg=result.doc.packages[0],old=before.doc.packages[0];
  assert.equal(result.event.result.outcome,"material_fields_corrected");
  assert.equal(pkg.content.revision,2);assert.equal(pkg.revision,3);
  assert.equal(pkg.content.fields[1].candidate,"2022-09");assert.equal(pkg.facts[1].content.candidate,"2022-09");assert.equal(pkg.facts[1].status,"confirmed");
  assert.deepEqual(pkg.content.fields[0],old.content.fields[0]);assert.deepEqual(pkg.facts[0],old.facts[0]);
  assert.deepEqual(pkg.history[0].content,old.content);assert.deepEqual(pkg.history[0].facts,old.facts);
  assert.ok(pkg.content.fields[1].source_refs.includes("conversation:codex:test-original-work"));assert.ok(pkg.content.fields[1].source_refs.includes(`event:${input.event_id}`));
  assert.equal(pkg.fact_review_history.at(-1).owner_quote,input.owner_quote);assert.equal(pkg.fact_review_history.at(-1).reported_by,"agent_report");
  assert.deepEqual(pkg.execution,old.execution);assert.equal(executionOf(pkg),null);assert.equal(result.doc.current_package_id,before.doc.current_package_id);assert.deepEqual(result.doc.cinema,before.doc.cinema);assert.deepEqual(result.doc.packages.slice(1),before.doc.packages.slice(1));
});

test("material correction is idempotent and stale candidates or revisions cannot overwrite the accepted correction",async()=>{
  const{store}=await setup();const input=correction();const first=await store.recordMaterialCorrection(input);
  assert.equal((await store.recordMaterialCorrection(input)).idempotent,true);assert.equal((await store.snapshot()).doc.packages[0].history.length,1);
  await assert.rejects(store.recordMaterialCorrection({...input,event_id:"stale-owner-correction",owner_quote:"旧页面的另一条修改不得覆盖已接受的新值"}),error=>error.message==="material_correction_content_revision_conflict"&&error.details.raw_preserved);
  const mismatched=correction({event_id:"wrong-current-candidate",expected_content_revision:2,expected_package_revision:2,field_updates:[{field_id:"start",expected_candidate:"2023-09",candidate:"2021-09",decision:"confirmed"}]});
  await assert.rejects(store.recordMaterialCorrection(mismatched),/material_correction_candidate_mismatch/);
  await assert.rejects(store.recordMaterialCorrection({...mismatched,event_id:"new-field-not-allowed",field_updates:[{field_id:"new-field",expected_candidate:null,candidate:"cannot add",decision:"proposed"}]}),/material_correction_candidate_mismatch/);
  assert.deepEqual((await store.snapshot()).doc,first.doc);
  const stale=(await store.listEvents("personal")).events.find(event=>event.id==="stale-owner-correction");assert.equal(stale.raw_text,"旧页面的另一条修改不得覆盖已接受的新值");
});

test("proposed corrected values stay pending and raw replies are consumed only by explicitly validated review IDs",async()=>{
  const{store}=await setup();
  await store.apply({event_id:"raw-before-proposal",expected_revision:1,kind:"reply",package_id:"personal",text:"原候选可能需要修改，先别替我确认"},"owner");
  const proposed=await store.recordMaterialCorrection(correction({owner_quote:"可能是2022年9月，先当候选，还未确认。",field_updates:[{field_id:"start",expected_candidate:"2023-09",candidate:"2022-09",decision:"proposed"}]}));
  const pkg=proposed.doc.packages[0];assert.equal(pkg.content.fields[1].candidate,"2022-09");assert.equal(pkg.facts[1].status,"pending");assert.equal(pkg.facts[1].confirmed_by,null);assert.equal(pkg.content.fields[1].confirmation_evidence,null);assert.equal(pkg.pending_review,true);assert.deepEqual(pkg.pending_reply_event_ids,["raw-before-proposal"]);
  const next=await store.recordMaterialCorrection(correction({event_id:"proposal-with-explicit-raw-review",expected_content_revision:2,expected_package_revision:2,owner_quote:"这条原话已核对，时间仍作为待确认候选。",field_updates:[{field_id:"start",expected_candidate:"2022-09",candidate:"2022-09",decision:"proposed"}],reviewed_reply_event_ids:["raw-before-proposal"]}));
  assert.equal(next.doc.packages[0].pending_review,false);assert.equal(next.doc.packages[0].facts[1].status,"pending");assert.deepEqual(next.doc.packages[0].facts[0],seed().packages[0].facts[0]);assert.equal(next.doc.cinema.earned_cards,undefined);
});
