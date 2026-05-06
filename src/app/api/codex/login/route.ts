import { errorResponse } from "@/lib/atlas/api";
import { codexAppServer } from "@/lib/codex/app-server";
import type { CodexLoginResponse } from "@/lib/atlas/types";

export async function POST() {
  try {
    const codex = codexAppServer();
    const currentSession = await codex.account(false);
    if (currentSession.connected) {
      const response: CodexLoginResponse = { session: currentSession, login: null };
      return Response.json(response);
    }

    const login = await codex.startChatGptLogin();
    const response: CodexLoginResponse = { session: currentSession, login };
    return Response.json(response);
  } catch (error) {
    return errorResponse("CodexLoginApi", error instanceof Error ? error : new Error("Could not start Codex login."));
  }
}
