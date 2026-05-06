import { buildGraphSlice } from "@/indexer/slices";
import { errorResponse, graphSliceParams } from "@/lib/atlas/api";
import { AtlasStore, createEmptySummary } from "@/lib/atlas/storage";
import type { GraphSliceKind } from "@/lib/atlas/types";

export const runtime = "nodejs";

type ProjectRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, ctx: ProjectRouteContext) {
  try {
    const { projectId } = await ctx.params;
    const store = new AtlasStore();
    const project = store.getProject(projectId);

    if (!project) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }

    const { kind, target } = graphSliceParams(request);
    const summary = store.getLatestSummary(projectId) ?? createEmptySummary(project);
    const slice = buildGraphSlice(
      kind as GraphSliceKind,
      target,
      store.getNodes(projectId),
      store.getEdges(projectId),
      store.getIssues(projectId),
      summary,
    );

    return new Response(slice.mermaid, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    return errorResponse("MermaidApi", error instanceof Error ? error : new Error("Unable to build Mermaid chart."), 500);
  }
}
