import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { extname } from "node:path";
registerHooks({ resolve(specifier, context, next) { return next(specifier.startsWith(".") && !extname(specifier) && context.parentURL?.endsWith(".ts") ? specifier + ".ts" : specifier, context); } });
const { packageProgress, isPackageComplete, nextIncompleteInDomain } = await import("../lib/task-progress.ts");

function report(status = "in_progress") {
  const at = new Date().toISOString(), completed = ["completed", "submitted"].includes(status);
  return { revision: 1, event_id: "execution-test-1", updated_at: at, status, summary: "保留可核实的工作结果", next_action: completed ? null : "继续检查结果", evidence: completed ? [{ kind: "owner_statement", title: "本人明确确认", locator: "original-conversation", observed_at: at, quote: "这项工作已完成并保留结果。" }] : [{ kind: "conversation", title: "当前原对话", locator: "original-conversation", observed_at: at }], ...(completed ? { completion_basis: { kind: "owner_explicit", detail: "本人明确说明已完成。", evidence_indices: [0] } } : {}), reported_by: "agent_report", content_revision: 2 };
}
function guided(id = "research") { return { id, content: { kind: "guided_work", domain: "research", revision: 2 }, facts: [], work: { status: "ready" }, execution: report() }; }
function academic() {
  return { ...guided("course"), content: { kind: "guided_work", domain: "academics", revision: 2 }, academic_task: { id: "actual-assignment", kind: "assignment", title: "实际作业交付", course_name: "物联网", deliverables: ["报告与真实结果"], sources: [{ id: "source", title: "学校作业" }], source_refs: ["source"], source_revision: 3, sourced_at: new Date().toISOString() }, task_completion: { status: "completed" }, work: { status: "session_complete" }, execution: { ...report("completed"), academic_source_revision: 3 } };
}

test("execution completion applies to real work, with pending review taking precedence", () => {
  const pkg = guided(); pkg.execution = report("completed");
  assert.equal(packageProgress(pkg).status, "completed");
  assert.equal(isPackageComplete(pkg), true);
  assert.equal(packageProgress({ ...pkg, pending_review: true }).status, "pending_review");
  assert.equal(isPackageComplete({ ...pkg, pending_reply_event_ids: ["unreviewed"] }), false);
});
test("current fact confirmations outrank an earlier in-progress execution report", () => {
  const pkg = { ...guided("facts"), content: { domain: "admissions", revision: 2 }, facts: [{ status: "confirmed" }, { status: "confirmed" }] };
  assert.deepEqual(packageProgress(pkg), { status: "confirmed_material", label: "材料已核对", complete: true });
  assert.equal(packageProgress({ ...pkg, pending_review: true }).status, "pending_review");
});
test("generic execution completion cannot confirm candidate material fields", () => {
  const pkg = { ...guided("facts"), content: { domain: "admissions", revision: 2 }, facts: [{ status: "pending" }], execution: report("completed") };
  assert.equal(isPackageComplete(pkg), false);
  assert.equal(packageProgress(pkg).status, "not_started");
});
test("academic execution uses actual source revision and never inherits old micro-goal completion", () => {
  const pkg = academic();
  assert.equal(isPackageComplete(pkg), false);
  assert.equal(packageProgress(pkg).label, "成果已备好 · 待提交");
  const submitted = structuredClone(pkg); submitted.execution.status = "submitted";
  submitted.execution.evidence.push({ kind: "submission_receipt", title: "学校回执", locator: "https://courses.example.edu/receipt", observed_at: new Date().toISOString(), quote: "已提交的学校记录" });
  assert.equal(isPackageComplete(submitted), true);
  assert.deepEqual(packageProgress({ ...pkg, execution: undefined }), { status: "not_started", label: "待完成", complete: false });
  assert.equal(isPackageComplete({ ...pkg, execution: { ...pkg.execution, academic_source_revision: 2 } }), false);
  assert.equal(isPackageComplete({ ...pkg, execution: { ...pkg.execution, content_revision: 1 } }), false);
});
test("stale execution falls back to actual current facts and legacy completed work stays completed", () => {
  const pkg = { ...guided(), execution: { ...report("completed"), content_revision: 1 } };
  assert.equal(isPackageComplete(pkg), false);
  assert.equal(isPackageComplete({ ...pkg, execution: undefined, task_completion: { status: "completed" } }), true);
  const facts = { ...pkg, content: { domain: "admissions", revision: 2 }, facts: [{ status: "confirmed" }] };
  assert.equal(packageProgress(facts).status, "confirmed_material");
});
test("completed execution leaves an explicit next item in the same category", () => {
  const first = { ...guided("first"), execution: report("completed") }, second = guided("second");
  assert.equal(nextIncompleteInDomain([first, second], first.id)?.id, second.id);
  assert.equal(packageProgress({ ...second, execution: report("waiting") }).status, "waiting");
  assert.equal(packageProgress({ ...second, execution: report("blocked") }).status, "blocked");
});
