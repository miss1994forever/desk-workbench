import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
import { test } from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataModule = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers") return dataModule("export const env = {};");
    if (specifier === "next/headers") return dataModule("export async function headers(){return globalThis.__studioTestHeaders;}");
    if (specifier === "next/navigation") return dataModule("export function redirect(){throw new Error('redirect');}");
    if (specifier.startsWith("@/")) return { url: pathToFileURL(resolve(root, specifier.slice(2) + ".ts")).href, shortCircuit: true };
    if (specifier.startsWith(".") && !extname(specifier) && context.parentURL?.endsWith(".ts")) return next(specifier + ".ts", context);
    return next(specifier, context);
  },
});
const { browserAccess, serviceAccess, readJson, respond } = await import("../lib/studio-http.ts");
const { POST: workplanPOST } = await import("../app/api/system/workplan/route.ts");

function request(headers = {}, body) {
  return new Request("https://owner.example/api/studio/action", { method: "POST", headers, ...(body !== undefined ? { body } : {}) });
}

test("browser write requires platform visitor identity AND exact same Origin", async () => {
  globalThis.__studioTestHeaders = new Headers();
  await assert.rejects(browserAccess(request({ Origin: "https://owner.example" }), true), /sign_in_required/);
  globalThis.__studioTestHeaders = new Headers({ "oai-authenticated-user-id": "owner-site-id", "oai-authenticated-user-email": "owner@example.org" });
  await assert.rejects(browserAccess(request(), true), /same_origin_required/);
  await assert.rejects(browserAccess(request({ Origin: "https://attacker.example" }), true), /same_origin_required/);
  await assert.rejects(browserAccess(request({ Origin: "null" }), true), /same_origin_required/);
  assert.equal(await browserAccess(request({ Origin: "https://owner.example" }), true), "owner-site-id");
});

test("system endpoint accepts no browser Origin or Fetch Metadata", () => {
  assert.throws(() => serviceAccess(request({ Origin: "https://owner.example" })), /service_requests_only/);
  assert.throws(() => serviceAccess(request({ "Sec-Fetch-Site": "same-origin" })), /service_requests_only/);
  // Sites owner-private dispatch must authenticate this request before it
  // reaches the Worker. This unit test does not simulate that upstream gate.
  assert.doesNotThrow(() => serviceAccess(request({ "Content-Type": "application/json" })));
  assert.doesNotThrow(() => serviceAccess(request({ "Content-Type": "application/json", "Sec-Fetch-Mode": "cors" })));
  assert.throws(() => serviceAccess(request({ "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Dest": "empty" })), /service_requests_only/);
  assert.throws(() => serviceAccess(request({ "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "" })), /service_requests_only/);
  assert.throws(() => serviceAccess(request({ "Sec-Fetch-Mode": "navigate" })), /service_requests_only/);
  assert.throws(() => serviceAccess(request({ "Sec-Fetch-Mode": "no-cors" })), /service_requests_only/);
});

test("JSON body size is enforced independently of the Content-Length hint", async () => {
  await assert.rejects(readJson(request({ "Content-Type": "application/json", "Content-Length": "1000" }, "{}"), 32), /request_too_large/);
  await assert.rejects(readJson(request({ "Content-Type": "application/json" }, JSON.stringify({ text: "a".repeat(100) })), 32), /request_too_large/);
  await assert.rejects(readJson(request({ "Content-Type": "text/plain" }, "{}"), 32), /json_content_type_required/);
  await assert.rejects(readJson(request({ "Content-Type": "application/json" }, "{bad"), 32), /invalid_json/);
  assert.deepEqual(await readJson(request({ "Content-Type": "application/json" }, '{"text":"中文"}'), 64), { text: "中文" });
});

test("error responses do not expose storage errors or private bodies", async () => {
  const response = await respond(async () => { throw new Error("private SQL and personal material"); });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const body = await response.text();
  assert.equal(body.includes("private SQL"), false);
  assert.equal(JSON.parse(body).retry_same_event_id, true);
});

test("workplan route enforces service isolation before accessing storage", async () => {
  const browser = await workplanPOST(request({ Origin: "https://owner.example", "Content-Type": "application/json" }, "{}"));
  assert.equal(browser.status, 403);
  assert.equal((await browser.json()).error, "service_requests_only");
  const service = await workplanPOST(request({ "Content-Type": "application/json" }, "{}"));
  assert.equal(service.status, 503);
  assert.equal((await service.json()).error, "database_unavailable");
});
