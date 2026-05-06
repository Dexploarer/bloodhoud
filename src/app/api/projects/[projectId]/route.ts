import { AtlasStore } from "@/lib/atlas/storage";
import { errorResponse, projectFromRequest } from "@/lib/atlas/api";

export const runtime = "nodejs";

type ProjectRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, ctx: ProjectRouteContext) {
  const { projectId } = await ctx.params;
  const store = new AtlasStore();
  const project = store.getProject(projectId);

  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  return Response.json({ project, scans: store.listScanJobs(projectId), summary: store.getLatestSummary(projectId) });
}

export async function PUT(request: Request, ctx: ProjectRouteContext) {
  try {
    const { projectId } = await ctx.params;
    const store = new AtlasStore();
    const existing = store.getProject(projectId);

    if (!existing) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }

    const project = await projectFromRequest(request, existing);
    store.upsertProject(project);
    return Response.json({ project });
  } catch (error) {
    return errorResponse("ProjectApi", error instanceof Error ? error : new Error("Unable to update project."), 400);
  }
}
