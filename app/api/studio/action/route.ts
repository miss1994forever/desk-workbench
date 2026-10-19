import { browserAccess, readJson, respond, store } from "@/lib/studio-http";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    const actor = await browserAccess(request, true);
    return store().apply(await readJson(request, 64 * 1024), actor);
  });
}
