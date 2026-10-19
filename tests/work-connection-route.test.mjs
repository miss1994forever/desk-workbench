import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const data = source => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true });
globalThis.__connectionHeaders = new Headers();
globalThis.__connectionEnv = {};
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return data("export const env = globalThis.__connectionEnv;");
  if (specifier === "next/headers") return data("export async function headers(){return globalThis.__connectionHeaders;}");
  if (specifier === "next/navigation") return data("export function redirect(){throw new Error('redirect');}");
  if (specifier.startsWith("@/")) return { url: pathToFileURL(resolve(root, specifier.slice(2) + ".ts")).href, shortCircuit: true };
  if (specifier.startsWith(".") && !extname(specifier) && context.parentURL?.endsWith(".ts")) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { POST, GET } = await import("../app/mcp/route.ts");
const { POST: servicePOST } = await import("../app/api/system/work-connection/route.ts");
const { GET: launchGET } = await import("../app/api/work/launch/route.ts");
const { StudioStore } = await import("../lib/studio-store.ts");
const { WORK_TOOLS } = await import("../lib/work-connection.ts");

class D1 {
  constructor() { this.db = new DatabaseSync(":memory:"); this.db.exec("CREATE TABLE documents(id TEXT PRIMARY KEY,body TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE events(id TEXT PRIMARY KEY,package_id TEXT,kind TEXT NOT NULL,raw_text TEXT NOT NULL,base_revision INTEGER NOT NULL,created_at TEXT NOT NULL,result TEXT NOT NULL);"); }
  prepare(sql) { const owner = this; return { values: [], bind(...values) { return { ...this, values }; }, async first() { return owner.db.prepare(sql).get(...this.values) ?? null; }, async all() { return { results: owner.db.prepare(sql).all(...this.values) }; }, async run() { return { meta: { changes: Number(owner.db.prepare(sql).run(...this.values).changes) } }; } }; }
  async batch(statements) { this.db.exec("BEGIN"); try { const result = []; for (const s of statements) result.push(await s.run()); this.db.exec("COMMIT"); return result; } catch (error) { this.db.exec("ROLLBACK"); throw error; } }
}
function request(body, headers = {}) { return new Request("https://desk.example/mcp", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }); }
async function call(name, args = {}, id = 1) { return POST(request({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })); }
function owner() { globalThis.__connectionHeaders = new Headers({ "oai-authenticated-user-id": "fixture-owner", "oai-authenticated-user-email": "owner@example.test" }); }

test("MCP discovery is stateless and contains no owner data, private calls require identity", async () => {
  globalThis.__connectionHeaders = new Headers(); delete globalThis.__connectionEnv.DB;
  const init = await POST(request({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }));
  assert.equal((await init.json()).result.protocolVersion, "2025-06-18");
  const list = await POST(request({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
  const body = await list.json(); assert.equal(body.result.tools.length, 7); assert(!JSON.stringify(body).includes("owner@example"));
  assert.equal((await call("list_work")).status, 401);
  assert.equal((await GET()).status, 405);
  assert.equal((await POST(request({ jsonrpc: "2.0", method: "notifications/initialized" }))).status, 202);
});
test("connection endpoints preserve browser and service access boundaries", async () => {
  owner(); delete globalThis.__connectionEnv.DB;
  const body = { name: "list_work", arguments: {} };
  const s = await servicePOST(request(body, { Origin: "https://desk.example" })); assert.equal(s.status, 403);
  const m = await POST(request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_work" } }, { Origin: "https://untrusted.example" })); assert.equal(m.status, 403);
});
test("MCP reads and writes the real shared store, replays safely and preserves other task data", async () => {
  owner(); const db = new D1(); globalThis.__connectionEnv.DB = db;
  const store = new StudioStore(db);
  await store.importDocument({ schema_version: 1, current_package_id: "education", paused: false, mode: "gentle", packages: [{ id: "education", revision: 1, content: { revision: 1, title: "核对教育信息", domain: "admissions", confirm_phrase: "确认教育信息", fields: [{ id: "school", question: "学校", candidate: "school", source_refs: ["fixture"] }] }, facts: [{ id: "school", content: { id: "school", question: "学校", candidate: "school", source_refs: ["fixture"] }, status: "pending" }] }] });
  const before = await store.snapshot();
  const read = (await (await call("get_work_context", { package_id: "education" })).json()).result;
  assert.equal(read.isError, false); assert.equal(read.structuredContent.execution_revision, 0); assert.equal(read.structuredContent.material.fields[0].candidate, "school");
  const checkpoint = { event_id: "mcp-evidence-1", package_id: "education", expected_execution_revision: 0, expected_content_revision: 1, status: "in_progress", summary: "读取现有教育记录，留下一个准确问题", next_action: "在原对话核对毕业时间", evidence: [{ kind: "file", title: "教育记录", locator: "/fixture/education.md", observed_at: new Date().toISOString() }] };
  const write = (await (await call("record_work_checkpoint", checkpoint)).json()).result;
  assert.equal(write.isError, false); assert.equal(write.structuredContent.work.execution.revision, 1);
  const replay = (await (await call("record_work_checkpoint", checkpoint)).json()).result; assert.equal(replay.structuredContent.idempotent, true);
  const conflict = (await (await call("record_work_checkpoint", { ...checkpoint, event_id: "mcp-stale" })).json()).result; assert.equal(conflict.isError, true);
  const after = await store.snapshot(); assert.equal(after.doc.current_package_id, before.doc.current_package_id); assert.deepEqual(after.doc.packages[0].facts, before.doc.packages[0].facts);
  const list = (await (await call("list_work", { domain: "admissions" })).json()).result;
  assert.equal(list.structuredContent.tasks[0].execution.summary, checkpoint.summary);
});
test("tool schemas expose finite operations, no snapshot overwrite or message sending", () => {
  assert.deepEqual(WORK_TOOLS.filter(tool => tool.annotations.readOnlyHint).map(tool => tool.name), ["list_work", "get_work_context"]);
  assert(WORK_TOOLS.every(tool => tool.inputSchema.additionalProperties === false));
  assert(!WORK_TOOLS.some(tool => /send|submit|import|overwrite/.test(tool.name)));
});

test("local launch preparation is owner authenticated, current and entirely read only", async () => {
  const url="https://desk.example/api/work/launch?package_id=education";
  globalThis.__connectionHeaders=new Headers();
  assert.equal((await launchGET(new Request(url))).status,401);
  owner();
  assert.equal((await launchGET(new Request(url,{headers:{Origin:"https://untrusted.test"}}))).status,403);
  const store=new StudioStore(globalThis.__connectionEnv.DB),before=await store.snapshot();
  const plan=await (await launchGET(new Request(url))).json();
  assert.equal(plan.kind,"new");assert.equal(new URL(plan.href).searchParams.get("path"),"/workspace/applications");
  assert.deepEqual(await store.snapshot(),before);
  assert.equal((await launchGET(new Request(url+"&path=/tmp"))).status,400);
  assert.equal((await launchGET(new Request(url+"&package_id=other"))).status,400);
});
