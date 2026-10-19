import { readJson, respond, serviceAccess, store } from "@/lib/studio-http";
import { runWorkTool } from "@/lib/work-connection";
import { StudioError } from "@/lib/studio-store";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    serviceAccess(request);
    const input = await readJson(request, 180000) as any;
    if (!input || typeof input.name !== "string" || Object.keys(input).some(key => !["name", "arguments"].includes(key))) throw new StudioError("invalid_tool_request");
    return runWorkTool(store(), input.name, input.arguments ?? {});
  });
}
