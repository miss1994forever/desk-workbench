import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { test } from "node:test";
registerHooks({resolve(s,c,next){return next(s.startsWith(".")&&!extname(s)&&c.parentURL?.endsWith(".ts")?s+".ts":s,c);}});
const { planWorkLaunch, conversationUrl } = await import("../lib/work-launch.ts");
function task(id="course-test",directory="/workspace/courses/iot") {
  return {id,revision:1,content:{kind:"academic_work",domain:"academics",title:"旧核实步骤",revision:1},facts:[],academic_task:{id:"assignment-test",kind:"assignment",title:"实验二：模型压缩与部署",course_name:"物联网",deliverables:["真实实验报告"],source_revision:1,sourced_at:"2026-10-19T01:00:00Z",sources:[{id:"school",title:"平台作业"}],source_refs:["school"],workspace_path:directory}};
}
const bound={surface:"codex",thread_id:"actual-test-thread",title:"已有工作对话",url:"codex://threads/actual-test-thread"};
test("new work opens an official local composer with bounded context, never auto sends",()=>{
 const pkg=task(),before=structuredClone(pkg),plan=planWorkLaunch(pkg),url=new URL(plan.href);
 assert.equal(plan.kind,"new");assert.equal(url.protocol,"codex:");assert.equal(url.hostname,"new");
 assert.equal(url.searchParams.get("path"),pkg.academic_task.workspace_path);
 assert.deepEqual([...url.searchParams.keys()].sort(),["path","prompt"]);
 const prompt=url.searchParams.get("prompt");
 assert(prompt.includes('"package_id":"course-test"'));assert(prompt.includes(pkg.academic_task.title));
 assert(!prompt.includes(pkg.content.title));assert(prompt.includes("CODEX_THREAD_ID"));assert(prompt.includes("get_work_context"));assert(prompt.includes("bind_work_conversation"));
 assert(!/authorization|bearer|api.?key|autoSubmit/i.test(prompt));assert.deepEqual(pkg,before);
});
test("a freshly bound original conversation always wins over new chat, even when paused or complete",()=>{
 const pkg=task();pkg.conversation_binding={revision:1,conversation:bound};
 assert.deepEqual(planWorkLaunch(pkg,true),{kind:"existing",href:bound.url,title:bound.title});
});
test("a remote binding without a supported local link never turns into a duplicate new chat",()=>{
 const pkg=task();pkg.conversation_binding={revision:1,conversation:{...bound,url:undefined}};
 assert.deepEqual(planWorkLaunch(pkg),{kind:"unavailable",reason:"bound_without_link"});
 assert.equal(conversationUrl({...bound,url:"https://untrusted.test/"}),null);
 assert.equal(conversationUrl({...bound,url:bound.url+"?token=secret"}),null);
});
test("arbitrary cloud paths, traversal and unverified research workspaces cannot launch",()=>{
 for(const directory of ["/tmp/unverified","/workspace/courses/iot/../区块链","https://untrusted.test/"])
  assert.deepEqual(planWorkLaunch(task("course-test",directory)),{kind:"unavailable",reason:"workspace_unverified"});
 assert.equal(planWorkLaunch({...task(),content:{title:"新研究",domain:"research",project_key:"unknown"}}).kind,"unavailable");
 assert.equal(planWorkLaunch(task("bad\nid")).kind,"unavailable");
 assert.deepEqual(planWorkLaunch(task(),true),{kind:"unavailable",reason:"paused"});
});
test("collaboration uses its actual original workspace and fact completion cannot create another chat",()=>{
 const edu={id:"collaboration-new",content:{title:"LSSP上线答复",kind:"guided_work",domain:"collaboration",project_key:"collaboration-pm",revision:1},facts:[]};
 assert.equal(planWorkLaunch(edu).workspace,"/workspace/collaboration");
 const done={id:"finished-facts",content:{title:"教育信息",domain:"admissions"},facts:[{status:"confirmed"}]};
 assert.deepEqual(planWorkLaunch(done),{kind:"unavailable",reason:"task_completed"});
});
