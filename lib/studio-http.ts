import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { StudioError, StudioStore } from "./studio-store";

/** This application must remain owner-private in Sites access controls.
 * Dispatch enforces that boundary, including identity-less service requests.
 * This is not an authorization design for a public or shared deployment.
 */
export function store(): StudioStore {
  if (!env.DB) throw new StudioError("database_unavailable", 503);
  return new StudioStore(env.DB);
}

export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" } });
}

export async function browserAccess(request: Request, write = false): Promise<string> {
  const origin = request.headers.get("Origin");
  if ((write && !origin) || (origin && origin !== new URL(request.url).origin)) throw new StudioError("same_origin_required", 403);
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") throw new StudioError("cross_site_request_rejected", 403);
  const user = await getChatGPTUser();
  if (!user) throw new StudioError("sign_in_required", 401);
  return user.userId;
}

export function serviceAccess(request: Request): void {
  // A userless request is permitted only behind confirmed owner-private Sites
  // dispatch. The platform consumes its supported service credential; it does
  // not inject a visitor identity. Never invent an identity-header bypass.
  // Node/Undici forwarding through the Vite/Miniflare development transport
  // synthesizes a lone Sec-Fetch-Mode:cors even for urllib service requests.
  // It is not a browser identity signal. Keep rejecting Origin, Site, Dest,
  // navigation/no-cors modes, and every actual browser metadata combination.
  const mode = request.headers.get("Sec-Fetch-Mode");
  if (request.headers.has("Origin") || request.headers.has("Sec-Fetch-Site") || request.headers.has("Sec-Fetch-Dest") || (mode !== null && mode !== "cors")) {
    throw new StudioError("service_requests_only", 403);
  }
}

export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) throw new StudioError("json_content_type_required", 415);
  const length = request.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new StudioError("request_too_large", 413);
  if (!request.body) throw new StudioError("request_body_required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new StudioError("request_too_large", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
  catch { throw new StudioError("invalid_json"); }
}

export async function respond(action: () => Promise<unknown>): Promise<Response> {
  try { return json(await action()); }
  catch (error) {
    if (error instanceof StudioError) return json({ error: error.message, ...error.details }, error.status);
    // Never put SQL, request bodies, upstream errors, or identities in responses.
    return json({ error: "storage_unavailable", retry_same_event_id: true }, 503);
  }
}

/** Authenticated conditional reads only; never query external task sources. */
export async function snapshotResponse(request: Request, authorize: () => Promise<string | void>): Promise<Response> {
  const started = performance.now();
  try {
    const owner = await authorize(), authorized = performance.now();
    const database = store(), etag = await database.viewTag();
    const headers: Record<string, string> = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', ETag: etag, 'X-Content-Type-Options': 'nosniff' };
    if (owner) headers['X-Workspace-Owner'] = owner;
    if (request.headers.get('If-None-Match') === etag) {
      headers['Server-Timing'] = `auth;dur=${(authorized-started).toFixed(1)}, db;dur=${(performance.now()-authorized).toFixed(1)}`;
      return new Response(null, { status: 304, headers });
    }
    const snapshot = await database.snapshot();
    headers['Server-Timing'] = `auth;dur=${(authorized-started).toFixed(1)}, db;dur=${(performance.now()-authorized).toFixed(1)}`;
    return Response.json(snapshot, { headers });
  } catch (error) { return respond(async () => { throw error; }); }
}
