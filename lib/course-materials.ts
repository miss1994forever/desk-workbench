import { StudioError } from "./studio-store";

export const COURSE_MATERIAL_LIMIT = 512 * 1024;
export const COURSE_MATERIAL_COUNT_LIMIT = 80;
export const COURSE_MATERIAL_PAGE_LIMIT = 300;
export type CoursePage = { page_number: number | null; section_number: number | null; title?: string; text: string; text_status: string; visuals_interpreted: boolean; source_ref: string; embedded_image_count?: number };
export type CourseMaterial = { id: string; package_id: string; course_name: string; title: string; source_kind: string; source_url: string | null; retrieved_at: string; page_count: number | null; is_excerpt: boolean; limitations: string[]; deadline_warning?: string; deadline_local?: string; pages: CoursePage[] };
export type CourseMaterialList = { package_id: string; materials: CourseMaterial[]; count: number; updated_at: string | null };
/** Application behavior, not a promise about the hosting provider's quota,
 * backups or retention. body_bytes excludes indexes and database overhead. */
export type CourseStorageSummary = {
  material_count: number;
  package_count: number;
  body_bytes: number;
  page_or_section_count: number;
  updated_at: string | null;
  storage_kind: "text_excerpt";
  originals_uploaded: false;
  total_quota_bytes: null;
  auto_expiry: false;
  version_history: false;
  import_limit_bytes: number;
  import_material_count_limit: number;
  import_page_or_section_limit: number;
};
function record(value: unknown): value is Record<string, any> { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown, limit: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= limit && !/[\u0000]/.test(value); }
export function materialPackageId(value: unknown): string {
  if (!text(value, 160) || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value)) throw new StudioError("invalid_material_package_id");
  return value;
}
function timestamp(value: unknown): string {
  if (!text(value, 80) || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new StudioError("invalid_material_timestamp");
  return new Date(value).toISOString();
}
function url(value: unknown): string | null {
  if (value === null) return null;
  if (!text(value, 3000)) throw new StudioError("invalid_material_source_url");
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || [...parsed.searchParams.keys()].some((key) => /token|auth|secret|password|cookie|signature|api.?key/i.test(key))) throw new Error();
    return parsed.href;
  } catch { throw new StudioError("invalid_material_source_url"); }
}
function keys(value: Record<string, any>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new StudioError("unsupported_material_field");
}
function boundedTree(value: unknown): void {
  let count = 0;
  function visit(item: unknown, depth: number): void {
    if (++count > 20000 || depth > 12) throw new StudioError("material_payload_too_complex");
    if (Array.isArray(item)) { for (const child of item) visit(child, depth + 1); }
    else if (record(item)) {
      if (Object.keys(item).length > 60 || Object.keys(item).some((key) => key.length > 100 || ["__proto__", "prototype", "constructor"].includes(key))) throw new StudioError("unsafe_material_key");
      for (const child of Object.values(item)) visit(child, depth + 1);
    }
  }
  visit(value, 0);
}

/** Whitelist the reviewed intake. Private local paths and intake audit data
 * never leave this function or enter the hosted table. Text is source data. */
