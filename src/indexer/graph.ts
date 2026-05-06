import type {
  AnalyzedFile,
  GraphEdge,
  GraphNode,
  GraphSummary,
  IssueSignal,
  PermissionRecord,
  ProjectConfig,
  RuntimeDiagnostic,
  RuntimePortRecord,
  RuntimeProfile,
  RuntimeScriptRecord,
  ScanResult,
} from "@/lib/atlas/types";
import { detectIssues } from "@/indexer/issues";
import {
  dependencyNodeId,
  featureNodeId,
  fileNodeId,
  issueNodeId,
  permissionNodeId,
  routeNodeId,
  runtimeNodeId,
  stableId,
  surfaceNodeId,
  typeNodeId,
  workspaceNodeId,
} from "@/indexer/ids";
import { isProjectLocalImport, resolveImportPath } from "@/indexer/routes";
import type { ImportResolverConfig } from "@/indexer/tsconfig";
import { runtimeWorkspaceFromPath, workspaceFromPath } from "@/indexer/workspace";

type UnresolvedImportRecord = {
  filePath: string;
  specifier: string;
};

export function buildProjectGraph(
  project: ProjectConfig,
  scanId: string,
  files: AnalyzedFile[],
  resolverConfig: ImportResolverConfig,
  runtimeProfile: RuntimeProfile,
): ScanResult {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const knownFiles = new Set(files.map((file) => file.path));
  const featureFileCounts = countBy(files.map((file) => file.featureId));
  const workspacesByPath = new Map(files.map((file) => [file.path, workspaceFromPath(file.path)]));
  const workspaceFileCounts = countBy([...workspacesByPath.values()].map((workspace) => workspace.key));
  const routes = files.flatMap((file) => file.routes);
  const routeByPath = new Map(routes.map((route) => [route.path, route]));
  const projectNodeId = stableId("project", project.id);
  let internalImportCount = 0;
  let externalDependencyCount = 0;
  let unresolvedImportCount = 0;
  let componentCount = 0;
  let hookCount = 0;
  let typeCount = 0;
  let permissionCount = 0;
  let runtimePortCount = 0;
  const unresolvedImports: UnresolvedImportRecord[] = [];

  upsertNode(nodes, {
    id: projectNodeId,
    kind: "project",
    label: project.name,
    filePath: null,
    featureId: null,
    metadata: { rootPath: project.rootPath },
  });

  for (const file of files) {
    const featureId = featureNodeId(file.featureId);
    const workspace = workspacesByPath.get(file.path);
    if (!workspace) {
      throw new Error(`Missing workspace for ${file.path}`);
    }
    const workspaceId = workspaceNodeId(workspace.key);
    const surfaceId = surfaceNodeId(file.surface);
    const sourceFileId = fileNodeId(file.path);
    const featureFileCount = featureFileCounts.get(file.featureId);
    if (featureFileCount === undefined) {
      throw new Error(`Missing feature count for ${file.featureId}`);
    }
    const workspaceFileCount = workspaceFileCounts.get(workspace.key);
    if (workspaceFileCount === undefined) {
      throw new Error(`Missing workspace count for ${workspace.key}`);
    }

    upsertNode(nodes, {
      id: workspaceId,
      kind: "workspace",
      label: workspace.label,
      filePath: null,
      featureId: null,
      metadata: { workspaceKey: workspace.key, workspaceKind: workspace.kind, workspaceName: workspace.name, fileCount: workspaceFileCount },
    });
    upsertNode(nodes, {
      id: featureId,
      kind: "feature",
      label: file.featureId,
      filePath: null,
      featureId: file.featureId,
      metadata: { fileCount: featureFileCount },
    });
    upsertNode(nodes, {
      id: surfaceId,
      kind: "surface",
      label: file.surface,
      filePath: null,
      featureId: null,
      metadata: {},
    });
    upsertNode(nodes, {
      id: sourceFileId,
      kind: "file",
      label: file.path.split("/").at(-1) ?? file.path,
      filePath: file.path,
      featureId: file.featureId,
      metadata: {
        path: file.path,
        surface: file.surface,
        language: file.language,
        size: file.size,
        imports: file.imports.length,
        exports: file.exports.length,
        workspaceKey: workspace.key,
        workspaceKind: workspace.kind,
        workspaceName: workspace.name,
        typeDeclarations: file.typeDeclarations.length,
        permissions: file.permissions.length,
      },
    });

    upsertEdge(edges, projectNodeId, workspaceId, "contains", { flow: "workspace" });
    upsertEdge(edges, projectNodeId, featureId, "contains", {});
    upsertEdge(edges, projectNodeId, surfaceId, "contains", {});
    upsertEdge(edges, workspaceId, sourceFileId, "contains", { flow: "workspace" });
    upsertEdge(edges, featureId, sourceFileId, "contains", {});
    upsertEdge(edges, surfaceId, sourceFileId, "contains", {});

    for (const route of file.routes) {
      const routeId = routeNodeId(route.path, route.kind);
      upsertNode(nodes, {
        id: routeId,
        kind: "route",
        label: route.path,
        filePath: file.path,
        featureId: file.featureId,
        metadata: { routeKind: route.kind },
      });
      upsertEdge(edges, featureId, routeId, "owns", { routeKind: route.kind });
      upsertEdge(edges, routeId, sourceFileId, "implements", {});
    }

    for (const component of file.components) {
      componentCount += 1;
      const componentId = stableId("component", `${file.path}:${component}`);
      upsertNode(nodes, {
        id: componentId,
        kind: "component",
        label: component,
        filePath: file.path,
        featureId: file.featureId,
        metadata: {},
      });
      upsertEdge(edges, sourceFileId, componentId, "declares", {});
    }

    for (const hook of file.hooks) {
      hookCount += 1;
      const hookId = stableId("hook", `${file.path}:${hook}`);
      upsertNode(nodes, {
        id: hookId,
        kind: "hook",
        label: hook,
        filePath: file.path,
        featureId: file.featureId,
        metadata: {},
      });
      upsertEdge(edges, sourceFileId, hookId, "declares", {});
    }

    for (const typeDeclaration of file.typeDeclarations) {
      typeCount += 1;
      const nodeId = typeNodeId(file.path, typeDeclaration);
      upsertNode(nodes, {
        id: nodeId,
        kind: "type",
        label: typeDeclaration,
        filePath: file.path,
        featureId: file.featureId,
        metadata: { workspaceKey: workspace.key },
      });
      upsertEdge(edges, sourceFileId, nodeId, "declares", { contract: "type", health: "good", flow: "outflow" });
    }

    for (const permission of permissionsForFile(file)) {
      permissionCount += 1;
      const nodeId = permissionNodeId(permission.kind, permission.source);
      const health = permissionHealth(file, permission);
      upsertNode(nodes, {
        id: nodeId,
        kind: "permission",
        label: permission.source,
        filePath: null,
        featureId: null,
        metadata: { permissionKind: permission.kind },
      });
      upsertEdge(edges, sourceFileId, nodeId, "uses", {
        permissionKind: permission.kind,
        source: permission.source,
        line: permission.line,
        health,
        flow: "outflow",
      });
    }

    for (const port of file.ports) {
      runtimePortCount += 1;
      const runtimeId = runtimeNodeId(`source-port:${file.path}:${port.port}:${port.kind}:${port.line}`);
      upsertNode(nodes, {
        id: runtimeId,
        kind: "runtime",
        label: `:${port.port}`,
        filePath: file.path,
        featureId: file.featureId,
        metadata: { runtimeKind: "port", port: port.port, source: port.source, line: port.line, workspaceKey: workspace.key },
      });
      upsertEdge(edges, sourceFileId, runtimeId, "configures", {
        port: port.port,
        source: port.source,
        line: port.line,
        health: "good",
        flow: "runtime",
      });
    }

    for (const imported of file.imports) {
      const resolved = resolveImportPath(project.rootPath, file.path, imported.specifier, knownFiles, resolverConfig);
      if (resolved) {
        internalImportCount += 1;
        upsertEdge(edges, sourceFileId, fileNodeId(resolved), "imports", {
          specifier: imported.specifier,
          importKind: imported.kind,
          importMode: imported.mode,
          health: "good",
          flow: imported.mode === "type" ? "type" : "inflow",
        });
        continue;
      }

      if (isProjectLocalImport(imported.specifier, resolverConfig)) {
        unresolvedImportCount += 1;
        unresolvedImports.push({ filePath: file.path, specifier: imported.specifier });
        const unresolvedDependencyId = dependencyNodeId(`unresolved:${imported.specifier}`);
        upsertNode(nodes, {
          id: unresolvedDependencyId,
          kind: "dependency",
          label: imported.specifier,
          filePath: null,
          featureId: null,
          metadata: { external: false, unresolved: true },
        });
        upsertEdge(edges, sourceFileId, unresolvedDependencyId, "imports", {
          specifier: imported.specifier,
          importKind: imported.kind,
          importMode: imported.mode,
          unresolved: true,
          health: "broken",
          flow: imported.mode === "type" ? "type" : "inflow",
        });
      } else {
        externalDependencyCount += 1;
        const dependencyId = dependencyNodeId(imported.specifier);
        upsertNode(nodes, {
          id: dependencyId,
          kind: "dependency",
          label: imported.specifier,
          filePath: null,
          featureId: null,
          metadata: { external: true },
        });
        upsertEdge(edges, sourceFileId, dependencyId, "imports", {
          specifier: imported.specifier,
          importKind: imported.kind,
          importMode: imported.mode,
          health: "good",
          flow: imported.mode === "type" ? "type" : "inflow",
        });
      }
    }

    for (const apiCall of file.apiCalls) {
      const targetRoute = routeByPath.get(apiCall);
      if (targetRoute) {
        upsertEdge(edges, sourceFileId, routeNodeId(targetRoute.path, targetRoute.kind), "calls", { apiCall, health: "good", flow: "outflow" });
      } else {
        const missingRouteId = routeNodeId(apiCall, "missing-api");
        upsertNode(nodes, {
          id: missingRouteId,
          kind: "route",
          label: apiCall,
          filePath: null,
          featureId: file.featureId,
          metadata: { routeKind: "missing-api", unresolved: true },
        });
        upsertEdge(edges, sourceFileId, missingRouteId, "calls", { apiCall, health: "broken", flow: "outflow" });
      }
    }
  }

  addRuntimeProfileGraph(nodes, edges, projectNodeId, runtimeProfile);
  runtimePortCount += runtimeProfile.ports.length;

  const graphNodes = [...nodes.values()];
  const graphEdges = [...edges.values()];
  const issues = detectIssues(files, graphEdges);
  issues.push(...detectUnresolvedImportIssues(unresolvedImports));
  issues.push(...detectSourceRuntimePortMismatches(files, runtimeProfile.ports));
  issues.push(...runtimeDiagnosticsToIssues(runtimeProfile.diagnostics));

  for (const issue of issues) {
    const nodeId = issueNodeId(issue.id);
    graphNodes.push({
      id: nodeId,
      kind: "issue",
      label: issue.title,
      filePath: issue.filePaths[0] ?? null,
      featureId: null,
      metadata: {
        issueKind: issue.kind,
        severity: issue.severity,
        confidence: issue.confidence,
      },
    });

    for (const evidenceNodeId of issue.evidenceNodeIds) {
      const health = issue.severity === "critical" ? "broken" : "warning";
      graphEdges.push({
        id: stableId("edge", `${nodeId}:flags:${evidenceNodeId}`),
        source: nodeId,
        target: evidenceNodeId,
        kind: issue.kind === "duplicate-logic" ? "duplicates" : issue.kind === "dependency-cycle" ? "cycles" : "flags",
        metadata: { issueId: issue.id, health, flow: "signal" },
      });
    }
  }

  const summary: GraphSummary = {
    projectName: project.name,
    fileCount: files.length,
    workspaceCount: workspaceFileCounts.size,
    featureCount: new Set(files.map((file) => file.featureId)).size,
    routeCount: routes.length,
    internalImportCount,
    externalDependencyCount,
    unresolvedImportCount,
    componentCount,
    hookCount,
    typeCount,
    permissionCount,
    runtimePortCount,
    startupIssueCount: issues.filter((issue) => issue.kind === "startup-problem" || issue.kind === "port-mismatch" || issue.kind === "env-contract-risk").length,
    timingIssueCount: issues.filter((issue) => issue.kind === "timer-without-cleanup" || issue.kind === "suspicious-async-effect" || issue.kind === "stale-closure-risk" || issue.kind === "unguarded-parallel-async").length,
    brokenEdgeCount: graphEdges.filter((edge) => edge.metadata.health === "broken").length,
    warningEdgeCount: graphEdges.filter((edge) => edge.metadata.health === "warning").length,
    edgeCount: graphEdges.length,
    issueCount: issues.length,
    scanId,
    scannedAt: new Date().toISOString(),
  };

  return {
    files,
    nodes: graphNodes,
    edges: graphEdges,
    issues,
    summary,
  };
}

