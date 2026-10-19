import { env } from "cloudflare:workers";
import { browserAccess, respond } from "@/lib/studio-http";
import { StudioError } from "@/lib/studio-store";
import { readCourseMaterials } from "@/lib/course-materials";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  return respond(async () => {
    await browserAccess(request);
    if (!env.DB) throw new StudioError("database_unavailable", 503);
    return readCourseMaterials(env.DB, new URL(request.url).searchParams.get("package_id"));
  });
}
