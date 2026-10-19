import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataModule = source => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true });
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return dataModule("export const env = globalThis.__courseTestEnv;");
  if (specifier === "next/headers") return dataModule("export async function headers(){return globalThis.__courseTestHeaders;}");
  if (specifier === "next/navigation") return dataModule("export function redirect(){throw new Error('redirect');}");
  if (specifier.startsWith("@/")) return { url: pathToFileURL(resolve(root, specifier.slice(2) + ".ts")).href, shortCircuit: true };
  if (specifier.startsWith(".") && !extname(specifier) && context.parentURL?.endsWith(".ts")) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
globalThis.__courseTestEnv = {};
globalThis.__courseTestHeaders = new Headers();
const { normalizeCourseMaterials, importCourseMaterials, readCourseMaterials, readCourseStorage, courseMaterialsMarkdown } = await import("../lib/course-materials.ts");
const { GET: materialsGET } = await import("../app/api/study/materials/route.ts");
const { GET: exportGET } = await import("../app/api/study/export/route.ts");
const { GET: storageGET } = await import("../app/api/study/storage/route.ts");
const { POST: importPOST, GET: storageServiceGET } = await import("../app/api/system/study-materials/route.ts");
class SqliteD1 {
  constructor() { this.db = new DatabaseSync(":memory:"); this.sql = []; }
  prepare(sql) {
    this.sql.push(sql);
    const owner = this;
    return { sql, values: [], bind(...values) { return { ...this, values }; }, async all() { return { results: owner.db.prepare(this.sql).all(...this.values) }; }, async run() { const result = owner.db.prepare(this.sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; } };
  }
  async batch(statements) {
    this.db.exec("BEGIN");
    try { const result = statements.map(s => ({ meta: { changes: Number(this.db.prepare(s.sql).run(...s.values).changes) } })); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
function fixture() { return { schema_version: 1, retrieved_at: "2026-10-19T00:00:00+08:00", intake_notes: { private_local_only: true }, materials: [{ id: "lecture", package_id: "course-vo", title: "VO/RVO 课件", course_name: "计算机动画", source_kind: "local_course_lecture_pdf", source_url: null, local_path: "/workspace/examples/path.pdf", retrieved_at: "2026-10-19T00:00:00+08:00", page_count: 81, is_excerpt: true, limitations: ["图表尚未解释"], pages: [{ page_number: 22, text: "相互速度障碍模型", text_status: "extracted", visuals_interpreted: false, source_ref: "lecture:22" }] }] }; }
function signedIn() { globalThis.__courseTestHeaders = new Headers({ "oai-authenticated-user-id": "owner", "oai-authenticated-user-email": "owner@example.org" }); }
test("reader keeps true source page numbers and strips local paths and intake notes", async () => {
  const db = new SqliteD1();
  assert.deepEqual(await readCourseMaterials(db, "course-vo"), { package_id: "course-vo", materials: [], count: 0, updated_at: null });
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='study_materials'").get().n, 0);
  const original = fixture();
  const result = await importCourseMaterials(db, original);
  assert.equal(result.imported, 1);
  const list = await readCourseMaterials(db, "course-vo");
  assert.equal(list.materials[0].pages[0].page_number, 22);
  assert.equal(list.materials[0].pages[0].section_number, null);
  assert.equal(list.materials[0].local_path, undefined);
  assert.equal(JSON.stringify(list).includes("/private/source"), false);
  assert.deepEqual((await importCourseMaterials(db, original)).package_ids, ["course-vo"]);
  const markdown = courseMaterialsMarkdown(list);
  assert.match(markdown, /第 22 页/);
  assert.match(markdown, /图表尚未解释/);
  assert.doesNotMatch(markdown, /\/Users\/private/);
});
test("normalization rejects unsafe URLs, duplicate IDs/pages, invalid pages, prototypes, oversize and unknown fields", () => {
  for (const mutate of [
    v => { v.materials[0].source_url = "https://user:secret@example.org/a"; },
    v => { v.materials[0].source_url = "javascript:alert(1)"; },
    v => { v.materials[0].source_url = "https://example.org/a?access_token=secret"; },
    v => { v.materials.push(structuredClone(v.materials[0])); },
    v => { v.materials[0].pages.push(structuredClone(v.materials[0].pages[0])); },
    v => { v.materials[0].pages[0].page_number = 82; },
    v => { v.materials[0].pages[0].text = "x".repeat(60001); },
    v => { v.materials[0].unknown = true; },
    v => { v.intake_notes = JSON.parse('{"__proto__":{"polluted":true}}'); },
    v => { v.materials[0].pages = Array.from({length:301}, (_,i) => ({...v.materials[0].pages[0],source_ref:`page:${i}`})); },
    v => { v.materials[0].local_path = "x".repeat(513*1024); },
  ]) { const value = fixture(); mutate(value); assert.throws(() => normalizeCourseMaterials(value)); }
  assert.equal({}.polluted, undefined);
});
test("webpage and Markdown sections keep null page numbers and original section zero", async () => {
  const value = fixture(); value.materials[0].source_url = "https://courses.example.edu/course/1/learning-activity#/2"; value.materials[0].page_count = null; value.materials[0].pages[0].page_number = null; value.materials[0].pages[0].section_number = 0;
  const materials = normalizeCourseMaterials(value);
  assert.equal(materials[0].pages[0].page_number, null);
  const output = courseMaterialsMarkdown({ package_id:"course-vo",materials,count:1,updated_at:null });
  assert.match(output, /原文第 0 节/);
  assert.match(output, /https:\/\/courses.example.edu/);
  assert.doesNotMatch(output, /第 1 页/);
});
test("older or reassigned imports cannot overwrite retained material or other work tables", async () => {
  const db = new SqliteD1(); db.db.exec("CREATE TABLE documents (body TEXT); INSERT INTO documents VALUES ('unchanged');");
  await importCourseMaterials(db, fixture());
  const older = fixture(); older.materials[0].retrieved_at = "2026-10-18T00:00:00Z";
  await assert.rejects(importCourseMaterials(db, older), /older_or_reassigned/);
  const reassigned = fixture(); reassigned.materials[0].package_id = "another-package";
  await assert.rejects(importCourseMaterials(db, reassigned), /older_or_reassigned/);
  const conflicting = fixture(); conflicting.materials[0].pages[0].text = "同一读取时间下不同内容";
  await assert.rejects(importCourseMaterials(db, conflicting), /same_time_content_conflict/);
  assert.equal((await readCourseMaterials(db,"course-vo")).materials[0].pages[0].text,"相互速度障碍模型");
  assert.equal(db.db.prepare("SELECT body FROM documents").get().body, "unchanged");
});
test("reader/export enforce browser auth and same origin; importer rejects browser context", async () => {
  globalThis.__courseTestEnv.DB = new SqliteD1();
  globalThis.__courseTestHeaders = new Headers();
  const request = new Request("https://owner.example/api/study/materials?package_id=course-vo");
  assert.equal((await materialsGET(request)).status, 401);
  assert.equal((await exportGET(request)).status, 401);
  signedIn();
  assert.equal((await materialsGET(new Request(request, { headers: { Origin:"https://other.example" } }))).status,403);
  assert.equal((await exportGET(new Request(request,{headers:{"Sec-Fetch-Site":"cross-site"}}))).status,403);
  const rejected = await importPOST(new Request("https://owner.example/api/system/study-materials",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://owner.example"},body:JSON.stringify(fixture())}));
  assert.equal(rejected.status,403);
  const accepted = await importPOST(new Request("https://owner.example/api/system/study-materials",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(fixture())}));
  assert.equal(accepted.status,200);
  const downloaded = await exportGET(request);
  assert.equal(downloaded.status,200);
  assert.equal(downloaded.headers.get("Cache-Control"),"private, no-store");
  assert.match(downloaded.headers.get("Content-Disposition"),/attachment; filename=/);
  assert.match(downloaded.headers.get("Content-Type"),/charset=utf-8/);
  assert.match(await downloaded.text(),/相互速度障碍模型/);
});
test("storage reads an empty database without creating a table, writing or claiming a provider quota", async () => {
  const db = new SqliteD1();
  const before = db.db.prepare("SELECT total_changes() AS n").get().n;
  const usage = await readCourseStorage(db);
  assert.deepEqual(usage, {
    material_count: 0, package_count: 0, body_bytes: 0, page_or_section_count: 0, updated_at: null,
    storage_kind: "text_excerpt", originals_uploaded: false, total_quota_bytes: null,
    auto_expiry: false, version_history: false, import_limit_bytes: 512 * 1024,
    import_material_count_limit: 80, import_page_or_section_limit: 300,
  });
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='study_materials'").get().n, 0);
  assert.equal(db.db.prepare("SELECT total_changes() AS n").get().n, before);
  assert.ok(db.sql.length > 0);
  assert.ok(db.sql.every(sql => /^SELECT\b/i.test(sql)));
});
test("storage counts distinct packages, actual excerpt pages and UTF-8 body bytes without returning content", async () => {
  const db = new SqliteD1();
  const input = fixture();
  input.materials[0].pages[0].text = "中文课件与雷神 ⚡ 🧑🏽‍💻";
  input.materials.push({ ...structuredClone(input.materials[0]), id: "lecture-2", pages: [
    { ...input.materials[0].pages[0], source_ref: "lecture-2:22" },
    { ...input.materials[0].pages[0], page_number: 23, source_ref: "lecture-2:23" },
  ] });
  input.materials.push({ ...structuredClone(input.materials[0]), id: "lecture-3", package_id: "another-course", retrieved_at: "2026-10-19T01:00:00Z" });
  await importCourseMaterials(db, input);
  const bodies = db.db.prepare("SELECT body FROM study_materials").all();
  const expectedBytes = bodies.reduce((sum, row) => sum + new TextEncoder().encode(row.body).length, 0);
  const stringLengths = bodies.reduce((sum, row) => sum + row.body.length, 0);
  assert.ok(expectedBytes > stringLengths);
  db.sql.length = 0;
  const before = db.db.prepare("SELECT total_changes() AS n").get().n;
  const usage = await readCourseStorage(db);
  assert.equal(usage.material_count, 3);
  assert.equal(usage.package_count, 2);
  assert.equal(usage.page_or_section_count, 4);
  assert.equal(usage.body_bytes, expectedBytes);
  assert.equal(usage.updated_at, "2026-10-19T01:00:00.000Z");
  assert.equal(db.db.prepare("SELECT total_changes() AS n").get().n, before);
  assert.ok(db.sql.every(sql => /^SELECT\b/i.test(sql)));
  assert.doesNotMatch(JSON.stringify(usage), /中文课件|\/Users\/private|source_ref/);
});
test("storage reader requires browser auth and same origin; service summary rejects browser metadata and never writes", async () => {
  const db = new SqliteD1(); globalThis.__courseTestEnv.DB = db;
  globalThis.__courseTestHeaders = new Headers();
  const request = new Request("https://owner.example/api/study/storage");
  assert.equal((await storageGET(request)).status, 401);
  signedIn();
  assert.equal((await storageGET(new Request(request, { headers: { Origin: "https://other.example" } }))).status, 403);
  assert.equal((await storageGET(new Request(request, { headers: { "Sec-Fetch-Site": "cross-site" } }))).status, 403);
  const response = await storageGET(request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Vary"), "Cookie");
  assert.equal((await response.json()).material_count, 0);
  const serviceRequest = new Request("https://owner.example/api/system/study-materials");
  for (const headers of [{ Origin: "https://owner.example" }, { "Sec-Fetch-Site": "same-origin" }, { "Sec-Fetch-Mode": "navigate" }, { "Sec-Fetch-Dest": "empty" }]) {
    assert.equal((await storageServiceGET(new Request(serviceRequest, { headers }))).status, 403);
  }
  const serviceResponse = await storageServiceGET(serviceRequest);
  assert.equal(serviceResponse.status, 200);
  assert.equal(serviceResponse.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await serviceResponse.json()).body_bytes, 0);
  assert.ok(db.sql.every(sql => /^SELECT\b/i.test(sql)));
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='study_materials'").get().n, 0);
  delete globalThis.__courseTestEnv.DB;
  assert.equal((await storageGET(request)).status, 503);
  assert.equal((await storageServiceGET(serviceRequest)).status, 503);
});
test("optional reviewed private intake validates without saving or printing its contents", { skip: !process.env.COURSE_MATERIALS_CANDIDATE }, () => {
  const source=readFileSync(process.env.COURSE_MATERIALS_CANDIDATE,"utf8");
  const normalized=normalizeCourseMaterials(JSON.parse(source));
  assert.ok(normalized.length);
  assert.equal(JSON.stringify(normalized).includes('"local_path"'),false);
  assert.equal(readFileSync(process.env.COURSE_MATERIALS_CANDIDATE,"utf8"),source);
});
