import { AtlasStore } from "@/lib/atlas/storage";

export const runtime = "nodejs";

type IssueRouteContext = {
  params: Promise<{ projectId: string; issueId: string }>;
};

export async function GET(_request: Request, ctx: IssueRouteContext) {
  const { projectId, issueId } = await ctx.params;
  const store = new AtlasStore();
  const issue = store.getIssue(projectId, issueId);

  if (!issue) {
    return Response.json({ error: "Issue not found." }, { status: 404 });
  }

  return Response.json({ issue });
}