function upsertNode(nodes: Map<string, GraphNode>, node: GraphNode) {
  if (!nodes.has(node.id)) {
    nodes.set(node.id, node);
  }
}

function upsertEdge(
  edges: Map<string, GraphEdge>,
  source: string,
  target: string,
  kind: GraphEdge["kind"],
  metadata: GraphEdge["metadata"],
) {
  const normalizedMetadata: GraphEdge["metadata"] = { health: "good", flow: "structural", ...metadata };
  const id = stableId("edge", `${source}:${kind}:${target}:${JSON.stringify(normalizedMetadata)}`);
  if (edges.has(id)) {
    return;
  }

  edges.set(id, {
    id,
    source,
    target,
    kind,
    metadata: normalizedMetadata,
  });
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const existingCount = counts.get(value);
    counts.set(value, existingCount === undefined ? 1 : existingCount + 1);
  }

  return counts;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function addRuntimeProfileGraph(
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  projectNodeId: string,
  runtimeProfile: RuntimeProfile,
) {
  for (const script of runtimeProfile.scripts) {
    addRuntimeScript(nodes, edges, projectNodeId, script);
  }

  for (const port of runtimeProfile.ports) {
    addRuntimePort(nodes, edges, projectNodeId, port);
  }

  for (const diagnostic of runtimeProfile.diagnostics) {
    for (const filePath of diagnostic.filePaths) {
      addRuntimeConfig(nodes, edges, projectNodeId, filePath);
    }
  }
}

