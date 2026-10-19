import { env } from "cloudflare:workers";
import { browserAccess, json } from "@/lib/studio-http";
import { StudioError } from "@/lib/studio-store";
import { courseMaterialsMarkdown, readCourseMaterials } from "@/lib/course-materials";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  try {
    await browserAccess(request);
    if (!env.DB) throw new StudioError("database_unavailable", 503);
    const list = await readCourseMaterials(env.DB, new URL(request.url).searchParams.get("package_id"));
    if (!list.count) throw new StudioError("course_materials_not_found", 404);
    return new Response(courseMaterialsMarkdown(list), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="course-materials-${list.package_id}.md"`, "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return error instanceof StudioError ? json({ error: error.message }, error.status) : json({ error: "storage_unavailable" }, 503);
  }
}
