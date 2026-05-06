import { buildAiScan } from "@/indexer/ai-scan";
import { buildGraphSlice } from "@/indexer/slices";
import { errorResponse } from "@/lib/atlas/api";
import { readJsonObject, stringFromJson } from "@/lib/atlas/json";
import { AtlasStore, createEmptySummary } from "@/lib/atlas/storage";
import type { GraphSliceKind } from "@/lib/atlas/types";

export const runtime = "nodejs";

type ProjectRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function POST(request: Request, ctx: ProjectRouteContext) {
  try {
    const { projectId } = await ctx.params;
    const body = await readJsonObject(request);
    const kind = stringFromJson(body.kind) ?? "overview";
    const target = stringFromJson(body.target);
    const store = new AtlasStore();
    const project = store.getProject(projectId);

    if (!project) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }

    const summary = store.getLatestSummary(projectId) ?? createEmptySummary(project);
    const slice = buildGraphSlice(
      kind as GraphSliceKind,
      target,
      store.getNodes(projectId),
      store.getEdges(projectId),
      store.getIssues(projectId),
      summary,
    );
    const result = await buildAiScan(slice);

    return Response.json({ result });
  } catch (error) {
    return errorResponse("AiScanApi", error instanceof Error ? error : new Error("Unable to build AI scan."), 500);
  }
}