function addRuntimeScript(
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  projectNodeId: string,
  script: RuntimeScriptRecord,
) {
  const configId = addRuntimeConfig(nodes, edges, projectNodeId, script.filePath);
  const scriptId = runtimeNodeId(`script:${script.filePath}:${script.scriptName}`);
  upsertNode(nodes, {
    id: scriptId,
    kind: "runtime",
    label: `${script.scriptName}`,
    filePath: script.filePath,
    featureId: null,
    metadata: {
      runtimeKind: "script",
      packageName: script.packageName,
      command: script.command,
      ports: script.ports,
      workspaceKey: script.workspaceKey,
    },
  });
  upsertEdge(edges, configId, scriptId, "configures", { script: script.scriptName, health: scriptHealth(script), flow: "startup" });
}

function addRuntimePort(
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  projectNodeId: string,
  port: RuntimePortRecord,
) {
  const configId = addRuntimeConfig(nodes, edges, projectNodeId, port.filePath);
  const portId = runtimeNodeId(`port:${port.workspaceKey}:${port.port}:${port.kind}:${port.source}:${port.filePath}`);
  upsertNode(nodes, {
    id: portId,
    kind: "runtime",
    label: `:${port.port}`,
    filePath: port.filePath,
    featureId: null,
    metadata: {
      runtimeKind: "port",
      port: port.port,
      portKind: port.kind,
      source: port.source,
      line: port.line,
      workspaceKey: port.workspaceKey,
    },
  });
  upsertEdge(edges, configId, portId, "configures", { port: port.port, health: "good", flow: "runtime" });
}

