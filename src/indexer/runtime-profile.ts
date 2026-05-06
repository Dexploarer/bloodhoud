import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type { JsonObject, JsonValue, ProjectConfig, RuntimeDiagnostic, RuntimePortRecord, RuntimeProfile, RuntimeScriptRecord } from "@/lib/atlas/types";
import { createIgnoreMatcher, normalizePath } from "@/indexer/ignore-rules";
import { runtimeWorkspaceFromPath } from "@/indexer/workspace";

type RuntimeFile = {
  path: string;
  absolutePath: string;
  kind: "package-json" | "dockerfile" | "compose" | "env";
};

type MutableRuntimeProfile = RuntimeProfile;

export async function analyzeRuntimeProfile(project: ProjectConfig): Promise<RuntimeProfile> {
  const files = await discoverRuntimeFiles(project);
  const profile: MutableRuntimeProfile = {
    scripts: [],
    ports: [],
    diagnostics: [],
  };

  for (const file of files) {
    const content = await readFile(file.absolutePath, "utf8");
    if (file.kind === "package-json") {
      analyzePackageJson(file.path, content, profile);
    } else if (file.kind === "dockerfile") {
      analyzeDockerfile(file.path, content, profile);
    } else if (file.kind === "compose") {
      analyzeCompose(file.path, content, profile);
    } else {
      analyzeEnvFile(file.path, content, profile);
    }
  }

  profile.diagnostics.push(...detectPortMismatches(profile.ports));
  profile.diagnostics.push(...detectEnvContractRisks(files));
  return profile;
}

async function discoverRuntimeFiles(project: ProjectConfig): Promise<RuntimeFile[]> {
  const matcher = await createIgnoreMatcher(project.rootPath, project.ignorePatterns);
  const files: RuntimeFile[] = [];
  const pending = [project.rootPath];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) {
      break;
    }

    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const relativePath = normalizePath(relative(project.rootPath, absolutePath));

      if (relativePath.length > 0 && matcher.ignores(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }

      const kind = runtimeFileKind(entry.name);
      if (kind) {
        files.push({ path: relativePath, absolutePath, kind });
      }
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function analyzePackageJson(filePath: string, content: string, profile: MutableRuntimeProfile) {
  const parsed = parsePackageJson(filePath, content, profile);
  if (!parsed) {
    return;
  }

  const scriptsValue = parsed.scripts;
  if (!isJsonObject(scriptsValue)) {
    return;
  }

  const packageName = typeof parsed.name === "string" ? parsed.name : packageNameFromPath(filePath);
  const scripts = Object.entries(scriptsValue)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([scriptName, command]) => {
      const ports = portsFromText(command);
      const record: RuntimeScriptRecord = {
        filePath,
        packageName,
        scriptName,
        command,
        ports,
        workspaceKey: runtimeWorkspaceFromPath(filePath).key,
      };
      profile.scripts.push(record);
      for (const port of ports) {
        profile.ports.push(runtimePort(filePath, port, "script", scriptName, scriptLine(content, scriptName)));
      }

      return record;
    });

  profile.diagnostics.push(...detectStartupScriptProblems(filePath, packageName, scripts));
}

function analyzeDockerfile(filePath: string, content: string, profile: MutableRuntimeProfile) {
  content.split(/\r?\n/).forEach((line, index) => {
    const expose = line.match(/^\s*EXPOSE\s+(\d{2,5})\b/i);
    if (expose) {
      const port = parsePort(expose[1]);
      if (port) {
        profile.ports.push(runtimePort(filePath, port, "docker", "EXPOSE", index + 1));
      }
    }

    const envPort = line.match(/^\s*ENV\s+PORT[=\s]+(\d{2,5})\b/i);
    if (envPort) {
      const port = parsePort(envPort[1]);
      if (port) {
        profile.ports.push(runtimePort(filePath, port, "docker", "ENV PORT", index + 1));
      }
    }
  });
}

