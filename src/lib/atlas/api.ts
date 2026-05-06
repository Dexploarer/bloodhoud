import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { buildGraphSlice } from "@/indexer/slices";
import { Logger } from "@/lib/logger";
import { isJsonObject, readJsonObject, stringArrayFromJson, stringFromJson } from "@/lib/atlas/json";
import { AtlasStore, createEmptySummary } from "@/lib/atlas/storage";
import type { GraphSlice, GraphSliceKind, JsonObject, ProjectConfig } from "@/lib/atlas/types";

export type ProjectRouteContext = {
  params: Promise<{ projectId: string }>;
};

export function errorResponse(source: string, error: Error, status = 500): Response {
  Logger.error(source, error.message, { status });
  return Response.json({ error: error.message }, { status });
}

export async function projectFromRequest(request: Request, existing?: ProjectConfig): Promise<ProjectConfig> {
  const body = await readJsonObject(request);
  const rootPath = stringFromJson(body.rootPath) ?? existing?.rootPath;
  if (!rootPath) {
    throw new Error("Project rootPath is required.");
  }

  const resolvedRoot = resolve(rootPath);
  const info = await stat(resolvedRoot);
  if (!info.isDirectory()) {
    throw new Error("Project rootPath must point to a directory.");
  }

  const now = new Date().toISOString();
  const name = stringFromJson(body.name) ?? existing?.name ?? basename(resolvedRoot);
  const id = existing?.id ?? stringFromJson(body.id) ?? crypto.randomUUID();
  const ignorePatterns = readIgnorePatterns(body, existing);

  return {
    id,
    name,
    rootPath: resolvedRoot,
    ignorePatterns,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function graphSliceParams(request: Request): { kind: string; target: string | null } {
  const url = new URL(request.url);
  return {
    kind: url.searchParams.get("kind") ?? "overview",
    target: url.searchParams.get("target"),
  };
}

export async function graphSliceFromPostBody(request: Request, ctx: ProjectRouteContext): Promise<GraphSlice | Response> {
  const { projectId } = await ctx.params;
  const body = await readJsonObject(request);
  const kind = stringFromJson(body.kind) ?? "overview";
  const target = stringFromJson(body.target);
  const store = new AtlasStore();
  const project = store.getProject(projectId);

  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  return buildGraphSlice(
    kind as GraphSliceKind,
    target,
    store.getNodes(projectId),
    store.getEdges(projectId),
    store.getIssues(projectId),
    store.getLatestSummary(projectId) ?? createEmptySummary(project),
  );
}

function readIgnorePatterns(body: JsonObject, existing?: ProjectConfig): string[] {
  const value = body.ignorePatterns;
  if (Array.isArray(value)) {
    return stringArrayFromJson(value);
  }

  if (typeof value === "string") {
    return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  if (isJsonObject(body.ignore) && typeof body.ignore.patterns === "string") {
    return body.ignore.patterns.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  return existing?.ignorePatterns ?? [];
}
