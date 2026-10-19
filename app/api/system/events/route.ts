import { respond, serviceAccess, store } from "@/lib/studio-http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return respond(async () => {
    serviceAccess(request);
    const params = new URL(request.url).searchParams;
    const rawLimit = params.get("limit");
    return store().listEvents(params.get("package_id") ?? "", params.get("cursor"), rawLimit === null ? 50 : /^\d+$/.test(rawLimit) ? Number(rawLimit) : Number.NaN);
  });
}