function addRuntimeConfig(
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  projectNodeId: string,
  filePath: string,
): string {
  const configId = runtimeNodeId(`config:${filePath}`);
  upsertNode(nodes, {
    id: configId,
    kind: "runtime",
    label: filePath,
    filePath,
    featureId: null,
    metadata: { runtimeKind: "config", workspaceKey: runtimeWorkspaceFromPath(filePath).key },
  });
  upsertEdge(edges, projectNodeId, configId, "contains", { flow: "runtime" });
  return configId;
}

function detectUnresolvedImportIssues(unresolvedImports: UnresolvedImportRecord[]): IssueSignal[] {
  const byFile = new Map<string, string[]>();
  for (const unresolvedImport of unresolvedImports) {
    const existing = byFile.get(unresolvedImport.filePath);
    if (existing) {
      existing.push(unresolvedImport.specifier);
    } else {
      byFile.set(unresolvedImport.filePath, [unresolvedImport.specifier]);
    }
  }

  return [...byFile.entries()].map(([filePath, specifiers]) => {
    const uniqueSpecifiers = [...new Set(specifiers)];
    return {
      id: `unresolved-import:${filePath}`,
      kind: "unresolved-import",
      severity: "warning",
      confidence: 0.82,
      title: `${uniqueSpecifiers.length} unresolved local import${uniqueSpecifiers.length === 1 ? "" : "s"}`,
      evidenceNodeIds: [fileNodeId(filePath)],
      filePaths: [filePath],
      explanation: `${filePath} imports ${uniqueSpecifiers.join(", ")}, but those aliases or relative paths did not resolve to indexed files.`,
    };
  });
}

