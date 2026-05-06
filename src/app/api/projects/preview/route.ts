import { previewIgnoreRules } from "@/indexer/ignore-rules";
import { errorResponse } from "@/lib/atlas/api";
import { readJsonObject, stringArrayFromJson, stringFromJson } from "@/lib/atlas/json";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const rootPath = stringFromJson(body.rootPath);
    if (!rootPath) {
      throw new Error("rootPath is required for ignore preview.");
    }

    const ignorePatterns = Array.isArray(body.ignorePatterns)
      ? stringArrayFromJson(body.ignorePatterns)
      : typeof body.ignorePatterns === "string"
        ? body.ignorePatterns.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        : [];
    const preview = await previewIgnoreRules(rootPath, ignorePatterns);
    return Response.json({ preview });
  } catch (error) {
    return errorResponse("ProjectPreviewApi", error instanceof Error ? error : new Error("Unable to preview ignore rules."), 400);
  }
}
