import { errorResponse } from "@/lib/atlas/api";
import { codexAppServer } from "@/lib/codex/app-server";

export async function POST() {
  try {
    const session = await codexAppServer().logout();
    return Response.json({ session });
  } catch (error) {
    return errorResponse("CodexLogoutApi", error instanceof Error ? error : new Error("Could not sign out of Codex."));
  }
}