function runtimeDiagnosticsToIssues(diagnostics: RuntimeDiagnostic[]): IssueSignal[] {
  return diagnostics.map((diagnostic, index) => ({
    id: `${diagnostic.kind}:${index}:${diagnostic.filePaths.join("|")}`,
    kind: diagnostic.kind,
    severity: diagnostic.severity,
    confidence: diagnostic.confidence,
    title: diagnostic.title,
    evidenceNodeIds: diagnostic.filePaths.map((filePath) => runtimeNodeId(`config:${filePath}`)),
    filePaths: diagnostic.filePaths,
    explanation: diagnostic.explanation,
  }));
}

function detectSourceRuntimePortMismatches(files: AnalyzedFile[], runtimePorts: RuntimePortRecord[]): IssueSignal[] {
  const sourcePortsByWorkspace = new Map<string, AnalyzedFile[]>();
  for (const file of files) {
    if (file.ports.length === 0) {
      continue;
    }

    const workspaceKey = workspaceFromPath(file.path).key;
    sourcePortsByWorkspace.set(workspaceKey, [...(sourcePortsByWorkspace.get(workspaceKey) ?? []), file]);
  }

  const runtimePortsByWorkspace = new Map<string, RuntimePortRecord[]>();
  for (const port of runtimePorts) {
    runtimePortsByWorkspace.set(port.workspaceKey, [...(runtimePortsByWorkspace.get(port.workspaceKey) ?? []), port]);
  }

  const issues: IssueSignal[] = [];
  for (const [workspaceKey, sourceFiles] of sourcePortsByWorkspace) {
    const declaredRuntimePorts = runtimePortsByWorkspace.get(workspaceKey);
    if (!declaredRuntimePorts || declaredRuntimePorts.length === 0) {
      continue;
    }

    const sourcePorts = new Set(sourceFiles.flatMap((file) => file.ports.map((port) => port.port)));
    const runtimePortSet = new Set(declaredRuntimePorts.map((port) => port.port));
    const hasOverlap = [...sourcePorts].some((port) => runtimePortSet.has(port));
    if (hasOverlap) {
      continue;
    }

    const sourceFilePaths = sourceFiles.map((file) => file.path);
    const runtimeFilePaths = declaredRuntimePorts.map((port) => port.filePath);
    const filePaths = unique([...sourceFilePaths, ...runtimeFilePaths]);
    issues.push({
      id: `port-mismatch:${workspaceKey}:source-runtime`,
      kind: "port-mismatch",
      severity: "warning",
      confidence: 0.84,
      title: `${workspaceKey} source ports do not match runtime config`,
      evidenceNodeIds: [
        ...sourceFilePaths.map((filePath) => fileNodeId(filePath)),
        ...unique(runtimeFilePaths).map((filePath) => runtimeNodeId(`config:${filePath}`)),
      ],
      filePaths,
      explanation: `${workspaceKey} listens on ${[...sourcePorts].join(", ")} in source files while runtime config declares ${[...runtimePortSet].join(", ")}. Align app code, scripts, Docker/env, proxies, callbacks, and health checks.`,
    });
  }

  return issues;
}

