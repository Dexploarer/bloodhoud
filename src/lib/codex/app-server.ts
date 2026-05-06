import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { isJsonObject } from "@/lib/atlas/json";
import type { CodexAccount, CodexLogin, CodexPlanType, CodexSession, JsonObject, JsonValue } from "@/lib/atlas/types";
import { Logger } from "@/lib/logger";

type PendingRequest = {
  resolve: (value: JsonObject) => void;
  reject: (error: Error) => void;
};

type CodexAppServerGlobal = typeof globalThis & {
  atlasCodexClient?: CodexAppServerClient;
};

class CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private ready: Promise<void> | null = null;

  async account(refreshToken: boolean): Promise<CodexSession> {
    const response = await this.request("account/read", { refreshToken });
    const result = objectField(response, "result");
    if (!result) {
      throw new Error("Codex account/read response did not include a result.");
    }

    return sessionFromResult(result);
  }

  async startChatGptLogin(): Promise<CodexLogin> {
    const response = await this.request("account/login/start", { type: "chatgpt" });
    const result = objectField(response, "result");
    if (!result) {
      throw new Error("Codex account/login/start response did not include a result.");
    }

    return loginFromResult(result);
  }

  async logout(): Promise<CodexSession> {
    await this.request("account/logout", undefined);
    return this.account(false);
  }

  private async request(method: string, params: JsonObject | undefined): Promise<JsonObject> {
    await this.ensureReady();
    const process = this.process;
    if (!process) {
      throw new Error("Codex app-server is not running.");
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const message = params === undefined ? { method, id } : { method, id, params };
    const response = new Promise<JsonObject>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    process.stdin.write(`${JSON.stringify(message)}\n`);
    return response;
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.start();
    }

    return this.ready;
  }

  private start(): Promise<void> {
    this.process = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
    const process = this.process;
    const lines = readline.createInterface({ input: process.stdout });

    process.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message.length > 0) {
        Logger.warn("CodexAppServer", "Codex app-server stderr.", { message });
      }
    });

    process.on("exit", (code) => {
      Logger.warn("CodexAppServer", "Codex app-server exited.", { code });
      for (const pending of this.pending.values()) {
        pending.reject(new Error("Codex app-server exited before replying."));
      }
      this.pending.clear();
      this.process = null;
      this.ready = null;
    });

    lines.on("line", (line) => this.handleLine(line));

    return new Promise((resolve, reject) => {
      const initId = this.nextRequestId;
      this.nextRequestId += 1;
      this.pending.set(initId, {
        resolve: () => {
          process.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
          resolve();
        },
        reject,
      });
      process.stdin.write(
        `${JSON.stringify({
          method: "initialize",
          id: initId,
          params: {
            clientInfo: { name: "bloodhoud", title: "Bloodhoud", version: "0.1.0" },
            capabilities: null,
          },
        })}\n`,
      );
    });
  }

  private handleLine(line: string) {
    const parsed = parseJsonLine(line);
    if (!parsed) {
      Logger.warn("CodexAppServer", "Ignored non-JSON app-server line.", { line });
      return;
    }

    const id = numberField(parsed, "id");
    if (id === null) {
      this.handleNotification(parsed);
      return;
    }

    const pending = this.pending.get(id);
    if (!pending) {
      Logger.warn("CodexAppServer", "Ignored response for unknown request.", { id });
      return;
    }

    this.pending.delete(id);
    const error = objectField(parsed, "error");
    if (error) {
      pending.reject(new Error(stringField(error, "message") ?? "Codex app-server request failed."));
      return;
    }

    pending.resolve(parsed);
  }

  private handleNotification(message: JsonObject) {
    const method = stringField(message, "method");
    if (method === "account/login/completed" || method === "account/updated") {
      Logger.info("CodexAppServer", "Received Codex account notification.", { method });
    }
  }
}

export function codexAppServer(): CodexAppServerClient {
  const shared = globalThis as CodexAppServerGlobal;
  if (!shared.atlasCodexClient) {
    shared.atlasCodexClient = new CodexAppServerClient();
  }

  return shared.atlasCodexClient;
}

function sessionFromResult(result: JsonObject): CodexSession {
  const accountValue = result.account;
  const account = isJsonObject(accountValue) ? accountFromJson(accountValue) : null;
  return {
    connected: account?.type === "chatgpt",
    requiresOpenaiAuth: result.requiresOpenaiAuth === true,
    account,
  };
}

function accountFromJson(value: JsonObject): CodexAccount {
  const type = stringField(value, "type");
  if (type === "chatgpt") {
    return {
      type,
      email: stringField(value, "email") ?? "unknown",
      planType: planTypeFromJson(value.planType),
    };
  }

  if (type === "apiKey") {
    return { type };
  }

  if (type === "amazonBedrock") {
    return { type };
  }

  throw new Error("Codex returned an unsupported account type.");
}

function loginFromResult(result: JsonObject): CodexLogin {
  const type = stringField(result, "type");
  if (type === "chatgpt") {
    const loginId = stringField(result, "loginId");
    const authUrl = stringField(result, "authUrl");
    if (!loginId || !authUrl) {
      throw new Error("Codex ChatGPT login response was missing loginId or authUrl.");
    }

    return { type, loginId, authUrl };
  }

  if (type === "chatgptDeviceCode") {
    const loginId = stringField(result, "loginId");
    const verificationUrl = stringField(result, "verificationUrl");
    const userCode = stringField(result, "userCode");
    if (!loginId || !verificationUrl || !userCode) {
      throw new Error("Codex device-code login response was incomplete.");
    }

    return { type, loginId, verificationUrl, userCode };
  }

  if (type === "apiKey" || type === "chatgptAuthTokens") {
    return { type };
  }

  throw new Error("Codex returned an unsupported login response type.");
}

function parseJsonLine(line: string): JsonObject | null {
  try {
    const parsed = JSON.parse(line) as JsonValue;
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function objectField(value: JsonObject, key: string): JsonObject | null {
  const field = value[key];
  return isJsonObject(field) ? field : null;
}

function stringField(value: JsonObject, key: string): string | null {
  const field = value[key];
  return typeof field === "string" ? field : null;
}

function numberField(value: JsonObject, key: string): number | null {
  const field = value[key];
  return typeof field === "number" ? field : null;
}

function planTypeFromJson(value: JsonValue): CodexPlanType {
  return typeof value === "string" && isCodexPlanType(value) ? value : "unknown";
}

function isCodexPlanType(value: string): value is CodexPlanType {
  return (
    value === "free" ||
    value === "go" ||
    value === "plus" ||
    value === "pro" ||
    value === "prolite" ||
    value === "team" ||
    value === "self_serve_business_usage_based" ||
    value === "business" ||
    value === "enterprise_cbp_usage_based" ||
    value === "enterprise" ||
    value === "edu" ||
    value === "unknown"
  );
}
