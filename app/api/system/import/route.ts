import { readJson, respond, serviceAccess, store } from "@/lib/studio-http";
import { StudioError } from "@/lib/studio-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    serviceAccess(request);
    const body = await readJson(request, 256 * 1024);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new StudioError("invalid_import");
    const input = body as Record<string, unknown>;
    if (input.checksum !== undefined && (typeof input.checksum !== "string" || !/^[a-f0-9]{64}$/.test(input.checksum))) throw new StudioError("invalid_checksum");
    return store().importDocument(input.document, input.checksum as string | undefined);
  });
}
