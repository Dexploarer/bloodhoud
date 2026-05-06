import { buildExportPacket } from "@/indexer/export-packet";
import { errorResponse, graphSliceFromPostBody, type ProjectRouteContext } from "@/lib/atlas/api";

export const runtime = "nodejs";

export async function POST(request: Request, ctx: ProjectRouteContext) {
  try {
    const slice = await graphSliceFromPostBody(request, ctx);
    if (slice instanceof Response) {
      return slice;
    }

    const packet = buildExportPacket(slice);

    return Response.json({ packet });
  } catch (error) {
    return errorResponse("ExportApi", error instanceof Error ? error : new Error("Unable to build export packet."), 500);
  }
}
