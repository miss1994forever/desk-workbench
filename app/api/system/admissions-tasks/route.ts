import { readJson, respond, serviceAccess, store } from "@/lib/studio-http";
export const dynamic = "force-dynamic";
/** Only reconciles the source snapshot already stored in this private site. */
export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    serviceAccess(request);
    return store().registerAdmissionsTasks(await readJson(request, 4096));
  });
}
