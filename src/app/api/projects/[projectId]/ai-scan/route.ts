import { buildAiScan } from "@/indexer/ai-scan";
import { errorResponse, graphSliceFromPostBody, type ProjectRouteContext } from "@/lib/atlas/api";

export const runtime = "nodejs";

export async function POST(request: Request, ctx: ProjectRouteContext) {
  try {
    const slice = await graphSliceFromPostBody(request, ctx);
    if (slice instanceof Response) {
      return slice;
    }

    const result = await buildAiScan(slice);

    return Response.json({ result });
  } catch (error) {
    return errorResponse("AiScanApi", error instanceof Error ? error : new Error("Unable to build AI scan."), 500);
  }
}
