import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
import { test } from "node:test";
const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const data=source=>({url:`data:text/javascript,${encodeURIComponent(source)}`,shortCircuit:true});
registerHooks({resolve(specifier,context,next){
  if(specifier==="cloudflare:workers")return data("export const env = {};");
  if(specifier==="next/headers")return data("export async function headers(){return new Headers();}");
  if(specifier==="next/navigation")return data("export function redirect(){throw new Error('redirect');}");
  if(specifier.startsWith("@/"))return{url:pathToFileURL(resolve(root,specifier.slice(2)+".ts")).href,shortCircuit:true};
  if(specifier.startsWith(".")&&!extname(specifier)&&context.parentURL?.endsWith(".ts"))return next(specifier+".ts",context);
  return next(specifier,context);
}});
const {POST}=await import("../app/api/system/academic-tasks/route.ts");
test("academic task service import rejects browser contexts before storage access",async()=>{
  for(const metadata of [{Origin:"https://owner.example"},{"Sec-Fetch-Site":"same-origin"},{"Sec-Fetch-Mode":"navigate"}]){
    const response=await POST(new Request("https://owner.example/api/system/academic-tasks",{method:"POST",headers:{"Content-Type":"application/json",...metadata},body:"{}"}));
    assert.equal(response.status,403);assert.equal((await response.json()).error,"service_requests_only");
  }
  const response=await POST(new Request("https://owner.example/api/system/academic-tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}));
  assert.equal(response.status,503);assert.equal((await response.json()).error,"database_unavailable");
});
