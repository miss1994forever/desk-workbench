import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { registerHooks } from "node:module";
import { extname } from "node:path";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !extname(specifier) && context.parentURL?.endsWith(".ts")) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { StudioStore, checksum, reduceAction } = await import("../lib/studio-store.ts");
const { earnCinemaCard, CINEMA_COLLECTION_CAPACITY } = await import("../lib/cinema-progress.ts");
const { FILM_DAYS } = await import("../lib/film-season.ts");
const { MOVIE_REWARDS } = await import("../lib/movie-rewards.ts");
const { academicTaskOf, normalizedPackageDomain, packageProgress, isPackageComplete, nextIncompleteInDomain } = await import("../lib/task-progress.ts");
const { milestonesForPackage, milestoneStatus, milestoneKey } = await import("../lib/progress-milestones.ts");

// Compile the real page's pure validator functions instead of mirroring them.
function frontendContract() {
  const source = ts.createSourceFile("page.tsx", readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(["record", "isEvent", "isPackage", "isSnapshot", "text"]);
  const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map((node) => node.getText(source));
  assert.equal(functions.length, names.size);
  const compiled = ts.transpileModule(functions.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(`${compiled}\nreturn {isSnapshot,text};`)();
}

function fixture() {
  const nameField = { id: "name", question: "姓名这样准确吗？", candidate: "姓名待核对", source_refs: ["fixture:personal"] };
  const courseField = { id: "course", question: "课程事例这样准确吗？", candidate: "课程事例", source_refs: ["fixture:course"] };
  return {
    schema_version: 1, current_package_id: "personal", paused: false, mode: "gentle",
    packages: [
      { id: "personal", revision: 1, content: { revision: 1, title: "确认个人信息", confirm_phrase: "确认以上个人信息准确", fields: [nameField] }, facts: [{ id: "name", content: structuredClone(nameField), status: "pending" }] },
      { id: "letter", revision: 1, content: { revision: 1, title: "推荐信", confirm_phrase: "确认课程事实", fields: [courseField] }, facts: [{ id: "course", content: structuredClone(courseField), status: "pending" }] },
    ],
    source_context: { observed_at: "2026-01-01T00:00:00Z", text: "旧来源" },
    cinema: { anchor_date: "2026-12-16" }, migration: { origin: "fixture" },
  };
}

// Use real SQLite transactions to exercise conditional SQL and CAS semantics;
// no hosted database, network, auth credential, or mail is accessed.
class SqliteD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec(`CREATE TABLE documents (id TEXT PRIMARY KEY,body TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE events (id TEXT PRIMARY KEY,package_id TEXT,kind TEXT NOT NULL,raw_text TEXT NOT NULL,base_revision INTEGER NOT NULL,created_at TEXT NOT NULL,result TEXT NOT NULL);`);
  }
  prepare(sql) {
    const owner = this;
    const statement = {
      sql, values: [],
      bind(...values) { return { ...this, values }; },
      async first() { return owner.db.prepare(this.sql).get(...this.values) ?? null; },
      async all() { return { results: owner.db.prepare(this.sql).all(...this.values) }; },
      async run() { const result = owner.db.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
    return statement;
  }
  async batch(statements) {
    this.db.exec("BEGIN");
    try {
      const result = statements.map((statement) => {
        const record = this.db.prepare(statement.sql).run(...statement.values);
        return { success: true, meta: { changes: Number(record.changes) } };
      });
      this.db.exec("COMMIT");
      return result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}

async function setup() {
  const db = new SqliteD1();
  const store = new StudioStore(db);
  await store.importDocument(fixture());
  return { db, store };
}
function action(overrides = {}) {
  return { event_id: "event-1", expected_revision: 1, kind: "reply", package_id: "personal", text: "第二句不准确，我补充一下", ...overrides };
}
function mail(overrides = {}) {
  return { event_id: "mail-1", package_id: "personal", package_revision: 1, raw_text: "确认以上个人信息准确", confirmation_phrase: "确认以上个人信息准确", received_at: "2026-01-02T01:00:00+08:00", source_message_id: "<reply-1@example.edu>", from_address: "owner@example.com", ...overrides };
}

function guided(id = "vo-study") {
  return { id, revision: 1, content: { package_id: id, revision: 1, kind: "guided_work", domain: "academics", project_key: "robotics",
    title: "从速度障碍图解释一次避碰", description: "用课件支持一个具体解释", estimated_user_minutes: 15,
    deliverable: "一段有依据的VO/RVO区别", working_question: "双方都避让会改变什么？", fields: [],
    guide_steps: [{ id: "observe", title: "看图", body: "从图中标出速度障碍", source_refs: ["slides"] }, { id: "explain", title: "解释", body: "解释VO与RVO的假设", prompt: "用自己的话写一段", source_refs: ["slides"] }],
    sources: [{ id: "slides", document_title: "本地课程课件", locator: "section:velocity-obstacle", read_status: "page_text_extracted" }], source_refs: ["slides"] }, facts: [] };
}
function workplan(overrides = {}) {
  return { event_id: "plan-1", expected_revision: 1, packages: [guided()],
    plan: { date: "2026-10-19", items: [{ id: "slot-1", package_id: "vo-study", date: "2026-10-19", start: "10:00", end: "10:15", duration_minutes: 15, kind: "suggested", reason: "利用课前窗口", evidence_refs: ["slides"] }] },
    source_updates: { academics: { status: "partial", checked_at: "2026-01-19T00:00:00Z", items: [{ id: "robotics", title: "课件阅读" }], provenance: { kind: "local_course_slides", read_status: "page_text_extracted" } } }, ...overrides };
}
async function setupWork() {
  const { store, db } = await setup();
  const registered = await store.updateWorkplan(workplan());
  const selected = await store.apply(action({ event_id: "choose-work", expected_revision: registered.revision, kind: "activate", package_id: "vo-study", text: undefined }), "owner");
  return { store, db, revision: selected.revision };
}

async function setupTaskQueue() {
  const { store, db } = await setup();
  const second = guided("second-academic");
  const other = guided("other-research"); other.content.domain = "research";
  const registered = await store.updateWorkplan(workplan({ packages: [guided(), other, second] }));
  const selected = await store.apply(action({ event_id: "choose-queue", expected_revision: registered.revision, kind: "activate", package_id: "vo-study", text: undefined }), "owner");
  return { store, db, revision: selected.revision };
}

test("shared progress distinguishes session summaries, owner completion, confirmed material and unresolved corrections", () => {
  const pkg = { ...guided(), work: { status: "ready", answers: {} } };
  assert.deepEqual(packageProgress(pkg), { status: "not_started", label: "待开始", complete: false });
  pkg.work = { status: "in_progress", answers: { observe: { text: "保存过的理解" } } };
  assert.equal(packageProgress(pkg).status, "in_progress");
  pkg.work.status = "session_complete";
  assert.equal(packageProgress(pkg).status, "session_paused");
  assert.equal(isPackageComplete(pkg), false);
  pkg.task_completion = { status: "completed", basis: "owner_report" };
  assert.equal(packageProgress(pkg).status, "completed");
  assert.equal(isPackageComplete(pkg), true);
  pkg.pending_review = true;
  assert.equal(packageProgress(pkg).status, "pending_review");
  assert.equal(isPackageComplete(pkg), false);
  const material = fixture().packages[0];
  assert.equal(isPackageComplete(material), false);
  material.facts[0].status = "confirmed";
  assert.equal(packageProgress(material).status, "confirmed_material");
  material.pending_reply_event_ids = ["new-correction"];
  assert.equal(isPackageComplete(material), false);
  material.reviewed_reply_event_ids = ["new-correction"];
  assert.equal(isPackageComplete(material), true);
});

test("same-domain navigation normalizes aliases, wraps once, skips completed packages and never loops to itself", () => {
  const items = [guided("first"), guided("second"), guided("third"), guided("research")];
  items[0].content.domain = "courses";
  items[1].content.domain = "coursework";
  items[3].content.domain = "research";
  assert.equal(normalizedPackageDomain(items[0]), "academics");
  assert.equal(normalizedPackageDomain({ content: { domain: "applications" } }), "admissions");
  assert.equal(normalizedPackageDomain({ content: {} }), "admissions");
  items[1].task_completion = { status: "completed" };
  assert.equal(nextIncompleteInDomain(items, "first").id, "third");
  assert.equal(nextIncompleteInDomain(items, "third").id, "first");
  items[0].task_completion = { status: "completed" };
  assert.equal(nextIncompleteInDomain(items, "third"), null);
  assert.equal(nextIncompleteInDomain(items, "research"), null);
  assert.equal(nextIncompleteInDomain(items, "missing"), null);
});

test("explicit task completion records owner evidence and atomically selects the next unfinished task in its category", async () => {
  const { store, db, revision } = await setupTaskQueue();
  const before = await store.snapshot();
  const note = "  已在课程平台提交报告，回执编号由我保存。  ";
  const input = { event_id: "complete-task", expected_revision: revision, kind: "task_complete", package_id: "vo-study", text: note };
  await assert.rejects(store.apply({ ...input, text: "  " }, "owner"), /completion_note_required/);
  await assert.rejects(store.apply({ ...input, text: "x".repeat(3001) }, "owner"), /completion_note_required/);
  const result = await store.apply(input, "owner");
  const pkg = result.doc.packages.find((item) => item.id === "vo-study");
  assert.equal(pkg.task_completion.status, "completed");
  assert.equal(pkg.task_completion.note, note);
  assert.equal(pkg.task_completion.completed_by, "owner");
  assert.equal(pkg.task_completion.basis, "owner_report");
  assert.equal(pkg.task_completion.event_id, input.event_id);
  assert.ok(Number.isFinite(Date.parse(pkg.task_completion.completed_at)));
  assert.equal(result.event.result.outcome, "task_completed_owner_report");
  assert.equal(result.event.result.completion_basis, "owner_report");
  assert.equal(result.event.result.next_package_id, "second-academic");
  assert.equal(result.event.raw_text, note);
  assert.equal(result.doc.current_package_id, "second-academic");
  assert.deepEqual(pkg.work, before.doc.packages.find((item) => item.id === pkg.id).work);
  assert.deepEqual(pkg.facts, []);
  assert.equal(pkg.done, undefined);
  assert.deepEqual(result.doc.cinema, before.doc.cinema);
  assert.equal((await store.apply(input, "owner")).idempotent, true);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM events WHERE kind='task_complete'").get().n, 1);
  assert.equal((await store.snapshot()).doc.cinema.earned_cards?.length ?? 0, 0);
  const last = await store.apply({ ...input, event_id: "complete-last", expected_revision: result.revision, package_id: "second-academic", text: "第二项也已完成" }, "owner");
  assert.equal(last.doc.current_package_id, "second-academic");
  assert.equal(last.event.result.next_package_id, null);
  assert.equal(isPackageComplete(last.doc.packages.find((item) => item.id === "other-research")), false);
});

test("reopening archives the completion evidence, preserves work and awards no duplicate task card", async () => {
  const { store, revision } = await setupWork();
  const answered = await store.apply({ event_id: "saved-work", expected_revision: revision, kind: "work_reply", package_id: "vo-study", step_id: "observe", text: "已有图和解释" }, "owner");
  const finished = await store.apply({ event_id: "session-summary", expected_revision: answered.revision, kind: "work_finish", package_id: "vo-study", text: "先留一个本轮小结" }, "owner");
  assert.equal(finished.doc.current_package_id, "vo-study");
  assert.equal(finished.doc.packages[2].task_completion, undefined);
  const completed = await store.apply({ event_id: "done", expected_revision: finished.revision, kind: "task_complete", package_id: "vo-study", text: "已按要求完成并提交" }, "owner");
  await assert.rejects(store.apply({ event_id: "double-complete", expected_revision: completed.revision, kind: "task_complete", package_id: "vo-study", text: "重复点完成" }, "owner"), /task_already_completed/);
  await assert.rejects(store.apply({ event_id: "edit-done", expected_revision: completed.revision, kind: "work_reply", package_id: "vo-study", step_id: "observe", text: "需要修改" }, "owner"), /task_reopen_required/);
  const reopened = await store.apply({ event_id: "reopen", expected_revision: completed.revision, kind: "task_reopen", package_id: "vo-study", text: "发现附图需要补充" }, "owner");
  const pkg = reopened.doc.packages[2];
  assert.equal(pkg.task_completion, undefined);
  assert.deepEqual(pkg.work, completed.doc.packages[2].work);
  assert.deepEqual(pkg.facts, completed.doc.packages[2].facts);
  assert.equal(pkg.task_completion_history[0].note, "已按要求完成并提交");
  assert.equal(pkg.task_completion_history[0].reopen_note, "发现附图需要补充");
  assert.equal(pkg.task_completion_history[0].reopened_by, "owner");
  assert.equal(packageProgress(pkg).status, "session_paused");
  assert.deepEqual(reopened.doc.cinema, completed.doc.cinema);
  assert.equal((await store.apply({ event_id: "reopen", expected_revision: completed.revision, kind: "task_reopen", package_id: "vo-study", text: "发现附图需要补充" }, "owner")).idempotent, true);
  const doneAgain = await store.apply({ event_id: "done-after-fix", expected_revision: reopened.revision, kind: "task_complete", package_id: "vo-study", text: "已补齐附图" }, "owner");
  assert.equal(doneAgain.doc.packages[2].task_completion.note, "已补齐附图");
  assert.deepEqual(doneAgain.doc.cinema, completed.doc.cinema);
});

test("task completion never bypasses material confirmation and a stale completion preserves the raw evidence note", async () => {
  const { store } = await setup();
  await assert.rejects(store.apply(action({ kind: "task_complete", text: "我已完成" }), "owner"), /fact_material_requires_confirmation/);
  const work = await setupWork();
  const changed = await work.store.apply({ event_id: "other-device-mode", expected_revision: work.revision, kind: "mode", package_id: null, mode: "focus" }, "owner");
  const stale = { event_id: "stale-completion", expected_revision: work.revision, kind: "task_complete", package_id: "vo-study", text: "另一个设备输入的完成依据" };
  await assert.rejects(work.store.apply(stale, "owner"), (error) => error.message === "revision_conflict" && error.details.raw_preserved === true);
  await assert.rejects(work.store.apply(stale, "owner"), /revision_conflict/);
  const events = (await work.store.listEvents("vo-study")).events;
  assert.equal(events.find((event) => event.id === stale.event_id).raw_text, stale.text);
  assert.equal(events.find((event) => event.id === stale.event_id).kind, "conflict:task_complete");
  const snapshot = await work.store.snapshot();
  assert.equal(snapshot.revision, changed.revision);
  assert.equal(snapshot.doc.packages[2].task_completion, undefined);
  assert.equal(snapshot.doc.cinema.earned_cards?.length ?? 0, 0);
});

test("racing task completions commit one note and one category switch without a card while preserving the losing note", async () => {
  const { store, db, revision } = await setupTaskQueue();
  const input = { event_id: "completion-a", expected_revision: revision, kind: "task_complete", package_id: "vo-study", text: "设备一的完成依据" };
  const outcomes = await Promise.allSettled([store.apply(input, "owner"), store.apply({ ...input, event_id: "completion-b", text: "设备二的完成依据" }, "owner")]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  const losing = outcomes.find((result) => result.status === "rejected").reason;
  assert.equal(losing.message, "revision_conflict");
  assert.equal(losing.details.raw_preserved, true);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.doc.current_package_id, "second-academic");
  assert.equal(snapshot.doc.cinema.earned_cards?.length ?? 0, 0);
  const events = db.db.prepare("SELECT kind,raw_text FROM events WHERE kind IN ('task_complete','conflict:task_complete')").all();
  assert.equal(events.length, 2);
  assert.deepEqual(new Set(events.map((event) => event.raw_text)), new Set(["设备一的完成依据", "设备二的完成依据"]));
  const refreshed = await store.updateWorkplan(workplan({ event_id: "plan-after-task-complete", expected_revision: snapshot.revision, packages: [guided()] }));
  assert.deepEqual(refreshed.doc.packages.find((pkg) => pkg.id === "vo-study"), snapshot.doc.packages.find((pkg) => pkg.id === "vo-study"));
  assert.equal(refreshed.doc.current_package_id, "second-academic");
  assert.deepEqual(refreshed.doc.cinema, snapshot.doc.cinema);
});

test("finite material confirmation stays on unresolved ledger-only corrections rather than skipping review", async () => {
  const { store } = await setup();
  const changed = await store.apply(action({ kind: "mode", package_id: null, mode: "focus", text: undefined }), "owner");
  await assert.rejects(store.apply(action({ event_id: "old-page-correction", text: "旧页面的一处信息仍需修改" }), "owner"), /revision_conflict/);
  const confirmed = await store.apply(action({ event_id: "confirm-with-correction", expected_revision: changed.revision, kind: "confirm", text: "确认以上个人信息准确" }), "owner");
  assert.equal(confirmed.doc.current_package_id, "personal");
  assert.equal(confirmed.doc.packages[0].facts[0].status, "confirmed");
  assert.equal(packageProgress(confirmed.doc.packages[0]).status, "pending_review");
  assert.equal(confirmed.doc.packages[0].pending_reply_event_ids.includes("old-page-correction"), true);
});

test("a correction arriving between read and CAS prevents finite-confirm auto-navigation atomically", async () => {
  const { store, db } = await setup();
  const originalBatch = db.batch.bind(db);
  let inject = true;
  db.batch = async (statements) => {
    if (inject) {
      inject = false;
      db.db.prepare("INSERT INTO events VALUES ('late-correction','personal','conflict:reply','刚到的修正',1,'2026-01-01T00:00:00Z',?)").run(JSON.stringify({ error: "revision_conflict" }));
    }
    return originalBatch(statements);
  };
  await assert.rejects(store.apply(action({ event_id: "racing-confirm", kind: "confirm", text: "确认以上个人信息准确" }), "owner"), /revision_conflict/);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.doc.current_package_id, "personal");
  assert.equal(snapshot.doc.packages[0].facts[0].status, "pending");
  assert.equal(snapshot.doc.packages[0].pending_reply_event_ids.includes("late-correction"), true);
  const retried = await store.apply(action({ event_id: "review-aware-confirm", kind: "confirm", text: "确认以上个人信息准确" }), "owner");
  assert.equal(retried.doc.current_package_id, "personal");
  assert.equal(retried.doc.packages[0].facts[0].status, "confirmed");
});

test("workplan registers sourced work without changing current facts, pause, or Feishu evidence", async () => {
  const { store } = await setup();
  const result = await store.updateWorkplan(workplan());
  assert.equal(result.doc.current_package_id, "personal");
  assert.equal(result.doc.paused, false);
  assert.deepEqual(result.doc.packages.slice(0, 2), fixture().packages);
  assert.deepEqual(result.doc.source_context, fixture().source_context);
  assert.equal(result.doc.source_updates.academics.status, "partial");
  assert.equal(result.doc.plan.kind, "suggested");
  assert.deepEqual(result.doc.packages[2].work, { status: "ready", current_step_id: "observe", answers: {} });
  assert.equal((await store.updateWorkplan(workplan())).idempotent, true);
});

test("work steps save original answers, require actual saved work before a self-reported finish, and never confirm facts", async () => {
  const { store, revision } = await setupWork();
  const base = { event_id: "answer", expected_revision: revision, package_id: "vo-study", kind: "work_reply", step_id: "observe", text: "  我的原始观察：两个速度向量  " };
  await assert.rejects(store.apply({ ...base, kind: "work_finish", text: "今天到这里" }, "owner"), /requires_saved_answer/);
  await assert.rejects(store.apply({ ...base, kind: "confirm" }, "owner"), /requires_work_action/);
  await assert.rejects(store.apply({ ...base, step_id: "missing" }, "owner"), /step_not_found/);
  const saved = await store.apply(base, "owner");
  assert.equal(saved.event.result.outcome, "work_answer_saved");
  assert.equal(saved.event.result.step_id, "observe");
  assert.equal(saved.event.raw_text, base.text);
  assert.equal(saved.doc.packages[2].work.answers.observe.text, base.text);
  assert.equal((await store.apply(base, "owner")).idempotent, true);
  const switched = await store.apply({ ...base, event_id: "next-step", expected_revision: saved.revision, kind: "work_step", step_id: "explain", text: undefined }, "owner");
  assert.equal(switched.event.result.outcome, "work_step_changed");
  assert.deepEqual(switched.doc.packages[2].work.answers, saved.doc.packages[2].work.answers);
  const finished = await store.apply({ ...base, event_id: "finish", expected_revision: switched.revision, kind: "work_finish", step_id: undefined, text: "我写了观察，RVO的相互责任还没弄懂" }, "owner");
  assert.equal(finished.event.result.outcome, "work_session_finished_self_report");
  assert.equal(finished.doc.packages[2].work.status, "session_complete");
  assert.equal(finished.doc.packages[2].work.finish_summary, finished.event.raw_text);
  assert.deepEqual(finished.doc.packages.slice(0, 2), fixture().packages);
  assert.deepEqual(finished.doc.packages[2].facts, []);
  const reopened = await store.apply({ ...base, event_id: "continue", expected_revision: finished.revision, text: "继续补充理解" }, "owner");
  assert.equal(reopened.doc.packages[2].work.status, "in_progress");
  assert.equal(reopened.doc.packages[2].work.finish_history[0].event_id, "finish");
  assert.equal(reopened.doc.packages[2].work.completion_basis, undefined);
});

test("stale guided answers retain raw text and step metadata without overwriting saved work", async () => {
  const { store, revision } = await setupWork();
  const input = { event_id: "winning-answer", expected_revision: revision, package_id: "vo-study", kind: "work_reply", step_id: "observe", text: "先存的观察" };
  await store.apply(input, "owner");
  await assert.rejects(store.apply({ ...input, event_id: "other-device", text: "另一设备未丢失的原话" }, "owner"), (error) => error.message === "revision_conflict" && error.details.raw_preserved);
  const conflict = (await store.listEvents("vo-study")).events.find((event) => event.id === "other-device");
  assert.equal(conflict.kind, "conflict:work_reply");
  assert.equal(conflict.result.step_id, "observe");
  assert.equal(conflict.raw_text, "另一设备未丢失的原话");
  assert.equal((await store.snapshot()).doc.packages[2].work.answers.observe.text, input.text);
});

test("workplan repeated content preserves progress and cannot replace a package or inject completion", async () => {
  const { store, revision } = await setupWork();
  const saved = await store.apply({ event_id: "answer", expected_revision: revision, package_id: "vo-study", kind: "work_reply", step_id: "observe", text: "用户保存的解释" }, "owner");
  const result = await store.updateWorkplan(workplan({ event_id: "plan-refresh", expected_revision: saved.revision }));
  assert.deepEqual(result.doc.packages[2], saved.doc.packages[2]);
  assert.equal(result.doc.current_package_id, "vo-study");
  const changed = guided(); changed.content.title = "不同内容";
  await assert.rejects(store.updateWorkplan(workplan({ event_id: "replace", expected_revision: result.revision, packages: [changed] })), /different_content/);
  const forged = guided("new"); forged.work = { status: "session_complete", current_step_id: "observe", answers: {} };
  await assert.rejects(store.updateWorkplan(workplan({ event_id: "forged", expected_revision: result.revision, packages: [forged] })), /cannot_contain_user_progress/);
  assert.equal((await store.snapshot()).revision, result.revision);
});

test("workplan validates provenance, source keys, suggested times, references and safe step IDs", async () => {
  const { store } = await setup();
  const badInputs = [];
  let input = workplan(); input.packages[0].content.guide_steps[0].id = "__proto__"; badInputs.push(input);
  input = workplan(); input.packages[0].content.source_refs = ["invented"]; badInputs.push(input);
  input = workplan(); input.plan.items[0].kind = "confirmed_calendar_event"; badInputs.push(input);
  input = workplan(); input.plan.items[0].end = "09:00"; badInputs.push(input);
  input = workplan(); input.source_updates = { source_context: {} }; badInputs.push(input);
  input = workplan(); input.source_updates.academics.status = "synced"; badInputs.push(input);
  input = workplan(); input.source_updates.academics.items.push({ id: "robotics" }); badInputs.push(input);
  for (const invalid of badInputs) await assert.rejects(store.updateWorkplan(invalid));
  assert.equal((await store.snapshot()).revision, 1);
});

test("named source failures preserve observed data; older observations and unverified LMS sync are refused", async () => {
  const { store } = await setup();
  const input = workplan(); input.source_updates.academics = { status: "synced", checked_at: "2026-01-19T00:00:00Z", last_success_at: "2026-01-19T00:00:00Z", items: [{ id: "course", title: "实际读到的课程" }], provenance: { kind: "lms", source_url: "https://lms.example/course", read_status: "success", authenticated_read: true } };
  const first = await store.updateWorkplan(input);
  const failed = await store.updateWorkplan(workplan({ event_id: "failed-source", expected_revision: first.revision, packages: [], source_updates: { academics: { status: "error", checked_at: "2026-01-19T01:00:00Z", items: [], error: "当前读取失败" } } }));
  assert.deepEqual(failed.doc.source_updates.academics.items, input.source_updates.academics.items);
  assert.equal(failed.doc.source_updates.academics.last_success_at, "2026-01-19T00:00:00Z");
  assert.equal(failed.doc.source_updates.academics.status, "error");
  await assert.rejects(store.updateWorkplan(workplan({ event_id: "older-source", expected_revision: failed.revision, packages: [] })), /older/);
  const badProof = structuredClone(input.source_updates.academics); badProof.checked_at = "2026-01-19T02:00:00Z"; badProof.provenance.kind = "local_course_slides";
  await assert.rejects(store.updateWorkplan(workplan({ event_id: "local-is-not-lms", expected_revision: failed.revision, packages: [], source_updates: { academics: badProof } })), /verified_connected/);
});

test("racing workplans cannot report uncommitted registration success", async () => {
  const { store, db } = await setup();
  const results = await Promise.allSettled([store.updateWorkplan(workplan()), store.updateWorkplan(workplan({ event_id: "other-plan" }))]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM events WHERE kind='workplan'").get().n, 1);
  assert.equal((await store.snapshot()).doc.packages.length, 3);
});

test("ordinary replies, guided answers, steps, selection, pause and source scripts award no cards", async () => {
  const { store, revision } = await setupWork();
  const answered = await store.apply({ event_id: "save-only", expected_revision: revision, package_id: "vo-study", kind: "work_reply", step_id: "observe", text: "保存观察，还没有结束本轮" }, "owner");
  assert.equal(answered.doc.cinema.earned_cards?.length ?? 0, 0);
  const step = await store.apply({ event_id: "step-only", expected_revision: answered.revision, package_id: "vo-study", kind: "work_step", step_id: "explain" }, "owner");
  const paused = await store.apply(action({ event_id: "pause-only", expected_revision: step.revision, kind: "pause", package_id: null, text: undefined, paused: true }), "owner");
  const planned = await store.updateWorkplan(workplan({ event_id: "plan-only", expected_revision: paused.revision, packages: [] }));
  assert.equal(planned.doc.cinema.earned_cards?.length ?? 0, 0);
  assert.equal(planned.doc.paused, true);
  assert.equal(planned.doc.current_package_id, "vo-study");
  const plain = await setup();
  const reply = await plain.store.apply(action(), "owner");
  assert.equal(reply.doc.cinema.earned_cards?.length ?? 0, 0);
  const mailed = await plain.store.mergeMail(mail());
  assert.equal(mailed.doc.cinema.earned_cards?.length ?? 0, 0);
});

test("fact confirmation preserves all legacy cards but no longer issues a reward", async () => {
  const seed = fixture();
  const card = { event_id: "historical-confirm", card_id: FILM_DAYS[0].id, basis: "fact_confirmation" };
  seed.cinema.earned_cards = [card]; seed.cinema.earned_total = 1;
  const store = new StudioStore(new SqliteD1()); await store.importDocument(seed);
  const input = action({ kind: "confirm", text: "确认以上个人信息准确" });
  const confirmed = await store.apply(input, "owner");
  assert.deepEqual(confirmed.doc.cinema, seed.cinema);
  assert.equal((await store.apply(input, "owner")).doc.cinema.earned_cards.length, 1);
  assert.equal(confirmed.doc.current_package_id, "letter");
  const returned = await store.apply(action({ event_id: "return-confirmed", expected_revision: confirmed.revision, kind: "activate", text: undefined }), "owner");
  const repeat = await store.apply({ ...input, event_id: "confirm-again", expected_revision: returned.revision }, "owner");
  assert.deepEqual(repeat.doc.cinema, seed.cinema);
  const otherDevice = new StudioStore(store.db);
  assert.deepEqual((await otherDevice.snapshot()).doc.cinema.earned_cards, [card]);
  const refreshed = await store.updateWorkplan(workplan({ event_id: "plan-after-confirm", expected_revision: repeat.revision }));
  assert.deepEqual(refreshed.doc.cinema, seed.cinema);
  assert.equal(refreshed.doc.packages[0].facts[0].status, "confirmed");
});

test("a saved answer and session summary retain progress without issuing a movie card", async () => {
  const { store, revision } = await setupWork();
  const input = { event_id: "real-answer", expected_revision: revision, package_id: "vo-study", kind: "work_reply", step_id: "observe", text: "我观察到速度锥重合，但不能确定边界" };
  const answered = await store.apply(input, "owner");
  const finish = { ...input, event_id: "real-summary", expected_revision: answered.revision, kind: "work_finish", step_id: undefined, text: "今天写下了一个观察；边界问题留到下次" };
  const result = await store.apply(finish, "owner");
  assert.deepEqual(result.doc.cinema, fixture().cinema);
  assert.equal(result.doc.packages[2].work.completion_basis, "self_report");
  assert.equal(result.doc.packages[2].work.answers.observe.text, input.text);
  assert.equal(result.doc.packages[2].work.finish_summary, finish.text);
  assert.deepEqual(result.doc.packages.slice(0, 2), fixture().packages);
  assert.deepEqual(result.doc.packages[2].facts, []);
  assert.equal(result.doc.packages[2].done, undefined);
  assert.deepEqual((await store.apply(finish, "owner")).doc.cinema, fixture().cinema);
});

function milestoneEvidence(eventId, index = 0) {
  const definition = milestonesForPackage({ id: "iot", content: { kind: "guided_work", project_key: "iot-resnet" } })[index];
  return { key: milestoneKey(definition.project_key, definition.id), milestone_id: definition.id, project_key: definition.project_key, package_id: "iot", title: definition.title, criterion: definition.criterion, evidence: "模型与测量日志已保存，结果及条件见记录", completed_at: "2026-10-19T00:00:00Z", completed_by: "owner", basis: "owner_report", event_id: eventId };
}

async function setupMilestones() {
  const { store, db } = await setup();
  const current = guided(); current.content.project_key = "iot-resnet";
  const followup = guided("iot-followup"); followup.content.project_key = "iot-resnet";
  const registered = await store.updateWorkplan(workplan({ packages: [current, followup] }));
  const activated = await store.apply(action({ event_id: "choose-milestones", expected_revision: registered.revision, kind: "activate", package_id: current.id, text: undefined }), "owner");
  return { store, db, revision: activated.revision };
}

function academicTaskUpdate(revision, overrides={}) {
  return {event_id:"bind-academic-task",expected_revision:revision,tasks:[{package_id:"vo-study",expected_source_revision:0,task:{id:"school:100001:100002",kind:"assignment",title:"完成ResNet模型压缩、板端测量与报告",course_name:"物联网技术基础与应用开发",deliverables:["真实模型与测量产物","可交付报告"],sources:[{id:"assignment",title:"课程平台原始实验要求",url:"https://courses.example.edu/course/100001/learning-activity#/100002"},{id:"local",title:"本机作业目录",path:"/workspace/examples/assignments/iot"}],source_refs:["assignment","local"],due:{at:"2026-10-22T00:00:00+08:00",kind:"platform_deadline",source_id:"assignment"},workspace_path:"/workspace/examples/assignments/iot",scope_note:"新事项的要求与入口，不代表旧核状态目标完成等于作业完成。"}}],...overrides};
}

test("academic source binding preserves every legacy result, card and selected task while the actual assignment does not inherit completion",async()=>{
  const {store,revision}=await setupMilestones();
  const noted=await store.apply({event_id:"old-goal-progress",expected_revision:revision,kind:"progress_note",package_id:"vo-study",milestone_id:"baseline-reproduced",text:"旧目标保存的真实结果和记录位置"},"owner");
  const completed=await store.apply({event_id:"old-goal-complete",expected_revision:noted.revision,kind:"task_complete",package_id:"vo-study",text:"旧核状态目标已经完成"},"owner");
  const before=await store.snapshot();
  assert.equal(before.doc.packages[2].task_completion.status,"completed");
  assert.equal(before.doc.current_package_id,"iot-followup");
  const payload=academicTaskUpdate(completed.revision);
  payload.tasks[0].create_reference=true;
  const bound=await store.updateAcademicTasks(payload);
  const pkg=bound.doc.packages[2];
  assert.equal(bound.event.result.outcome,"academic_tasks_sources_updated");
  assert.deepEqual(bound.event.result.updated_package_ids,["vo-study"]);
  assert.deepEqual(bound.event.result.source_revisions,[{package_id:"vo-study",source_revision:1}]);
  assert.equal(pkg.academic_task.source_revision,1);
  assert.ok(Number.isFinite(Date.parse(pkg.academic_task.sourced_at)));
  assert.equal(academicTaskOf(pkg).title,payload.tasks[0].task.title);
  const unchanged=structuredClone(pkg);delete unchanged.academic_task;
  assert.deepEqual(unchanged,before.doc.packages[2]);
  assert.deepEqual(bound.doc.cinema,before.doc.cinema);
  assert.deepEqual(bound.doc.plan,before.doc.plan);
  assert.deepEqual(bound.doc.source_updates,before.doc.source_updates);
  assert.equal(bound.doc.current_package_id,before.doc.current_package_id);
  assert.deepEqual(packageProgress(pkg),{status:"not_started",label:"待完成",complete:false});
  assert.equal(packageProgress({...pkg,pending_review:true}).status,"pending_review");
  assert.equal((await store.updateAcademicTasks(payload)).idempotent,true);
  assert.equal((await store.snapshot()).revision,bound.revision);
  const refreshed=await store.updateWorkplan(workplan({event_id:"old-source-refresh-after-binding",expected_revision:bound.revision,packages:[Object.assign(guided(),{content:{...guided().content,project_key:"iot-resnet"}})]}));
  assert.deepEqual(refreshed.doc.packages[2],pkg);
});

test("academic source revisions use both CAS boundaries and archive source history without changing old content",async()=>{
  const {store,revision}=await setupWork();
  const first=await store.updateAcademicTasks(academicTaskUpdate(revision));
  const update=academicTaskUpdate(first.revision,{event_id:"academic-source-revision-2"});
  update.tasks[0].expected_source_revision=1;update.tasks[0].task.title="以教师修订要求完成整份实验";
  await assert.rejects(store.updateAcademicTasks({...update,expected_revision:revision}),/revision_conflict/);
  const staleSource=structuredClone(update);staleSource.tasks[0].expected_source_revision=0;
  await assert.rejects(store.updateAcademicTasks(staleSource),/academic_source_revision_conflict/);
  const second=await store.updateAcademicTasks(update);
  assert.equal(second.doc.packages[2].academic_task.source_revision,2);
  assert.deepEqual(second.doc.packages[2].academic_source_history,[first.doc.packages[2].academic_task]);
  assert.deepEqual(second.doc.packages[2].content,first.doc.packages[2].content);
  assert.equal(second.doc.packages[2].revision,first.doc.packages[2].revision);
  const changed=structuredClone(update);changed.tasks[0].task.title="同事件号换内容";
  await assert.rejects(store.updateAcademicTasks(changed),/reused_with_different_content/);
});

test("academic task source payload is strictly source-only and validates origins, paths, references and deadline provenance",async()=>{
  const {store,revision}=await setupWork();
  const invalid=[];
  for(const key of ["status","completion","evidence","progress_notes","task_completion","source_revision","sourced_at"]){const value=academicTaskUpdate(revision);value.tasks[0].task[key]="forged";invalid.push(value);}
  for(const change of [
    value=>{value.status="completed";},
    value=>{value.tasks[0].status="completed";},
    value=>{value.tasks[0].task.sources[0].status="verified";},
    value=>{value.tasks[0].task.sources[0].url="https://owner:secret@courses.example.edu/course/1";},
    value=>{value.tasks[0].task.sources[0].url="https://courses.example.edu/course/1?access_token=private";},
    value=>{value.tasks[0].task.sources[0].url="javascript:alert(1)";},
    value=>{value.tasks[0].task.sources[1].path="relative/path";},
    value=>{value.tasks[0].task.workspace_path="/workspace/examples/../private";},
    value=>{value.tasks[0].task.source_refs=["missing"];},
    value=>{value.tasks[0].task.source_refs=["assignment","assignment"];},
    value=>{value.tasks[0].task.due.at="2026-10-22T00:00:00";},
    value=>{value.tasks[0].task.due.source_id="local";},
    value=>{value.tasks[0].task.due.kind="none_verified";},
    value=>{value.tasks[0].task.due={at:null,kind:"platform_deadline",source_id:"assignment"};},
    value=>{value.tasks[0].task.deliverables=[];},
    value=>{value.tasks[0].task.deliverables=Array.from({length:7},()=>"too many");},
  ]){const value=academicTaskUpdate(revision);change(value);invalid.push(value);}
  for(const value of invalid)await assert.rejects(store.updateAcademicTasks(value));
  assert.equal((await store.snapshot()).revision,revision);
  const valid=academicTaskUpdate(revision);valid.tasks[0].task.kind="study";valid.tasks[0].task.due={at:null,kind:"none_verified"};
  const saved=await store.updateAcademicTasks(valid);
  assert.equal(saved.doc.packages[2].academic_task.kind,"study");
  assert.equal(packageProgress(saved.doc.packages[2]).label,"待完成");
});

test("academic mappings cannot create packages or bind research/fact work and failed batches leave no partial source update",async()=>{
  const {store,revision}=await setupTaskQueue();
  for(const package_id of ["does-not-exist","personal","other-research"]){const value=academicTaskUpdate(revision);value.tasks[0].package_id=package_id;await assert.rejects(store.updateAcademicTasks(value));}
  const batch=academicTaskUpdate(revision);batch.tasks.push({...structuredClone(batch.tasks[0]),package_id:"other-research"});
  await assert.rejects(store.updateAcademicTasks(batch),/academic_task_requires_academic_work/);
  const current=await store.snapshot();
  assert.equal(current.revision,revision);
  assert.equal(current.doc.packages[2].academic_task,undefined);
  assert.equal(current.doc.packages.length,5);
});

test("bound academic tasks reject legacy browser writes while selection pause and mode remain available",async()=>{
  const {store,revision}=await setupWork();
  const bound=await store.updateAcademicTasks(academicTaskUpdate(revision));
  for(const kind of ["task_complete","task_reopen","work_reply","work_finish","progress_note","milestone_complete"]){
    await assert.rejects(store.apply({event_id:`blocked-${kind}`,expected_revision:bound.revision,kind,package_id:"vo-study",step_id:"observe",milestone_id:"baseline-reproduced",text:"旧页面试图写入旧核状态目标"},"owner"),error=>error.message==="academic_work_managed_in_execution"&&error.status===409);
  }
  assert.deepEqual((await store.snapshot()).doc,bound.doc);
  const mode=await store.apply(action({event_id:"mode-bound-task",expected_revision:bound.revision,kind:"mode",package_id:null,text:undefined,mode:"focus"}),"owner");
  const paused=await store.apply(action({event_id:"pause-bound-task",expected_revision:mode.revision,kind:"pause",package_id:null,text:undefined,paused:true}),"owner");
  const selected=await store.apply(action({event_id:"activate-bound-task",expected_revision:paused.revision,kind:"activate",package_id:"personal",text:undefined}),"owner");
  assert.equal(selected.doc.current_package_id,"personal");
  assert.deepEqual(selected.doc.packages[2],bound.doc.packages[2]);
});

test("racing academic source changes commit exactly one source revision without losing old goal state",async()=>{
  const {store,db,revision}=await setupWork();
  const first=academicTaskUpdate(revision);
  const other=academicTaskUpdate(revision,{event_id:"other-academic-source"});other.tasks[0].task.title="另一处读取的作业说明";
  const results=await Promise.allSettled([store.updateAcademicTasks(first),store.updateAcademicTasks(other)]);
  assert.equal(results.filter(item=>item.status==="fulfilled").length,1);
  assert.equal(results.find(item=>item.status==="rejected").reason.message,"revision_conflict");
  const snapshot=await store.snapshot();
  assert.equal(snapshot.doc.packages[2].academic_task.source_revision,1);
  assert.equal(snapshot.doc.packages[2].work.status,"ready");
  assert.equal(snapshot.doc.packages[2].academic_source_history,undefined);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM events WHERE kind='academic_tasks'").get().n,1);
});

test("academic source history stops at thirty archived versions without discarding earlier source provenance",async()=>{
  const {store,revision}=await setupWork();
  let latest=await store.updateAcademicTasks(academicTaskUpdate(revision));
  for(let sourceRevision=1;sourceRevision<=30;sourceRevision++){
    const update=academicTaskUpdate(latest.revision,{event_id:`source-history-${sourceRevision}`});
    update.tasks[0].expected_source_revision=sourceRevision;
    update.tasks[0].task.scope_note=`来源修订说明${sourceRevision}`;
    latest=await store.updateAcademicTasks(update);
  }
  const pkg=latest.doc.packages[2];
  assert.equal(pkg.academic_task.source_revision,31);
  assert.equal(pkg.academic_source_history.length,30);
  assert.equal(pkg.academic_source_history[0].source_revision,1);
  const tooMany=academicTaskUpdate(latest.revision,{event_id:"source-history-over-limit"});
  tooMany.tasks[0].expected_source_revision=31;
  await assert.rejects(store.updateAcademicTasks(tooMany),/academic_source_history_limit_reached/);
  assert.deepEqual((await store.snapshot()).doc,latest.doc);
});

test("formal LMS assignments register as minimal source-only academic references without fabricated estimates or questions",async()=>{
  const {store}=await setup();
  const before=await store.snapshot();
  const payload=academicTaskUpdate(before.revision);
  payload.tasks[0].package_id="actual-lms-assignment";payload.tasks[0].create_reference=true;
  const created=await store.updateAcademicTasks(payload);
  const pkg=created.doc.packages.find(item=>item.id==="actual-lms-assignment");
  assert.deepEqual(pkg.content,{kind:"academic_work",domain:"academics",title:payload.tasks[0].task.title,fields:[]});
  assert.equal(pkg.revision,1);
  assert.deepEqual(pkg.facts,[]);
  for(const field of ["work","progress_notes","task_completion","task_completion_history"])assert.equal(pkg[field],undefined);
  for(const field of ["guide_steps","working_question","estimated_user_minutes","project_key"])assert.equal(pkg.content[field],undefined);
  assert.equal(academicTaskOf(pkg).source_revision,1);
  assert.deepEqual(packageProgress(pkg),{status:"not_started",label:"待完成",complete:false});
  assert.deepEqual(created.doc.packages.slice(0,2),before.doc.packages);
  assert.equal(created.doc.current_package_id,before.doc.current_package_id);
  assert.deepEqual(created.doc.cinema,before.doc.cinema);
  assert.equal((await store.updateAcademicTasks(payload)).idempotent,true);
  const revised=academicTaskUpdate(created.revision,{event_id:"revise-source-only-reference"});
  revised.tasks[0].package_id=pkg.id;revised.tasks[0].expected_source_revision=1;revised.tasks[0].create_reference=true;revised.tasks[0].task.title="修订后的真实作业要求";
  const updated=await store.updateAcademicTasks(revised);
  const next=updated.doc.packages.find(item=>item.id===pkg.id);
  assert.deepEqual(next.content,pkg.content);
  assert.equal(next.academic_task.title,"修订后的真实作业要求");
  assert.equal(next.academic_source_history[0].title,pkg.academic_task.title);
  assert.equal(next.work,undefined);
  const importedStore=new StudioStore(new SqliteD1());
  const roundtrip=await importedStore.importDocument(updated.doc);
  assert.deepEqual(roundtrip.doc.packages.find(item=>item.id===pkg.id),next);
});

test("reference creation cannot fabricate a study task, candidate assignment, unverified school source or owner state",async()=>{
  const {store}=await setup();
  const invalid=[];
  for(const kind of ["study","assignment_candidate"]){const value=academicTaskUpdate(1);value.tasks[0].package_id=`new-${kind}`;value.tasks[0].create_reference=true;value.tasks[0].task.kind=kind;invalid.push(value);}
  for(const change of [
    value=>{value.tasks[0].task.due={at:null,kind:"none_verified"};},
    value=>{delete value.tasks[0].task.due;},
    value=>{value.tasks[0].task.sources[0].url="https://external.example/course/1";},
    value=>{value.tasks[0].task.sources[0].url="https://example.edu.attacker.example/course/1";},
    value=>{value.tasks[0].task.sources[0].url="http://courses.example.edu/course/1";},
    value=>{value.tasks[0].task.domain="research";},
    value=>{value.tasks[0].work={status:"session_complete"};},
    value=>{value.tasks[0].task.status="completed";},
    value=>{value.tasks[0].expected_source_revision=1;},
    value=>{value.tasks[0].create_reference="true";},
  ]){const value=academicTaskUpdate(1);value.tasks[0].package_id="new-source-object";value.tasks[0].create_reference=true;change(value);invalid.push(value);}
  for(const value of invalid)await assert.rejects(store.updateAcademicTasks(value));
  assert.equal((await store.snapshot()).doc.packages.length,2);
  assert.equal((await store.snapshot()).revision,1);
});

test("source-only academic package import rejects owner progress, completion and fake task content",async()=>{
  const original=await setup();
  const payload=academicTaskUpdate(1);payload.tasks[0].package_id="new-reference";payload.tasks[0].create_reference=true;
  const created=await original.store.updateAcademicTasks(payload);
  for(const change of [
    pkg=>{pkg.work={status:"in_progress",answers:{a:{text:"伪造本人答案"}}};},
    pkg=>{pkg.progress_notes=[{text:"伪造本人进度"}];},
    pkg=>{pkg.task_completion={status:"completed",note:"伪造完成"};},
    pkg=>{pkg.content.domain="research";},
    pkg=>{pkg.content.estimated_user_minutes=30;},
    pkg=>{pkg.content.guide_steps=[{id:"fake",body:"人为补出的问答"}];},
    pkg=>{pkg.academic_task.status="completed";},
    pkg=>{pkg.academic_source_history={source_revision:0};},
  ]){
    const seed=structuredClone(created.doc);change(seed.packages[2]);
    await assert.rejects(new StudioStore(new SqliteD1()).importDocument(seed));
  }
  const activated=await original.store.apply(action({event_id:"select-source-reference",expected_revision:created.revision,kind:"activate",package_id:"new-reference",text:undefined}),"owner");
  const field={id:"fake-owner-fact",question:"把来源事项改回核状态",candidate:"未开始",source_refs:["school-source"]};
  await assert.rejects(original.store.updateMaterial({event_id:"cannot-replace-source-reference",expected_revision:activated.revision,expected_content_revision:1,package_id:"new-reference",content:{title:"不允许覆盖成事实问卷",confirm_phrase:"确认",source_refs:["school-source"],fields:[field]},facts:[{id:field.id,content:field,status:"pending"}],reviewed_reply_event_ids:[]}),/academic_work_is_not_fact_material/);
  for(const kind of ["reply","confirm","work_step","work_reply","work_finish","task_complete","task_reopen","progress_note","milestone_complete"]){
    await assert.rejects(original.store.apply({event_id:`forbidden-reference-${kind}`,expected_revision:activated.revision,kind,package_id:"new-reference",text:"不应写入本人状态",step_id:"none",milestone_id:"baseline-reproduced"},"owner"),/academic_work_managed_in_execution/);
  }
  assert.deepEqual((await original.store.snapshot()).doc,activated.doc);
});

test("plain academic progress notes append original text without rewards, completion, navigation or changes to old learning work", async () => {
  const { store, revision } = await setupMilestones();
  const answered = await store.apply({ event_id: "old-learning-answer", expected_revision: revision, kind: "work_reply", package_id: "vo-study", step_id: "observe", text: "此前保存的课件理解" }, "owner");
  const finished = await store.apply({ event_id: "old-learning-summary", expected_revision: answered.revision, kind: "work_finish", package_id: "vo-study", text: "此前的学习小结，仍有一个疑问" }, "owner");
  const before = await store.snapshot();
  const input = { event_id: "progress-only", expected_revision: finished.revision, kind: "progress_note", package_id: "vo-study", text: "  已在外部写好数据加载；下一步接测量脚本。  " };
  const saved = await store.apply(input, "owner");
  const pkg = saved.doc.packages[2], old = before.doc.packages[2];
  assert.equal(saved.event.result.outcome, "progress_note_saved");
  assert.equal(Object.hasOwn(saved.event.result,"milestone_id"), false);
  assert.equal(pkg.progress_notes.length, 1);
  assert.equal(pkg.progress_notes[0].text, input.text);
  assert.equal(pkg.progress_notes[0].event_id, input.event_id);
  assert.equal(pkg.progress_notes[0].saved_by,"owner");
  assert.equal(pkg.progress_notes[0].basis,"owner_report");
  assert.ok(Number.isFinite(Date.parse(pkg.progress_notes[0].saved_at)));
  assert.equal(pkg.revision,old.revision+1);
  assert.deepEqual(pkg.work,old.work);
  assert.equal(pkg.work.status,"session_complete");
  assert.deepEqual(pkg.content,old.content);
  assert.deepEqual(pkg.facts,old.facts);
  assert.equal(pkg.task_completion,undefined);
  assert.deepEqual(saved.doc.cinema,before.doc.cinema);
  assert.deepEqual(saved.doc.source_context,before.doc.source_context);
  assert.equal(saved.doc.current_package_id,before.doc.current_package_id);
  assert.equal(packageProgress(pkg).status,"in_progress");
  assert.equal(packageProgress({...pkg,task_completion:{status:"completed"}}).status,"completed");
  assert.equal(packageProgress({...pkg,pending_review:true}).status,"pending_review");
  const duplicate=await store.apply(input,"owner");
  assert.equal(duplicate.idempotent,true);
  assert.equal(duplicate.doc.packages[2].progress_notes.length,1);
});

test("an academic progress note can record one catalog milestone using the same original evidence in one commit", async () => {
  const {store,revision}=await setupMilestones();
  const before=await store.snapshot();
  const input={event_id:"progress-and-milestone",expected_revision:revision,kind:"progress_note",package_id:"vo-study",milestone_id:"baseline-reproduced",text:"baseline.json已保存模型条件和真实测量；本次基线可复现。"};
  const saved=await store.apply(input,"owner");
  const note=saved.doc.packages[2].progress_notes[0],record=saved.doc.cinema.milestones[0],card=saved.doc.cinema.earned_cards[0];
  assert.equal(saved.event.result.outcome,"progress_note_saved");
  assert.equal(saved.event.result.milestone_id,input.milestone_id);
  assert.equal(note.event_id,record.event_id);
  assert.equal(note.event_id,card.event_id);
  assert.equal(note.text,input.text);
  assert.equal(record.evidence,note.text);
  assert.equal(note.milestone_id,record.milestone_id);
  assert.equal(card.basis,"meaningful_milestone");
  assert.equal(saved.doc.current_package_id,before.doc.current_package_id);
  assert.deepEqual(saved.doc.packages[2].work,before.doc.packages[2].work);
  assert.equal(saved.doc.packages[2].task_completion,undefined);
  assert.equal((await store.apply(input,"owner")).doc.cinema.earned_cards.length,1);
  assert.equal((await store.snapshot()).doc.packages[2].progress_notes.length,1);
});

test("invalid or already collected optional milestones never partially save a progress note; plain fallback remains possible", async () => {
  const {store,revision}=await setupMilestones();
  const input={event_id:"first-progress-milestone",expected_revision:revision,kind:"progress_note",package_id:"vo-study",milestone_id:"baseline-reproduced",text:"真实基线测量结果已在记录中"};
  const saved=await store.apply(input,"owner");
  for(const [milestone_id,code] of [["baseline-reproduced","milestone_already_recorded"],["not-cataloged","milestone_not_available"]]) {
    await assert.rejects(store.apply({...input,event_id:`rejected-${milestone_id}`,expected_revision:saved.revision,milestone_id,text:"这句新进度不得部分写入"},"owner"),error=>error.message===code);
    const unchanged=await store.snapshot();
    assert.equal(unchanged.revision,saved.revision);
    assert.deepEqual(unchanged.doc,saved.doc);
  }
  const plain=await store.apply({...input,event_id:"save-progress-without-reward",expected_revision:saved.revision,milestone_id:undefined,text:"作为普通进度保留这句新记录"},"owner");
  assert.equal(plain.doc.packages[2].progress_notes.length,2);
  assert.equal(plain.doc.cinema.earned_cards.length,1);
  assert.equal(plain.doc.cinema.milestones.length,1);
});

test("progress notes enforce academics/current/reopen bounds and reject injected owner records", async () => {
  const plain=await setup();
  await assert.rejects(plain.store.apply(action({kind:"progress_note",text:"真实进度"}),"owner"),/progress_notes_require_academic_work/);
  const {store,revision}=await setupMilestones();
  const input={event_id:"bounded-progress",expected_revision:revision,kind:"progress_note",package_id:"vo-study",text:"已记录进度"};
  for(const text of [" ","x".repeat(3001)]) await assert.rejects(store.apply({...input,text},"owner"),/progress_note_text_required/);
  await assert.rejects(store.apply({...input,milestone_id:""},"owner"),/invalid_progress_milestone_id/);
  await assert.rejects(store.apply({...input,package_id:"iot-followup"},"owner"),/package_is_not_current/);
  const original=await store.snapshot();
  const research=structuredClone(original.doc); research.packages[2].content.domain="research";
  assert.throws(()=>reduceAction(research,input,"owner"),/progress_notes_require_academic_work/);
  const bounded=structuredClone(original.doc); bounded.packages[2].progress_notes=Array.from({length:200},(_,i)=>({event_id:`old-${i}`,text:"旧记录"}));
  assert.throws(()=>reduceAction(bounded,input,"owner"),/progress_note_history_limit_reached/);
  assert.equal(bounded.packages[2].progress_notes.length,200);
  const alias=structuredClone(original.doc); alias.packages[2].content.domain="courses";
  assert.equal(reduceAction(alias,input,"owner").outcome,"progress_note_saved");
  const forged=guided("forged-note"); forged.progress_notes=[{event_id:"fake",text:"来源脚本伪造的本人记录"}];
  await assert.rejects(store.updateWorkplan(workplan({event_id:"injected-progress",expected_revision:revision,packages:[forged]})),/cannot_contain_user_progress/);
  const seed=fixture();seed.packages.push(forged);
  await assert.rejects(new StudioStore(new SqliteD1()).importDocument(seed),/cannot_contain_user_progress/);
  const done=await store.apply({...input,event_id:"complete-before-note",kind:"task_complete",text:"实际任务已完成"},"owner");
  const back=await store.apply({...input,event_id:"back-before-note",kind:"activate",text:undefined,expected_revision:done.revision},"owner");
  await assert.rejects(store.apply({...input,expected_revision:back.revision},"owner"),/task_reopen_required/);
});

test("stale and racing progress notes preserve raw evidence with milestone metadata without overwriting successful records", async () => {
  const {store,revision}=await setupMilestones();
  const input={event_id:"device-progress-a",expected_revision:revision,kind:"progress_note",package_id:"vo-study",text:"设备一的外部工作进度"};
  const other={...input,event_id:"device-progress-b",milestone_id:"baseline-reproduced",text:"设备二的基线产出与结果"};
  const results=await Promise.allSettled([store.apply(input,"owner"),store.apply(other,"owner")]);
  assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
  const failure=results.find(result=>result.status==="rejected").reason;
  assert.equal(failure.message,"revision_conflict");
  assert.equal(failure.details.raw_preserved,true);
  const all=(await store.listEvents("vo-study")).events;
  const conflict=all.find(event=>event.kind==="conflict:progress_note");
  const losing=conflict.id===input.event_id?input:other;
  assert.equal(conflict.raw_text,losing.text);
  assert.equal(conflict.result.milestone_id,losing.milestone_id);
  const snapshot=await store.snapshot();
  assert.equal(snapshot.doc.packages[2].progress_notes.length,1);
  const stale={...other,event_id:"stale-progress-with-stage",text:"过期页面中尚未丢失的成果原话"};
  await assert.rejects(store.apply(stale,"owner"),/revision_conflict/);
  const savedConflict=(await store.listEvents("vo-study")).events.find(event=>event.id===stale.event_id);
  assert.equal(savedConflict.raw_text,stale.text);
  assert.equal(savedConflict.result.milestone_id,stale.milestone_id);
  assert.deepEqual((await store.snapshot()).doc,snapshot.doc);
  const refreshed=await store.updateWorkplan(workplan({event_id:"refresh-after-progress",expected_revision:snapshot.revision,packages:[Object.assign(guided(),{content:{...guided().content,project_key:"iot-resnet"}})]}));
  assert.deepEqual(refreshed.doc.packages[2],snapshot.doc.packages[2]);
});

test("only the nine registered guided projects expose outcome milestones; fact checking and unregistered work do not", () => {
  for (const project_key of ["sample-research", "research_topic", "paper_project", "demo_project", "computer-animation", "blockchain", "collaboration-pm", "collaboration-guide", "iot-resnet"]) {
    const pkg = { id: "test", content: { kind: "guided_work", project_key } };
    const catalog = milestonesForPackage(pkg);
    assert.ok(catalog.length >= 2 && catalog.length <= 4);
    assert.equal(new Set(catalog.map((item) => item.id)).size, catalog.length);
    assert.ok(catalog.every((item) => item.project_key === project_key && item.title && item.criterion));
  }
  assert.deepEqual(milestonesForPackage(fixture().packages[0]), []);
  assert.deepEqual(milestonesForPackage(guided()), []);
  assert.deepEqual(milestonesForPackage({ id: "unsafe", content: { kind: "guided_work", project_key: "__proto__" } }), []);
});

test("a catalog milestone stores real owner evidence and one linked card without changing task state or navigating", async () => {
  const { store, revision } = await setupMilestones();
  const before = await store.snapshot();
  const definition = milestonesForPackage(before.doc.packages[2])[0];
  const input = { event_id: "milestone-baseline", expected_revision: revision, kind: "milestone_complete", package_id: "vo-study", milestone_id: definition.id, text: "  baseline.json 保存了模型条件、实际精度与测量记录，结果供报告引用。  " };
  const saved = await store.apply(input, "owner");
  assert.equal(saved.event.result.outcome, "meaningful_milestone_recorded");
  assert.equal(saved.event.result.milestone_id, definition.id);
  assert.equal(saved.doc.current_package_id, before.doc.current_package_id);
  assert.deepEqual(saved.doc.packages, before.doc.packages);
  const record = milestoneStatus(saved.doc.cinema, saved.doc.packages[2], definition.id);
  assert.equal(record.key, `iot-resnet:${definition.id}`);
  assert.equal(record.evidence, input.text);
  assert.equal(record.criterion, definition.criterion);
  assert.equal(record.title, definition.title);
  assert.equal(record.basis, "owner_report");
  assert.equal(record.completed_by, "owner");
  assert.ok(Number.isFinite(Date.parse(record.completed_at)));
  const card = saved.doc.cinema.earned_cards[0];
  assert.equal(card.basis, "meaningful_milestone");
  assert.equal(card.milestone_id, definition.id);
  assert.equal(card.milestone_title, definition.title);
  assert.equal(card.package_id, "vo-study");
  assert.deepEqual((await store.apply(input,"owner")).doc.cinema,saved.doc.cinema);
  await assert.rejects(store.apply({...input,event_id:"repeat-stage",expected_revision:saved.revision},"owner"),/milestone_already_recorded/);
  for (const [event_id,milestone_id] of [["stale-duplicate-stage",definition.id],["stale-invalid-stage","not-in-catalog"]]) {
    const text = `保存失败时不能丢的证据：${event_id}`;
    await assert.rejects(store.apply({...input,event_id,milestone_id,text},"owner"),(error)=>error.message==="revision_conflict"&&error.details.raw_preserved===true);
    const event=(await store.listEvents("vo-study")).events.find((item)=>item.id===event_id);
    assert.equal(event.raw_text,text);
    assert.equal(event.result.milestone_id,milestone_id);
  }
  assert.deepEqual((await store.snapshot()).doc.cinema,saved.doc.cinema);
});

test("milestones require catalog membership and evidence; package variants, completion and reopen cannot farm a milestone", async () => {
  const plain = await setup();
  await assert.rejects(plain.store.apply(action({kind:"milestone_complete",milestone_id:"baseline-reproduced",text:"实际产出"}),"owner"),/milestones_require_guided_work/);
  const { store, revision } = await setupMilestones();
  const input = { event_id: "stage", expected_revision: revision, kind: "milestone_complete", package_id: "vo-study", milestone_id: "baseline-reproduced", text: "基线运行日志与结果已保存" };
  await assert.rejects(store.apply({...input,text:"  "},"owner"),/milestone_evidence_required/);
  await assert.rejects(store.apply({...input,text:"x".repeat(3001)},"owner"),/milestone_evidence_required/);
  await assert.rejects(store.apply({...input,milestone_id:"invented-easy-click"},"owner"),/milestone_not_available/);
  const done = await store.apply({...input,event_id:"task-done",kind:"task_complete",text:"已完成本人实际交付"},"owner");
  const back = await store.apply({...input,event_id:"back-to-completed",kind:"activate",text:undefined,expected_revision:done.revision},"owner");
  const stage = await store.apply({...input,expected_revision:back.revision},"owner");
  assert.equal(stage.doc.packages[2].task_completion.status,"completed");
  assert.equal(stage.doc.packages[2].work.status,"ready");
  const reopened = await store.apply({...input,event_id:"task-reopen",kind:"task_reopen",text:undefined,expected_revision:stage.revision},"owner");
  await assert.rejects(store.apply({...input,event_id:"repeat-after-reopen",expected_revision:reopened.revision},"owner"),/milestone_already_recorded/);
  const variant = await store.apply({...input,event_id:"same-project-variant",kind:"activate",package_id:"iot-followup",text:undefined,expected_revision:reopened.revision},"owner");
  await assert.rejects(store.apply({...input,event_id:"repeat-other-package",package_id:"iot-followup",expected_revision:variant.revision},"owner"),/milestone_already_recorded/);
  assert.equal((await store.snapshot()).doc.cinema.earned_cards.length,1);
  assert.equal((await store.snapshot()).doc.cinema.milestones.length,1);
});

test("racing milestone reports retain losing raw evidence and metadata; only fresh distinct milestones can earn again", async () => {
  const { store, revision } = await setupMilestones();
  const input = { event_id: "report-a", expected_revision: revision, kind: "milestone_complete", package_id: "vo-study", milestone_id: "baseline-reproduced", text: "设备一保存的真实基线证据" };
  const other = {...input,event_id:"report-b",text:"设备二的对照实验结果",milestone_id:"compression-comparison"};
  const results = await Promise.allSettled([store.apply(input,"owner"),store.apply(other,"owner")]);
  assert.equal(results.filter((result)=>result.status==="fulfilled").length,1);
  const failure = results.find((result)=>result.status==="rejected").reason;
  assert.equal(failure.message,"revision_conflict");
  assert.equal(failure.details.raw_preserved,true);
  const all = (await store.listEvents("vo-study")).events;
  const stale = all.find((event)=>event.kind==="conflict:milestone_complete");
  assert.ok(stale.raw_text);
  const losing = stale.id === input.event_id ? input : other;
  assert.equal(stale.raw_text,losing.text);
  assert.equal(stale.result.milestone_id,losing.milestone_id);
  const beforeRetry=await store.snapshot();
  assert.equal(beforeRetry.doc.cinema.earned_cards.length,1);
  const retried=await store.apply({...losing,event_id:"fresh-distinct-report",expected_revision:beforeRetry.revision},"owner");
  assert.equal(retried.doc.cinema.earned_cards.length,2);
  assert.equal(retried.doc.cinema.milestones.length,2);
  assert.deepEqual(retried.doc.packages,beforeRetry.doc.packages);
});

test("cinema selection requires a meaningful milestone and preserves legacy cards and unique fallback", () => {
  const daily = FILM_DAYS[0];
  const midnight = new Date(`${daily.date}T00:01:00+08:00`);
  const original = { anchor_date: "2026-12-16", custom_rewards: [{ id: "client-invented-card" }] };
  for (const basis of ["fact_confirmation", "work_session_self_report", "task_completion_owner_report"]) {
    assert.deepEqual(earnCinemaCard(original, "legacy-attempt", basis, midnight).cinema, original);
  }
  assert.equal(earnCinemaCard(original,"missing-context","meaningful_milestone",midnight).earned_card,null);
  const first = earnCinemaCard(original, "stage-a", "meaningful_milestone", midnight, undefined, milestoneEvidence("stage-a"));
  assert.equal(first.earned_card.card_id, daily.id);
  assert.equal(first.earned_card.earned_day, daily.date);
  assert.equal(first.earned_card.earned_at, midnight.toISOString());
  assert.equal(first.earned_card.milestone_id, milestoneEvidence("stage-a").milestone_id);
  assert.equal(first.earned_card.milestone_title, milestoneEvidence("stage-a").title);
  assert.equal(original.earned_cards, undefined);
  const second = earnCinemaCard(first.cinema, "stage-b", "meaningful_milestone", midnight, undefined, milestoneEvidence("stage-b",1));
  assert.notEqual(second.earned_card.card_id, daily.id);
  assert.equal(second.cinema.earned_total, 2);
  assert.deepEqual(earnCinemaCard(second.cinema, "stage-a", "meaningful_milestone", midnight, undefined, milestoneEvidence("stage-a")).cinema, second.cinema);
  assert.deepEqual(earnCinemaCard(second.cinema, "different-event-same-stage", "meaningful_milestone", midnight, undefined, milestoneEvidence("different-event-same-stage")).cinema, second.cinema);
  const all = [...new Map([...FILM_DAYS, ...MOVIE_REWARDS].map((card) => [card.id, card])).values()];
  const full = { anchor_date: "2026-12-16", earned_cards: all.map((card, index) => ({ event_id: `event-${index}`, card_id: card.id })), earned_total: all.length };
  const exhausted = earnCinemaCard(full, "after-season", "meaningful_milestone", new Date("2027-03-01T00:00:00Z"), undefined, milestoneEvidence("after-season"));
  assert.equal(exhausted.earned_card, null);
  assert.deepEqual(exhausted.cinema.earned_cards, full.earned_cards);
  assert.equal(exhausted.cinema.milestones.length,1);
  const capacity = { earned_cards: Array.from({ length: CINEMA_COLLECTION_CAPACITY }, (_, index) => ({ event_id: `old-${index}`, card_id: `legacy-${index}` })), earned_total: CINEMA_COLLECTION_CAPACITY };
  const capped = earnCinemaCard(capacity, "over-capacity", "meaningful_milestone", midnight, undefined, milestoneEvidence("over-capacity"));
  assert.deepEqual(capped.cinema.earned_cards,capacity.earned_cards);
  assert.equal(capped.earned_card,null);
  assert.equal(capped.cinema.milestones.length,1);
});

test("an exhausted collection earns validated editorial additions for new milestones but not unsafe cards", () => {
  const known = [...new Map([...FILM_DAYS, ...MOVIE_REWARDS].map((card) => [card.id, card])).values()];
  const collection = { earned_cards: known.map((card, index) => ({ card_id: card.id, event_id: `existing-${index}` })), earned_total: known.length };
  const good = { id: "curated-new-card", title: "已核新增幕后", text: "有来源的编辑补充。", source_label: "官方资料", source_url: "https://www.pixar.com/soul", category: "sound" };
  const bad = { ...good, id: "unsafe-card", source_url: "javascript:alert(1)" };
  const now = new Date("2027-03-01T00:00:00Z");
  assert.equal(earnCinemaCard(collection, "bad-only", "meaningful_milestone", now, [bad], milestoneEvidence("bad-only")).earned_card, null);
  const added = earnCinemaCard(collection, "new-earned", "meaningful_milestone", now, [bad, good],milestoneEvidence("new-earned"));
  assert.equal(added.earned_card.card_id, good.id);
  assert.equal(added.cinema.earned_total, known.length + 1);
  assert.equal(added.cinema.earned_cards.some((card) => card.card_id === bad.id), false);
});

test("GET-style snapshots do not create or change a workspace", async () => {
  const db = new SqliteD1();
  const store = new StudioStore(db);
  assert.deepEqual(await store.snapshot(), { initialized: false, doc: null, revision: 0, saved_at: null, events: [] });
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM documents").get().n, 0);
});

test("single initialization is checksum-idempotent and never overwrites later work", async () => {
  const { store } = await setup();
  const saved = await store.apply(action(), "owner");
  const retry = await store.importDocument(fixture(), await checksum(fixture()));
  assert.equal(retry.revision, saved.revision);
  assert.equal(retry.events[0].raw_text, action().text);
  const other = fixture(); other.mode = "focus";
  await assert.rejects(store.importDocument(other), /different_content/);
  await assert.rejects(store.importDocument(fixture(), "0".repeat(64)), /checksum_mismatch/);
});

test("free text is preserved separately and cannot confirm or rewrite facts", async () => {
  const { store } = await setup();
  const result = await store.apply(action({ text: "确认以上个人信息准确" }), "owner");
  assert.equal(result.event.result.outcome, "reply_pending_review");
  assert.equal(result.doc.packages[0].facts[0].status, "pending");
  assert.equal(result.event.raw_text, "确认以上个人信息准确");
  assert.equal(result.doc.packages[0].pending_review, true);
});

test("explicit confirmation needs the exact current phrase", async () => {
  const { store } = await setup();
  await assert.rejects(store.apply(action({ kind: "confirm", text: "大概没错" }), "owner"), /confirmation_phrase/);
  const result = await store.apply(action({ kind: "confirm", text: "确认以上个人信息准确" }), "owner");
  assert.equal(result.doc.packages[0].facts[0].status, "confirmed");
  assert.equal(result.doc.packages[0].facts[0].confirmed_by, "owner");
  assert.equal(result.doc.packages[1].facts[0].status, "pending");
});

test("missing phrase and wrong package cannot confirm", async () => {
  const seed = fixture(); delete seed.packages[0].content.confirm_phrase;
  const db = new SqliteD1(); const store = new StudioStore(db); await store.importDocument(seed);
  await assert.rejects(store.apply(action({ kind: "confirm", text: "确认" }), "owner"), /confirmation_phrase/);
  await assert.rejects(store.apply(action({ kind: "confirm", package_id: "letter", text: "确认课程事实" }), "owner"), /not_current/);
});

test("same event retries once; changing content or actor under its ID fails", async () => {
  const { db, store } = await setup();
  await store.apply(action(), "owner");
  const duplicate = await store.apply(action(), "owner");
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.revision, 2);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM events").get().n, 1);
  await assert.rejects(store.apply(action({ text: "changed" }), "owner"), /reused/);
  await assert.rejects(store.apply(action(), "different-user"), /reused/);
});

test("concurrent actions produce one change and preserve losing raw text as a conflict", async () => {
  const { db, store } = await setup();
  const results = await Promise.allSettled([
    store.apply(action({ event_id: "a", text: "first raw" }), "owner"),
    store.apply(action({ event_id: "b", text: "second raw" }), "owner"),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  const rejected = results.find((item) => item.status === "rejected").reason;
  assert.equal(rejected.message, "revision_conflict");
  assert.equal(rejected.details.raw_preserved, true);
  assert.equal((await store.snapshot()).revision, 2);
  const events = db.db.prepare("SELECT kind,raw_text FROM events").all();
  assert.equal(events.filter((event) => event.kind === "reply").length, 1);
  assert.equal(events.filter((event) => event.kind === "conflict:reply").length, 1);
  assert.deepEqual(new Set(events.map((event) => event.raw_text)), new Set(["first raw", "second raw"]));
});

test("simultaneous same-ID requests are idempotent, not duplicate events", async () => {
  const { db, store } = await setup();
  const results = await Promise.all([store.apply(action(), "owner"), store.apply(action(), "owner")]);
  assert.equal(results.length, 2);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM events").get().n, 1);
  assert.equal((await store.snapshot()).revision, 2);
});

test("activate preserves previous packages and pause is real shared state", async () => {
  const { store } = await setup();
  let result = await store.apply(action({ kind: "activate", package_id: "letter", text: undefined }), "owner");
  assert.equal(result.doc.current_package_id, "letter");
  assert.equal(result.doc.packages.length, 2);
  result = await store.apply(action({ event_id: "pause", expected_revision: result.revision, kind: "pause", package_id: null, paused: true, text: undefined }), "owner");
  assert.equal(result.doc.paused, true);
});

test("source refresh touches only source_context and refuses older observations", async () => {
  const { store } = await setup();
  const input = { event_id: "source", source_context: { text: "fresh evidence" }, observed_at: "2026-01-03T00:00:00Z" };
  const updated = await store.updateSource(input);
  assert.deepEqual(updated.doc.packages, fixture().packages);
  assert.deepEqual(updated.doc.cinema, fixture().cinema);
  assert.equal(updated.doc.source_context.text, "fresh evidence");
  assert.equal((await store.updateSource(input)).idempotent, true);
  await assert.rejects(store.updateSource({ ...input, event_id: "older", observed_at: "2026-01-02T00:00:00Z" }), /not_newer/);
});

test("mail exact current explicit phrase confirms; duplicate source IDs do not reapply", async () => {
  const { db, store } = await setup();
  const result = await store.mergeMail(mail());
  assert.equal(result.doc.packages[0].facts[0].status, "confirmed");
  assert.equal(result.event.result.outcome, "mail_explicit_fact_group_confirmed");
  assert.equal(result.event.result.source_message_id, mail().source_message_id);
  const duplicate = await store.mergeMail(mail({ event_id: "different-event-same-email" }));
  assert.equal(duplicate.idempotent, true);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM events").get().n, 1);
});

test("mail stale revision, quote or old package stays pending without overwriting current material", async () => {
  for (const changes of [{ package_revision: 99 }, { package_revision: undefined }, { raw_text: "确认以上个人信息准确\n> quoted message" }]) {
    const { store } = await setup();
    const result = await store.mergeMail(mail(changes));
    assert.equal(result.doc.packages[0].facts[0].status, "pending");
    assert.equal(result.event.result.outcome, "mail_reply_pending_review");
    assert.equal(result.event.raw_text, mail(changes).raw_text);
  }
  const { store } = await setup();
  await store.apply(action({ kind: "activate", package_id: "letter", text: undefined }), "owner");
  const result = await store.mergeMail(mail());
  assert.equal(result.doc.current_package_id, "letter");
  assert.equal(result.doc.packages[0].facts[0].status, "pending");
});

test("mail merge and browser pause both survive a race without snapshot overwrite", async () => {
  const { store } = await setup();
  const results = await Promise.allSettled([
    store.apply(action({ kind: "pause", package_id: null, paused: true, text: undefined }), "owner"),
    store.mergeMail(mail({ raw_text: "新增一段经历", confirmation_phrase: undefined })),
  ]);
  assert.equal(results[1].status, "fulfilled");
  // If mail wins CAS, the browser must refresh and explicitly retry its pause
  // under a new event ID. A stale browser write cannot silently overwrite it.
  if (results[0].status === "rejected") {
    assert.equal(results[0].reason.message, "revision_conflict");
    const fresh = await store.snapshot();
    await store.apply(action({ event_id: "pause-after-refresh", expected_revision: fresh.revision, kind: "pause", package_id: null, paused: true, text: undefined }), "owner");
  }
  const snapshot = await store.snapshot();
  assert.equal(snapshot.doc.paused, true);
  assert.equal(snapshot.events.some((event) => event.raw_text === "新增一段经历"), true);
  assert.deepEqual(snapshot.doc.packages.map((pkg) => pkg.content), fixture().packages.map((pkg) => pkg.content));
  assert.deepEqual(snapshot.doc.packages.map((pkg) => pkg.facts), fixture().packages.map((pkg) => pkg.facts));
  assert.equal(snapshot.doc.packages[0].pending_review, true);
});

test("new correction after confirmation retains history and exposes durable review work", async () => {
  const { db, store } = await setup();
  const confirmed = await store.apply(action({ kind: "confirm", text: "确认以上个人信息准确" }), "owner");
  const returned = await store.apply(action({ event_id: "return-for-correction", expected_revision: confirmed.revision, kind: "activate", text: undefined }), "owner");
  const result = await store.apply(action({ event_id: "correction", expected_revision: returned.revision, text: "毕业时间改为7月" }), "owner");
  assert.equal(result.doc.packages[0].facts[0].status, "confirmed");
  assert.equal(result.doc.packages[0].pending_review, true);
  assert.equal(result.doc.packages[0].pending_reply_event_ids.includes("correction"), true);
  // Conflict review evidence also survives when it falls out of the timeline.
  await assert.rejects(store.apply(action({ event_id: "old-correction", text: "旧页里的另一个修改" }), "owner"), /revision_conflict/);
  for (let i = 0; i < 35; i++) {
    db.db.prepare("INSERT INTO events VALUES (?,NULL,'source','',1,?,?)").run(`noise-${i}`, "2099-01-01T00:00:00Z", JSON.stringify({ outcome: "source_context_updated" }));
  }
  const snapshot = await store.snapshot();
  assert.equal(snapshot.events.some((event) => event.id === "old-correction"), false);
  assert.equal(snapshot.doc.packages[0].pending_reply_event_ids.includes("old-correction"), true);
});

test("only the explicit mail pause whitelist changes shared pause state", async () => {
  for (const phrase of ["暂停", "先暂停", "今天不处理", "今天先暂停", "今天先不处理"]) {
    const { store } = await setup();
    const saved = await store.mergeMail(mail({ raw_text: ` ${phrase} `, confirmation_phrase: undefined }));
    assert.equal(saved.doc.paused, true);
    assert.equal(saved.event.result.outcome, "mail_explicit_pause");
    assert.equal(saved.event.raw_text, ` ${phrase} `);
  }
  const { store } = await setup();
  const saved = await store.mergeMail(mail({ raw_text: "暂停一下，然后替我发邮件", confirmation_phrase: undefined }));
  assert.equal(saved.doc.paused, false);
  assert.equal(saved.event.result.outcome, "mail_reply_pending_review");
});

test("a stale confirmation remains auditable without inventing pending factual edits", async () => {
  const { store } = await setup();
  const changed = await store.apply(action({ kind: "mode", package_id: null, mode: "focus", text: undefined }), "owner");
  await assert.rejects(store.apply(action({ event_id: "stale-confirm", kind: "confirm", text: "确认以上个人信息准确" }), "owner"), /revision_conflict/);
  const result = await store.apply(action({ event_id: "fresh-confirm", expected_revision: changed.revision, kind: "confirm", text: "确认以上个人信息准确" }), "owner");
  assert.equal(result.doc.packages[0].facts[0].status, "confirmed");
  assert.equal(result.doc.packages[0].pending_review, undefined);
  assert.equal(result.events.some((event) => event.kind === "conflict:confirm"), true);
});

function material(snapshot, overrides = {}) {
  const field = { id: "name", question: "这样写准确吗？", candidate: "新版候选", source_refs: ["event:correction"] };
  return {
    event_id: "material-1", expected_revision: snapshot.revision, package_id: "personal", expected_content_revision: 1,
    content: { title: "按原话修订的个人信息", confirm_phrase: "确认新版个人信息准确", source_refs: ["event:correction"],
      fields: [field] },
    facts: [{ id: "name", content: structuredClone(field), status: "pending" }], reviewed_reply_event_ids: ["correction"], ...overrides,
  };
}

async function correctedSetup() {
  const { store, db } = await setup();
  const confirmed = await store.apply(action({ event_id: "confirmed", kind: "confirm", text: "确认以上个人信息准确" }), "owner");
  const returned = await store.apply(action({ event_id: "return-to-material", expected_revision: confirmed.revision, kind: "activate", text: undefined }), "owner");
  const snapshot = await store.apply(action({ event_id: "correction", expected_revision: returned.revision, text: "毕业时间改为7月" }), "owner");
  return { store, db, snapshot };
}

test("material creates pending candidates, keeps confirmed history and touches only its package", async () => {
  const { store, snapshot } = await correctedSetup();
  const input = material(snapshot);
  input.content.fields[0].status = "confirmed";
  input.content.fields[0].confirmed_by = "forged";
  const result = await store.updateMaterial(input);
  const pkg = result.doc.packages[0];
  assert.equal(result.revision, snapshot.revision + 1);
  assert.equal(pkg.content.revision, 2);
  assert.equal(pkg.facts[0].status, "pending");
  assert.equal(pkg.facts[0].confirmed_by, null);
  assert.equal(typeof pkg.facts[0].content, "object");
  assert.deepEqual(pkg.facts[0].content, pkg.content.fields[0]);
  assert.equal(pkg.facts[0].content.candidate, "新版候选");
  assert.equal(pkg.content.fields[0].status, "pending");
  assert.equal(pkg.content.fields[0].confirmed_by, undefined);
  assert.equal(pkg.history[0].facts[0].status, "confirmed");
  assert.equal(pkg.history[0].facts[0].confirmed_by, "owner");
  assert.deepEqual(pkg.history[0].content, snapshot.doc.packages[0].content);
  assert.equal(pkg.pending_review, false);
  assert.deepEqual(pkg.reviewed_reply_event_ids, ["correction"]);
  assert.equal(result.doc.current_package_id, snapshot.doc.current_package_id);
  assert.equal(result.doc.paused, snapshot.doc.paused);
  assert.deepEqual(result.doc.source_context, snapshot.doc.source_context);
  assert.deepEqual(result.doc.packages[1], snapshot.doc.packages[1]);
  assert.deepEqual((await store.updateMaterial(input)).doc, result.doc);
  assert.equal((await store.snapshot()).doc.packages[0].history.length, 1);
});

test("material resolves only reviewed events and retains later replies for more review", async () => {
  const { store, snapshot } = await correctedSetup();
  const second = await store.apply(action({ event_id: "second-correction", expected_revision: snapshot.revision, text: "还有一个专业名要核对" }), "owner");
  const result = await store.updateMaterial(material(second));
  assert.equal(result.doc.packages[0].pending_review, true);
  assert.deepEqual(result.doc.packages[0].pending_reply_event_ids, ["second-correction"]);
  const facts = result.doc.packages[0].facts;
  assert.equal(facts.every((fact) => fact.status === "pending"), true);
  assert.equal((await store.event("correction")).raw_text, "毕业时间改为7月");
});

test("material refuses unseen, cross-package, confirmation and unsupported reviewed events", async () => {
  for (const invalidId of ["not-seen", "confirmed"]) {
    const { store, snapshot } = await correctedSetup();
    const input = material(snapshot, { reviewed_reply_event_ids: [invalidId] });
    input.content.source_refs = [`event:${invalidId}`];
    await assert.rejects(store.updateMaterial(input), /invalid_reviewed_reply_event/);
    assert.equal((await store.snapshot()).revision, snapshot.revision);
  }
  const { db, store, snapshot } = await correctedSetup();
  db.db.prepare("INSERT INTO events VALUES ('other','letter','reply','other raw',1,'2026-01-01T00:00:00Z',?)").run(JSON.stringify({ outcome: "reply_pending_review" }));
  const input = material(snapshot, { reviewed_reply_event_ids: ["other"] });
  input.content.source_refs = ["event:other"];
  await assert.rejects(store.updateMaterial(input), /invalid_reviewed_reply_event/);
});

test("material cannot forge confirmed facts, omit evidence, or mismatch displayed and confirmed candidates", async () => {
  for (const change of [
    (value) => { value.facts[0].status = "confirmed"; },
    (value) => { value.facts[0].confirmed_by = "owner"; },
    (value) => { value.facts[0].content.candidate = "a different hidden assertion"; },
    (value) => { value.content.source_refs = ["an unrelated source"]; },
    (value) => { value.content.fields[0].source_refs = []; },
  ]) {
    const { store, snapshot } = await correctedSetup();
    const input = material(snapshot); change(input);
    await assert.rejects(store.updateMaterial(input));
    assert.equal((await store.snapshot()).revision, snapshot.revision);
  }
});

test("material uses both workspace and content CAS and never consumes replies on a lost race", async () => {
  const { db, store, snapshot } = await correctedSetup();
  await assert.rejects(store.updateMaterial(material(snapshot, { expected_content_revision: 99 })), /content_revision_conflict/);
  await store.apply(action({ event_id: "pause-before-material", expected_revision: snapshot.revision, kind: "pause", package_id: null, paused: true, text: undefined }), "owner");
  await assert.rejects(store.updateMaterial(material(snapshot)), /revision_conflict/);
  const current = await store.snapshot();
  assert.equal(current.doc.paused, true);
  assert.equal(current.doc.packages[0].pending_review, true);
  assert.equal(current.doc.packages[0].history, undefined);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM events WHERE kind='material'").get().n, 0);
});

test("an old mail confirmation cannot approve new material with a newer content revision", async () => {
  const { store, snapshot } = await correctedSetup();
  const input = material(snapshot);
  input.content.confirm_phrase = "确认以上个人信息准确";
  await store.updateMaterial(input);
  const result = await store.mergeMail(mail());
  assert.equal(result.event.result.outcome, "mail_reply_pending_review");
  assert.equal(result.doc.packages[0].facts[0].status, "pending");
});

test("event paging retrieves all raw replies beyond the timeline without duplicates or cross-package leakage", async () => {
  const { db, store } = await setup();
  for (let i = 0; i < 73; i++) {
    db.db.prepare("INSERT INTO events VALUES (?,?,'reply',?,1,'2026-01-01T00:00:00Z',?)").run(`page-${i}`, "personal", `raw-${i}`, JSON.stringify({ outcome: "reply_pending_review" }));
  }
  db.db.prepare("INSERT INTO events VALUES ('private-other','letter','reply','other material',1,'2026-01-01T00:00:00Z',?)").run(JSON.stringify({ outcome: "reply_pending_review" }));
  const collected = [];
  let cursor = null;
  do {
    const page = await store.listEvents("personal", cursor, 17);
    assert.equal(page.events.length <= 17, true);
    collected.push(...page.events);
    cursor = page.next_cursor;
  } while (cursor);
  assert.equal(collected.length, 73);
  assert.equal(new Set(collected.map((event) => event.id)).size, 73);
  assert.equal(collected[72].raw_text, "raw-72");
  assert.equal(collected.some((event) => event.package_id !== "personal"), false);
  const first = await store.listEvents("personal", null, 17);
  await assert.rejects(store.listEvents("letter", first.next_cursor, 17), /invalid_event_cursor/);
  await assert.rejects(store.listEvents("personal", "bad cursor", 17), /invalid_event_cursor/);
  await assert.rejects(store.listEvents("personal", null, 101), /invalid_event_page/);
});

test("material roundtrip satisfies the real page validator and confirmed-copy contract", async () => {
  const { store, snapshot } = await correctedSetup();
  const contract = frontendContract();
  assert.equal(contract.isSnapshot(snapshot), true);
  const updated = await store.updateMaterial(material(snapshot));
  assert.equal(contract.isSnapshot(updated), true);
  const confirmed = await store.apply(action({ event_id: "confirm-material", expected_revision: updated.revision, kind: "confirm", text: "确认新版个人信息准确" }), "owner");
  assert.equal(contract.isSnapshot(confirmed), true);
  const fact = confirmed.doc.packages[0].facts[0];
  assert.equal(contract.text(fact.content.candidate), "新版候选");
  assert.equal(fact.content.question, "这样写准确吗？");
  assert.deepEqual(fact.content.source_refs, ["event:correction"]);
});

test("full-Field input validates id and source references; legacy bare input still stores a full Field", async () => {
  for (const mutate of [(value) => { value.facts[0].content.id = "hidden-id"; }, (value) => { value.facts[0].content.source_refs = ["different-source"]; }]) {
    const { store, snapshot } = await correctedSetup();
    const input = material(snapshot); mutate(input);
    await assert.rejects(store.updateMaterial(input), /match_fields/);
  }
  const { store, snapshot } = await correctedSetup();
  const input = material(snapshot);
  input.facts[0].content = input.content.fields[0].candidate;
  const result = await store.updateMaterial(input);
  assert.deepEqual(result.doc.packages[0].facts[0].content, result.doc.packages[0].content.fields[0]);
  assert.equal(frontendContract().isSnapshot(result), true);
});

test("optional real seed stays private and roundtrips only in memory", { skip: !process.env.STUDIO_SEED_PATH }, async () => {
  const before = readFileSync(process.env.STUDIO_SEED_PATH, "utf8");
  const seed = JSON.parse(before);
  const store = new StudioStore(new SqliteD1());
  await store.importDocument(seed.document, seed.checksum);
  const initial = await store.snapshot();
  const pkg = initial.doc.packages.find((item) => item.id === initial.doc.current_package_id);
  const replied = await store.apply({ event_id: "test-only-real-seed-reply", expected_revision: initial.revision, kind: "reply", package_id: pkg.id, text: "仅内存回归演练原话，不是实际用户回复" }, "test-owner");
  const content = structuredClone(pkg.content);
  content.fields[0].candidate = "仅内存回归候选，不是实际材料";
  content.source_refs = ["event:test-only-real-seed-reply"];
  const updated = await store.updateMaterial({ event_id: "test-only-real-seed-material", expected_revision: replied.revision, expected_content_revision: pkg.content.revision, package_id: pkg.id,
    content, facts: content.fields.map((field) => ({ id: field.id, content: structuredClone(field), status: "pending", confirmed_by: null })), reviewed_reply_event_ids: ["test-only-real-seed-reply"] });
  const contract = frontendContract();
  assert.equal(contract.isSnapshot(initial), true);
  assert.equal(contract.isSnapshot(updated), true);
  const upgraded = updated.doc.packages.find((item) => item.id === pkg.id);
  assert.equal(upgraded.facts.every((fact) => typeof fact.content === "object" && "candidate" in fact.content), true);
  assert.equal(contract.text(upgraded.facts.find((fact) => fact.id === content.fields[0].id).content.candidate), content.fields[0].candidate);
  assert.equal(readFileSync(process.env.STUDIO_SEED_PATH, "utf8"), before);
});
