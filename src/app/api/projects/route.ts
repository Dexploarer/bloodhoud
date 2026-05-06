import { AtlasStore } from "@/lib/atlas/storage";
import { errorResponse, projectFromRequest } from "@/lib/atlas/api";

export const runtime = "nodejs";

export async function GET() {
  const store = new AtlasStore();
  const projects = store.listProjects();
  return Response.json({ projects });
}

export async function POST(request: Request) {
  try {
    const store = new AtlasStore();
    const project = await projectFromRequest(request);
    store.upsertProject(project);
    return Response.json({ project }, { status: 201 });
  } catch (error) {
    return errorResponse("ProjectsApi", error instanceof Error ? error : new Error("Unable to create project."), 400);
  }
}
