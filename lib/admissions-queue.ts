import { admissionsSourceAvailability, admissionsTaskOf } from './admissions-tasks';
import { executionOf } from './execution-state';
import { isPackageComplete, type ProgressPackage } from './task-progress';

/** Source waiting/done is not an executable task or owner completion. */
export function admissionsCanStart(pkg: ProgressPackage): boolean {
  if (isPackageComplete(pkg)) return false;
  const task = admissionsTaskOf(pkg);
  if (!task) return true;
  const availability = admissionsSourceAvailability(task);
  if (availability === 'actionable') return executionOf(pkg)?.status !== 'waiting';
  return availability === 'waiting' && ['in_progress', 'blocked'].includes(executionOf(pkg)?.status || '');
}
export function admissionsQueue<T extends ProgressPackage>(packages: T[]) {
  const support = packages.filter(pkg => !!pkg.supports_task_record_id);
  const parents = packages.filter(pkg => !pkg.supports_task_record_id);
  const completed = parents.filter(isPackageComplete);
  const active = parents.filter(admissionsCanStart).sort((a, b) => {
    const priority = (pkg: T) => {
      const value = admissionsTaskOf(pkg)?.priority || '';
      return /^(P0|Highest|Urgent|紧急)$/i.test(value) ? 0 : /^(P1|High|高)$/i.test(value) ? 1 : /^(P2|Medium|中)$/i.test(value) ? 2 : 3;
    };
    return Number(!admissionsTaskOf(a)) - Number(!admissionsTaskOf(b)) || priority(a) - priority(b);
  });
  const waiting = parents.filter(pkg => !isPackageComplete(pkg) && !admissionsCanStart(pkg) && (!admissionsTaskOf(pkg) || ['actionable', 'waiting'].includes(admissionsSourceAvailability(admissionsTaskOf(pkg)!))));
  const sourceArchive = parents.filter(pkg => !isPackageComplete(pkg) && !!admissionsTaskOf(pkg) && !['actionable', 'waiting'].includes(admissionsSourceAvailability(admissionsTaskOf(pkg)!)));
  return { active, waiting, completed, sourceArchive, support };
}
