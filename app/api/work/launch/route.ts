import { browserAccess, respond, store } from "@/lib/studio-http";
import { StudioError } from "@/lib/studio-store";
import { planWorkLaunch, type LaunchPackage } from "@/lib/work-launch";

export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  return respond(async () => {
    await browserAccess(request);
    const params = new URL(request.url).searchParams;
    const id = params.get("package_id");
    if (params.size !== 1 || !id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(id)) throw new StudioError("invalid_package_id");
    const snapshot = await store().snapshot();
    const pkg = snapshot.doc?.packages.find((value: LaunchPackage) => value.id === id);
    if (!pkg) throw new StudioError("package_not_found", 404);
    return planWorkLaunch(pkg, snapshot.doc?.paused === true);
  });
}