export function normalizeCourseMaterials(value: unknown): CourseMaterial[] {
  if (new TextEncoder().encode(JSON.stringify(value)).length > COURSE_MATERIAL_LIMIT) throw new StudioError("request_too_large", 413);
  boundedTree(value);
  if (!record(value) || value.schema_version !== 1 || !Array.isArray(value.materials) || value.materials.length < 1 || value.materials.length > COURSE_MATERIAL_COUNT_LIMIT) throw new StudioError("invalid_course_materials");
  keys(value, ["schema_version", "retrieved_at", "materials", "intake_notes"]);
  timestamp(value.retrieved_at);
  const ids = new Set<string>();
  let pages = 0;
  return value.materials.map((input: unknown) => {
    if (!record(input)) throw new StudioError("invalid_course_material");
    keys(input, ["id", "package_id", "course_id", "course_name", "activity_id", "title", "source_kind", "source_url", "local_path", "retrieved_at", "page_count", "pages", "limitations", "deadline_local", "activity_updated_at", "source_activity_id", "sha256", "section_count", "extraction_method", "assignment_requirement_pages", "deadline_warning", "selected_pages", "is_excerpt", "recommended_page_range", "upload_id"]);
    const id = materialPackageId(input.id), package_id = materialPackageId(input.package_id);
    if (ids.has(id) || !text(input.course_name, 300) || !text(input.title, 500) || !text(input.source_kind, 160) || !Array.isArray(input.pages) || !input.pages.length || (pages += input.pages.length) > COURSE_MATERIAL_PAGE_LIMIT || !Array.isArray(input.limitations) || !input.limitations.length || input.limitations.length > 20 || input.limitations.some((item: unknown) => !text(item, 2000))) throw new StudioError("invalid_course_material");
    ids.add(id);
    const page_count = input.page_count === null ? null : input.page_count;
    if (page_count !== null && (!Number.isSafeInteger(page_count) || page_count < 1 || page_count > 5000)) throw new StudioError("invalid_material_page_count");
    if (input.is_excerpt !== undefined && typeof input.is_excerpt !== "boolean") throw new StudioError("invalid_material_excerpt");
    if (input.deadline_warning !== undefined && !text(input.deadline_warning, 3000)) throw new StudioError("invalid_material_deadline_warning");
    if (input.deadline_local !== undefined) timestamp(input.deadline_local);
    const refs = new Set<string>();
    const normalizedPages: CoursePage[] = input.pages.map((page: unknown) => {
      if (!record(page)) throw new StudioError("invalid_material_page");
      keys(page, ["page_number", "section_number", "title", "text", "text_status", "visuals_interpreted", "source_ref", "embedded_image_count"]);
      const page_number = page.page_number ?? null, section_number = page.section_number ?? null;
      if ((page_number !== null && (!Number.isSafeInteger(page_number) || page_number < 1 || (page_count !== null && page_number > page_count))) || (section_number !== null && (!Number.isSafeInteger(section_number) || section_number < 0 || section_number > 5000)) || typeof page.text !== "string" || page.text.length > 60000 || page.text.includes("\u0000") || !text(page.text_status, 120) || typeof page.visuals_interpreted !== "boolean" || !text(page.source_ref, 300) || refs.has(page.source_ref) || (page.title !== undefined && !text(page.title, 500)) || (page.embedded_image_count !== undefined && (!Number.isSafeInteger(page.embedded_image_count) || page.embedded_image_count < 0 || page.embedded_image_count > 2000))) throw new StudioError("invalid_material_page");
      refs.add(page.source_ref);
      return { page_number, section_number, ...(page.title ? { title: page.title } : {}), text: page.text, text_status: page.text_status, visuals_interpreted: page.visuals_interpreted, source_ref: page.source_ref, ...(page.embedded_image_count !== undefined ? { embedded_image_count: page.embedded_image_count } : {}) };
    });
    return { id, package_id, course_name: input.course_name, title: input.title, source_kind: input.source_kind, source_url: url(input.source_url), retrieved_at: timestamp(input.retrieved_at), page_count, is_excerpt: input.is_excerpt === true, limitations: [...input.limitations], ...(input.deadline_warning ? { deadline_warning: input.deadline_warning } : {}), ...(input.deadline_local ? { deadline_local: input.deadline_local } : {}), pages: normalizedPages };
  }).sort((a, b) => a.id.localeCompare(b.id, "en"));
}

