/** Read-only, owner-scoped startup copy. Only a successful server response can
 * replace it; it never queues or replays task/progress writes. */
const PREFIX = 'workspace:last-read:v1:';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 2_000_000;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = (owner: string) => PREFIX + encodeURIComponent(owner);
export function readWorkspaceCache<T>(storage: StorageLike, owner: string, valid: (value: unknown) => value is T, now = Date.now()): { snapshot: T; etag: string | null } | null {
  if (!owner) return null;
  try {
    const raw = storage.getItem(key(owner));
    if (!raw || raw.length > MAX_BYTES) return null;
    const value = JSON.parse(raw);
    if (value?.owner !== owner || !Number.isFinite(value.stored_at) || value.stored_at > now + 300000 || now - value.stored_at > MAX_AGE_MS || !valid(value.snapshot)) return null;
    return { snapshot: value.snapshot, etag: typeof value.etag === 'string' ? value.etag : null };
  } catch { return null; }
}
export function writeWorkspaceCache(storage: StorageLike, owner: string, snapshot: unknown, etag: string | null, now = Date.now()): void {
  if (!owner) return;
  try {
    const raw = JSON.stringify({ owner, stored_at: now, etag, snapshot });
    if (raw.length <= MAX_BYTES) storage.setItem(key(owner), raw);
  } catch { /* Storage restrictions must not prevent online work. */ }
}
export function clearWorkspaceCache(storage: StorageLike, owner: string): void {
  try { if (owner) storage.removeItem(key(owner)); } catch { /* Optional cache. */ }
}
