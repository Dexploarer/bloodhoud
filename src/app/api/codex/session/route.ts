import { errorResponse } from "@/lib/atlas/api";
import { codexAppServer } from "@/lib/codex/app-server";

export async function GET() {
  try {
    const session = await codexAppServer().account(false);
    return Response.json({ session });
  } catch (error) {
    return errorResponse("CodexSessionApi", error instanceof Error ? error : new Error("Could not read Codex session."));
  }
}