function analyzeCompose(filePath: string, content: string, profile: MutableRuntimeProfile) {
  content.split(/\r?\n/).forEach((line, index) => {
    for (const port of portsFromText(line)) {
      profile.ports.push(runtimePort(filePath, port, "docker", "compose ports", index + 1));
    }
  });
}

function analyzeEnvFile(filePath: string, content: string, profile: MutableRuntimeProfile) {
  content.split(/\r?\n/).forEach((line, index) => {
    const portMatch = line.match(/^\s*(?:PORT|APP_PORT|WEB_PORT|NEXT_PUBLIC_PORT)\s*=\s*(\d{2,5})\b/);
    if (portMatch) {
      const port = parsePort(portMatch[1]);
      if (port) {
        profile.ports.push(runtimePort(filePath, port, "env", "PORT", index + 1));
      }
    }

    for (const port of portsFromText(line)) {
      profile.ports.push(runtimePort(filePath, port, "env", "url", index + 1));
    }
  });
}

function detectStartupScriptProblems(
  filePath: string,
  packageName: string,
  scripts: RuntimeScriptRecord[],
): RuntimeDiagnostic[] {
  const diagnostics: RuntimeDiagnostic[] = [];
  const byName = new Map(scripts.map((script) => [script.scriptName, script]));
  const hasDevOrBuild = byName.has("dev") || byName.has("build");
  const start = byName.get("start");

  if (hasDevOrBuild && !start) {
    diagnostics.push({
      kind: "startup-problem",
      severity: "warning",
      confidence: 0.78,
      title: `${packageName} has no start script`,
      filePaths: [filePath],
      explanation: `${filePath} defines development or build scripts but no production start command. New contributors and deploy targets need an explicit startup path.`,
    });
  }

  if (start && isDevelopmentStartCommand(start.command)) {
    diagnostics.push({
      kind: "startup-problem",
      severity: "warning",
      confidence: 0.82,
      title: `${packageName} start script runs a development server`,
      filePaths: [filePath],
      explanation: `${filePath} uses "${start.command}" for start. Production startup should use the built artifact or framework production server.`,
    });
  }

  const dev = byName.get("dev");
  if (dev && start && dev.ports.length > 0 && start.ports.length > 0 && !samePortSet(dev.ports, start.ports)) {
    diagnostics.push({
      kind: "port-mismatch",
      severity: "warning",
      confidence: 0.86,
      title: `${packageName} dev and start scripts use different ports`,
      filePaths: [filePath],
      explanation: `${filePath} dev uses ${dev.ports.join(", ")} while start uses ${start.ports.join(", ")}. This often breaks callbacks, previews, health checks, and proxy config.`,
    });
  }

  return diagnostics;
}

function detectPortMismatches(ports: RuntimePortRecord[]): RuntimeDiagnostic[] {
  const byWorkspace = new Map<string, RuntimePortRecord[]>();
  for (const port of ports) {
    byWorkspace.set(port.workspaceKey, [...(byWorkspace.get(port.workspaceKey) ?? []), port]);
  }

  const diagnostics: RuntimeDiagnostic[] = [];
  for (const [workspaceKey, records] of byWorkspace) {
    const uniquePorts = [...new Set(records.map((record) => record.port))];
    if (uniquePorts.length < 2) {
      continue;
    }

    const filePaths = [...new Set(records.map((record) => record.filePath))];
    diagnostics.push({
      kind: "port-mismatch",
      severity: "warning",
      confidence: 0.8,
      title: `${workspaceKey} declares ${uniquePorts.length} runtime ports`,
      filePaths,
      explanation: `${workspaceKey} references ports ${uniquePorts.join(", ")} across ${filePaths.join(", ")}. Align app startup, Docker/env config, callbacks, and local proxy targets.`,
    });
  }

  return diagnostics;
}

