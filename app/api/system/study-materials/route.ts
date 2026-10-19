import { env } from "cloudflare:workers";
import { readJson, respond, serviceAccess } from "@/lib/studio-http";
import { StudioError } from "@/lib/studio-store";
import { COURSE_MATERIAL_LIMIT, importCourseMaterials, readCourseStorage } from "@/lib/course-materials";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  return respond(async () => {
    serviceAccess(request);
    if (!env.DB) throw new StudioError("database_unavailable", 503);
    return readCourseStorage(env.DB);
  });
}
export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    serviceAccess(request);
    if (!env.DB) throw new StudioError("database_unavailable", 503);
    return importCourseMaterials(env.DB, await readJson(request, COURSE_MATERIAL_LIMIT));
  });
}
