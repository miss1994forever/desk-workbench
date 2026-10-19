import { academicTaskOf } from './task-progress';
type JsonObject = Record<string, any>;
const PORTAL = 'https://courses.example.edu/user/index';
const text = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u001f]/.test(value);
const aware = (value: unknown): value is string => typeof value === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const canonical = (value: any): string => Array.isArray(value) ? JSON.stringify(value.map(canonical)) : value && typeof value === 'object' ? JSON.stringify(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : JSON.stringify(value);

/** Only verified homework identities become tasks. Missing todos never finish
 * or delete work; source failures never replace successful assignment data. */
export function reconcileLmsTasks(doc: { packages: JsonObject[] }, source: JsonObject, now = new Date().toISOString()) {
  const result = { registered_package_ids: [] as string[], updated_package_ids: [] as string[] };
  if (source.status !== 'synced') return result;
  if (source.provenance?.kind !== 'lms' || source.provenance?.authenticated_read !== true || source.provenance?.read_status !== 'success' || source.provenance?.source_url !== PORTAL) return result;
  if (!aware(source.last_success_at) || !Array.isArray(source.items) || source.items.length > 500) throw new Error('invalid_lms_task_source');
  const seen = new Set<string>();
  for (const item of source.items) {
    if (item?.identity_verified !== true || item.activity_type !== 'homework') continue;
    const course = String(item.course_id), activity = String(item.platform_id);
    if (!/^\d{1,16}$/.test(course) || !/^\d{1,16}$/.test(activity) || item.id !== `lms:${course}:${activity}` || item.source !== 'lms' || item.source_url !== PORTAL || item.submission_state !== 'unknown' || !text(item.title, 300) || !text(item.course_name, 300)) throw new Error('invalid_lms_task_identity');
    const id = `lms:${course}:${activity}`;
    if (seen.has(id)) throw new Error('duplicate_lms_task_identity');
    seen.add(id);
    const matches = doc.packages.filter(pkg => academicTaskOf(pkg as any)?.id === id);
    if (matches.length > 1) throw new Error('duplicate_lms_task_binding');
    let pkg = matches[0];
    const previous = pkg && academicTaskOf(pkg as any);
    const workspace = previous?.workspace_path || doc.packages.map(p => academicTaskOf(p as any)).find(task => task?.id.startsWith(`lms:${course}:`) && task.course_name === item.course_name && task.workspace_path)?.workspace_path;
    const exact = item.deadline_status === 'exact_timestamp' && aware(item.deadline_iso);
    const schoolSource = previous?.sources.find(s => s.id === 'school-assignment') || previous?.sources.find(s => s.id === previous.due?.source_id) || { id: 'school-assignment', title: `课程平台：${item.title}`, url: PORTAL, detail: '学校平台返回的作业；具体要求与提交回执以原页面为准。' };
    const base = previous ? (({source_revision, sourced_at, ...value}) => value)(previous) : {
      id, kind: 'assignment', title: item.title, course_name: item.course_name,
      deliverables: [`完成「${item.title}」要求的作业，并在学校平台提交。`],
      sources: [schoolSource], source_refs: [schoolSource.id],
      ...(workspace ? { workspace_path: workspace } : {}),
      scope_note: '平台待办来源；未出现不表示完成，提交需实际回执。',
    };
    const task = { ...base, ...(base.sources.some(s => s.id === schoolSource.id) ? {} : {sources:[...base.sources,schoolSource],source_refs:[...base.source_refs,schoolSource.id]}), title: item.title, course_name: item.course_name,
      ...(exact ? { due: { at: item.deadline_iso, kind: 'platform_deadline', source_id: schoolSource.id } } : !previous ? { due: { at: null, kind: 'none_verified' } } : {}),
    };
    if (previous && canonical(base) === canonical(task)) continue;
    if (!pkg) {
      const packageId = `course-lms-${course}-${activity}`;
      if (doc.packages.some(p => p.id === packageId)) throw new Error('lms_package_id_collision');
      pkg = { id: packageId, revision: 1, content: { kind: 'academic_work', domain: 'academics', title: task.title, fields: [] }, facts: [] };
      doc.packages.push(pkg); result.registered_package_ids.push(pkg.id);
    } else {
      pkg.academic_source_history = [...(pkg.academic_source_history || []), structuredClone(previous)].slice(-30);
      result.updated_package_ids.push(pkg.id);
    }
    pkg.academic_task = { ...task, source_revision: (previous?.source_revision ?? 0) + 1, sourced_at: now };
  }
  return result;
}