function detectEnvContractRisks(files: RuntimeFile[]): RuntimeDiagnostic[] {
  const envFiles = files.filter((file) => file.kind === "env" && !file.path.includes(".example"));
  const availableEnvPaths = new Set(files.filter((file) => file.kind === "env").map((file) => file.path));
  return envFiles
    .filter((file) => envExampleCandidates(file.path).every((candidate) => !availableEnvPaths.has(candidate)))
    .slice(0, 10)
    .map((file) => ({
      kind: "env-contract-risk",
      severity: "info",
      confidence: 0.58,
      title: `${file.path} has no matching example env contract`,
      filePaths: [file.path],
      explanation: `${file.path} is present, but no matching example env file was indexed. Document required runtime variables so startup failures are visible before deploy.`,
    }));
}

function envExampleCandidates(filePath: string): string[] {
  if (filePath === ".env") {
    return [".env.example"];
  }

  if (filePath.endsWith(".local")) {
    return [filePath.replace(/\.local$/, ".example")];
  }

  return [`${filePath}.example`];
}

function runtimeFileKind(fileName: string): RuntimeFile["kind"] | null {
  const lower = fileName.toLowerCase();
  if (lower === "package.json") {
    return "package-json";
  }
  if (lower === "dockerfile" || lower.endsWith(".dockerfile")) {
    return "dockerfile";
  }
  if (lower === "docker-compose.yml" || lower === "docker-compose.yaml" || lower === "compose.yml" || lower === "compose.yaml") {
    return "compose";
  }
  if (lower === ".env" || lower.startsWith(".env.")) {
    return "env";
  }

  return null;
}

function runtimePort(
  filePath: string,
  port: number,
  kind: RuntimePortRecord["kind"],
  source: string,
  line: number,
): RuntimePortRecord {
  return {
    filePath,
    port,
    kind,
    source,
    line,
    workspaceKey: runtimeWorkspaceFromPath(filePath).key,
  };
}

function portsFromText(value: string): number[] {
  const ports = new Set<number>();
  for (const match of value.matchAll(/(?:--port(?:=|\s+)|PORT=|localhost:|127\.0\.0\.1:|0\.0\.0\.0:|:)(\d{2,5})/g)) {
    const port = parsePort(match[1]);
    if (port) {
      ports.add(port);
    }
  }

  return [...ports].sort((left, right) => left - right);
}

function parsePort(value: string): number | null {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return null;
  }

  return port;
}

function scriptLine(content: string, scriptName: string): number {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(`"${scriptName}"`));
  return index >= 0 ? index + 1 : 1;
}

function packageNameFromPath(filePath: string): string {
  const segments = filePath.split("/").filter(Boolean);
  if (segments.length >= 3 && (segments[0] === "apps" || segments[0] === "packages")) {
    return segments[1];
  }

  return basename(filePath);
}

function parsePackageJson(filePath: string, content: string, profile: MutableRuntimeProfile): JsonObject | null {
  try {
    const parsed = JSON.parse(content) as JsonValue;
    if (isJsonObject(parsed)) {
      return parsed;
    }
  } catch {
    profile.diagnostics.push({
      kind: "startup-problem",
      severity: "warning",
      confidence: 0.9,
      title: `${filePath} is not valid JSON`,
      filePaths: [filePath],
      explanation: `${filePath} could not be parsed, so Bloodhoud cannot trust package scripts, dependencies, or startup commands from this workspace.`,
    });
    return null;
  }

  profile.diagnostics.push({
    kind: "startup-problem",
    severity: "warning",
    confidence: 0.86,
    title: `${filePath} is not a JSON object`,
    filePaths: [filePath],
    explanation: `${filePath} parsed successfully but did not contain a package object, so startup scripts could not be indexed.`,
  });
  return null;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function samePortSet(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function isDevelopmentStartCommand(command: string): boolean {
  return /(?:^|&&|\s)(?:next\s+dev\b|vite\b|tsx\s+watch\b|nodemon\b|ts-node-dev\b)/.test(command);
}
