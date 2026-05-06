import { createHash } from "node:crypto";

export function stableId(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha1").update(value).digest("hex").slice(0, 16)}`;
}

export function fileNodeId(filePath: string): string {
  return `file:${filePath}`;
}

export function routeNodeId(routePath: string, kind: string): string {
  return `route:${kind}:${routePath}`;
}

export function featureNodeId(featureId: string): string {
  return `feature:${featureId}`;
}

export function workspaceNodeId(workspaceKey: string): string {
  return `workspace:${workspaceKey}`;
}

export function surfaceNodeId(surface: string): string {
  return `surface:${surface}`;
}

export function issueNodeId(issueId: string): string {
  return `issue:${issueId}`;
}

export function dependencyNodeId(specifier: string): string {
  return `dependency:${specifier}`;
}

export function permissionNodeId(kind: string, source: string): string {
  return stableId("permission", `${kind}:${source}`);
}

export function typeNodeId(filePath: string, name: string): string {
  return stableId("type", `${filePath}:${name}`);
}

export function runtimeNodeId(value: string): string {
  return stableId("runtime", value);
}
