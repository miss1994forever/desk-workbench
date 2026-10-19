import { readJson, respond, serviceAccess, store } from "@/lib/studio-http";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    serviceAccess(request);
    return store().updateAcademicTasks(await readJson(request, 384 * 1024));
  });
}
