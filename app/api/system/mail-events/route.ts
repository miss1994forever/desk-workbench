import { readJson, respond, serviceAccess, store } from "@/lib/studio-http";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    serviceAccess(request);
    return store().mergeMail(await readJson(request, 64 * 1024));
  });
}