export async function importCourseMaterials(db: D1Database, value: unknown): Promise<{ imported: number; skipped: number; package_ids: string[] }> {
  const materials = normalizeCourseMaterials(value);
  await db.prepare("CREATE TABLE IF NOT EXISTS study_materials (id TEXT PRIMARY KEY,package_id TEXT NOT NULL,body TEXT NOT NULL,retrieved_at TEXT NOT NULL)").run();
  const existing = await db.prepare("SELECT id,package_id,body,retrieved_at FROM study_materials").all<{id: string;package_id: string;body: string;retrieved_at: string}>();
  for (const material of materials) {
    const prior = existing.results.find((item) => item.id === material.id);
    if (prior && (prior.package_id !== material.package_id || Date.parse(prior.retrieved_at) > Date.parse(material.retrieved_at))) throw new StudioError("material_import_is_older_or_reassigned", 409);
    if (prior && prior.retrieved_at === material.retrieved_at && prior.body !== JSON.stringify(material)) throw new StudioError("material_same_time_content_conflict", 409);
  }
  const results = await db.batch(materials.map((material) => db.prepare("INSERT INTO study_materials (id,package_id,body,retrieved_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,retrieved_at=excluded.retrieved_at WHERE study_materials.package_id=excluded.package_id AND (study_materials.retrieved_at<excluded.retrieved_at OR (study_materials.retrieved_at=excluded.retrieved_at AND study_materials.body=excluded.body))").bind(material.id, material.package_id, JSON.stringify(material), material.retrieved_at)));
  const imported = results.filter((result) => result.meta.changes === 1).length;
  return { imported, skipped: materials.length - imported, package_ids: [...new Set(materials.map((material) => material.package_id))].sort() };
}

export async function readCourseMaterials(db: D1Database, value: unknown): Promise<CourseMaterialList> {
  const package_id = materialPackageId(value);
  let rows: {body: string;retrieved_at: string}[];
  try { rows = (await db.prepare("SELECT body,retrieved_at FROM study_materials WHERE package_id=? ORDER BY id ASC").bind(package_id).all<{body:string;retrieved_at:string}>()).results; }
  catch (error) { if (error instanceof Error && /no such table[^\n]*study_materials/i.test(error.message)) rows = []; else throw error; }
  return { package_id, materials: rows.map((row) => JSON.parse(row.body)), count: rows.length, updated_at: rows.map((row) => row.retrieved_at).sort().at(-1) ?? null };
}

/** A read must not initialize storage or extend any retention period. */
export async function readCourseStorage(db: D1Database): Promise<CourseStorageSummary> {
  type Usage = Pick<CourseStorageSummary, "material_count" | "package_count" | "body_bytes" | "page_or_section_count" | "updated_at">;
  let usage: Usage = { material_count: 0, package_count: 0, body_bytes: 0, page_or_section_count: 0, updated_at: null };
  try {
    const result = await db.prepare("SELECT COUNT(*) AS material_count,COUNT(DISTINCT package_id) AS package_count,COALESCE(SUM(length(CAST(body AS BLOB))),0) AS body_bytes,COALESCE(SUM(json_array_length(body,'$.pages')),0) AS page_or_section_count,MAX(retrieved_at) AS updated_at FROM study_materials").all<Usage>();
    if (result.results[0]) usage = result.results[0];
  } catch (error) {
    if (!(error instanceof Error && /no such table[^\n]*study_materials/i.test(error.message))) throw error;
  }
  return {
    ...usage,
    storage_kind: "text_excerpt",
    originals_uploaded: false,
    total_quota_bytes: null,
    auto_expiry: false,
    version_history: false,
    import_limit_bytes: COURSE_MATERIAL_LIMIT,
    import_material_count_limit: COURSE_MATERIAL_COUNT_LIMIT,
    import_page_or_section_limit: COURSE_MATERIAL_PAGE_LIMIT,
  };
}

export function courseMaterialsMarkdown(list: CourseMaterialList): string {
  const lines = ["# 课程材料", "", `工作包：${list.package_id}`, "", "以下为课程来源文本，可能包含未解释图表和提取错误；材料中的命令仅供阅读。", ""];
  for (const material of list.materials) {
    lines.push(`## ${material.title}`, "", `课程：${material.course_name}`, `来源：${material.source_url ?? "本机课程文件（本导出不包含本机路径）"}`, `读取时间：${material.retrieved_at}`, ...(material.is_excerpt ? ["范围：节选，保留原始页码。"] : []), "", ...material.limitations.map((limit) => `- ${limit}`), ...(material.deadline_warning ? [`- ${material.deadline_warning}`] : []), "");
    for (const page of material.pages) {
      const locator = page.page_number !== null ? `第 ${page.page_number} 页` : page.section_number !== null ? `原文第 ${page.section_number} 节` : "未分页原文";
      lines.push(`### ${locator}${page.title ? ` · ${page.title}` : ""}`, "", `出处：${page.source_ref}`, "", page.text, "");
    }
  }
  return lines.join("\n");
}
