export type WorkspaceKind = "app" | "package" | "test" | "script" | "config" | "docs" | "source";

export type WorkspaceInfo = {
  key: string;
  kind: WorkspaceKind;
  name: string;
  label: string;
};

export function workspaceFromPath(filePath: string): WorkspaceInfo {
  const segments = filePath.split("/").filter(Boolean);
  const fileName = segments.at(-1);
  if (!fileName) {
    return workspace("source", "root");
  }

  if (isTestPath(filePath, segments)) {
    return workspace("test", testWorkspaceName(segments));
  }

  if (segments[0] === "apps" && segments[1]) {
    return workspace("app", segments[1]);
  }

  if ((segments[0] === "packages" || segments[0] === "libs") && segments[1]) {
    return workspace("package", segments[1]);
  }

  if (segments[0] === "scripts" || segments[0] === "tools") {
    return workspace("script", segments[0]);
  }

  if (segments[0] === "docs" || segments[0] === "documentation") {
    return workspace("docs", segments[0]);
  }

  if (isConfigPath(fileName, segments)) {
    return workspace("config", "root");
  }

  if (segments[0] === "src") {
    return workspace("app", "root");
  }

  return workspace("source", segments[0] ?? "root");
}

export function runtimeWorkspaceFromPath(filePath: string): WorkspaceInfo {
  const segments = filePath.split("/").filter(Boolean);
  if (segments.length === 1) {
    return workspace("app", "root");
  }

  const workspaceInfo = workspaceFromPath(filePath);
  if (workspaceInfo.kind === "config" && workspaceInfo.name === "root") {
    return workspace("app", "root");
  }

  return workspaceInfo;
}

function workspace(kind: WorkspaceKind, name: string): WorkspaceInfo {
  const prefix = workspacePrefix(kind);
  const label = kind === "source" ? name : `${prefix}/${name}`;
  return {
    key: `${kind}:${name}`,
    kind,
    name,
    label,
  };
}

function workspacePrefix(kind: WorkspaceKind): string {
  if (kind === "app") {
    return "apps";
  }
  if (kind === "package") {
    return "packages";
  }
  if (kind === "test") {
    return "tests";
  }
  if (kind === "script") {
    return "scripts";
  }
  if (kind === "docs") {
    return "docs";
  }

  return "config";
}

function isTestPath(filePath: string, segments: string[]): boolean {
  return /\.test\.[jt]sx?$|\.spec\.[jt]sx?$/.test(filePath)
    || segments.some((segment) => segment === "__tests__" || segment === "tests" || segment === "test" || segment === "e2e");
}

function testWorkspaceName(segments: string[]): string {
  if (segments[0] === "apps" && segments[1]) {
    return segments[1];
  }

  if ((segments[0] === "packages" || segments[0] === "libs") && segments[1]) {
    return segments[1];
  }

  return "root";
}

function isConfigPath(fileName: string, segments: string[]): boolean {
  return segments.length === 1 && /(?:config|rc)\.[cm]?[jt]s$|package\.json|tsconfig\.json|jsconfig\.json|vite\.config\.[jt]s|next\.config\.[jt]s/.test(fileName);
}