function scriptHealth(script: RuntimeScriptRecord): "good" | "warning" {
  if (script.scriptName === "start" && isDevelopmentStartCommand(script.command)) {
    return "warning";
  }

  return "good";
}

function isDevelopmentStartCommand(command: string): boolean {
  return /(?:^|&&|\s)(?:next\s+dev\b|vite\b|tsx\s+watch\b|nodemon\b|ts-node-dev\b)/.test(command);
}

function permissionsForFile(file: AnalyzedFile): PermissionRecord[] {
  const permissions = [...file.permissions];
  for (const imported of file.imports) {
    const permission = permissionFromImport(imported.specifier);
    if (permission) {
      permissions.push(permission);
    }
  }

  const seen = new Set<string>();
  const uniquePermissions: PermissionRecord[] = [];
  for (const permission of permissions) {
    const key = `${permission.kind}:${permission.source}:${permission.line}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniquePermissions.push(permission);
  }

  return uniquePermissions;
}

function permissionFromImport(specifier: string): PermissionRecord | null {
  if (/^(node:)?fs(?:\/promises)?$/.test(specifier)) {
    return { kind: "filesystem", source: specifier, line: 1 };
  }

  if (/^(node:)?child_process$/.test(specifier)) {
    return { kind: "shell", source: specifier, line: 1 };
  }

  if (/^(node:)?process$/.test(specifier)) {
    return { kind: "process", source: specifier, line: 1 };
  }

  if (/sqlite|prisma|drizzle|sequelize|typeorm|mongoose|database/i.test(specifier)) {
    return { kind: "database", source: specifier, line: 1 };
  }

  return null;
}

function permissionHealth(file: AnalyzedFile, permission: PermissionRecord): "good" | "warning" {
  const isPresentationSurface = file.surface === "components"
    || file.routes.some((route) => route.kind === "page" || route.kind === "layout" || route.kind === "react-router");
  const serverOnlyPermission = permission.kind === "filesystem"
    || permission.kind === "shell"
    || permission.kind === "database"
    || permission.kind === "process";

  return isPresentationSurface && serverOnlyPermission ? "warning" : "good";
}
