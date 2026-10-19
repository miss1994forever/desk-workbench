import { snapshotResponse, serviceAccess } from "@/lib/studio-http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return snapshotResponse(request, async () => { serviceAccess(request); });
}
