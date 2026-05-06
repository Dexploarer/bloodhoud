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

type GraphCounters = {
  internalImportCount: number;
  externalDependencyCount: number;
  unresolvedImportCount: number;
  componentCount: number;
  hookCount: number;
  typeCount: number;
  permissionCount: number;
  runtimePortCount: number;
};

type GraphBuildState = {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  knownFiles: Set<string>;
  featureFileCounts: Map<string, number>;
  workspacesByPath: Map<string, ReturnType<typeof workspaceFromPath>>;
  workspaceFileCounts: Map<string, number>;
  routeByPath: Map<string, AnalyzedFile["routes"][number]>;
  routes: AnalyzedFile["routes"];
  projectNodeId: string;
  counters: GraphCounters;
  unresolvedImports: UnresolvedImportRecord[];
};

type FileGraphContext = {
  featureId: string;
  workspace: ReturnType<typeof workspaceFromPath>;
  workspaceId: string;
  surfaceId: string;
  sourceFileId: string;
  featureFileCount: number;
  workspaceFileCount: number;
};

export function buildProjectGraph(
  project: ProjectConfig,
  scanId: string,
  files: AnalyzedFile[],
  resolverConfig: ImportResolverConfig,
  runtimeProfile: RuntimeProfile,
): ScanResult {
  const state = createGraphBuildState(project, files);

  for (const file of files) {
    addFileToGraph(state, project, file, resolverConfig);
  }

  addRuntimeProfileGraph(state.nodes, state.edges, state.projectNodeId, runtimeProfile);
  state.counters.runtimePortCount += runtimeProfile.ports.length;

  const graphEdges = [...state.edges.values()];
  const issues = detectIssues(files, graphEdges);
  issues.push(...detectUnresolvedImportIssues(state.unresolvedImports));
  issues.push(...detectSourceRuntimePortMismatches(files, runtimeProfile.ports));
  issues.push(...runtimeDiagnosticsToIssues(runtimeProfile.diagnostics));
  const graphNodes = [...state.nodes.values()];
  addIssueEvidenceGraph(graphNodes, graphEdges, issues);
  const summary = buildGraphSummary(project, scanId, files, state, graphEdges, issues);

  return {
    files,
    nodes: graphNodes,
    edges: graphEdges,
    issues,
    summary,
  };
}

function createGraphBuildState(project: ProjectConfig, files: AnalyzedFile[]): GraphBuildState {
  const routes = files.flatMap((file) => file.routes);
  const workspacesByPath = new Map(files.map((file) => [file.path, workspaceFromPath(file.path)]));
  const state: GraphBuildState = {
    nodes: new Map(),
    edges: new Map(),
    knownFiles: new Set(files.map((file) => file.path)),
    featureFileCounts: countBy(files.map((file) => file.featureId)),
    workspacesByPath,
    workspaceFileCounts: countBy([...workspacesByPath.values()].map((workspace) => workspace.key)),
    routeByPath: new Map(routes.map((route) => [route.path, route])),
    routes,
    projectNodeId: stableId("project", project.id),
    counters: emptyGraphCounters(),
    unresolvedImports: [],
  };

  upsertNode(state.nodes, {
    id: state.projectNodeId,
    kind: "project",
    label: project.name,
    filePath: null,
    featureId: null,
    metadata: { rootPath: project.rootPath },
  });

  return state;
}

function emptyGraphCounters(): GraphCounters {
  return {
    internalImportCount: 0,
    externalDependencyCount: 0,
    unresolvedImportCount: 0,
    componentCount: 0,
    hookCount: 0,
    typeCount: 0,
    permissionCount: 0,
    runtimePortCount: 0,
  };
}

function addFileToGraph(
  state: GraphBuildState,
  project: ProjectConfig,
  file: AnalyzedFile,
  resolverConfig: ImportResolverConfig,
) {
  const context = fileGraphContext(state, file);
  addFileOwnershipGraph(state, file, context);
  addRouteGraph(state, file, context);
  addSymbolGraph(state, file, context);
  addTypeGraph(state, file, context);
  addPermissionGraph(state, file, context);
  addSourcePortGraph(state, file, context);
  addImportGraph(state, project, file, context, resolverConfig);
  addApiCallGraph(state, file, context);
}

function fileGraphContext(state: GraphBuildState, file: AnalyzedFile): FileGraphContext {
  const workspace = requiredValue(state.workspacesByPath.get(file.path), `Missing workspace for ${file.path}`);
  return {
    featureId: featureNodeId(file.featureId),
    workspace,
    workspaceId: workspaceNodeId(workspace.key),
    surfaceId: surfaceNodeId(file.surface),
    sourceFileId: fileNodeId(file.path),
    featureFileCount: requiredValue(state.featureFileCounts.get(file.featureId), `Missing feature count for ${file.featureId}`),
    workspaceFileCount: requiredValue(state.workspaceFileCounts.get(workspace.key), `Missing workspace count for ${workspace.key}`),
  };
}

function addFileOwnershipGraph(state: GraphBuildState, file: AnalyzedFile, context: FileGraphContext) {
  upsertNode(state.nodes, {
    id: context.workspaceId,
    kind: "workspace",
    label: context.workspace.label,
    filePath: null,
    featureId: null,
    metadata: { workspaceKey: context.workspace.key, workspaceKind: context.workspace.kind, workspaceName: context.workspace.name, fileCount: context.workspaceFileCount },
  });
  upsertNode(state.nodes, {
    id: context.featureId,
    kind: "feature",
    label: file.featureId,
    filePath: null,
    featureId: file.featureId,
    metadata: { fileCount: context.featureFileCount },
  });
  upsertNode(state.nodes, {
    id: context.surfaceId,
    kind: "surface",
    label: file.surface,
    filePath: null,
    featureId: null,
    metadata: {},
  });
  upsertFileNode(state, file, context);
  addOwnershipEdges(state, context);
}

function upsertFileNode(state: GraphBuildState, file: AnalyzedFile, context: FileGraphContext) {
  upsertNode(state.nodes, {
    id: context.sourceFileId,
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
      workspaceKey: context.workspace.key,
      workspaceKind: context.workspace.kind,
      workspaceName: context.workspace.name,
      typeDeclarations: file.typeDeclarations.length,
      permissions: file.permissions.length,
    },
  });
}

function addOwnershipEdges(state: GraphBuildState, context: FileGraphContext) {
  upsertEdge(state.edges, state.projectNodeId, context.workspaceId, "contains", { flow: "workspace" });
  upsertEdge(state.edges, state.projectNodeId, context.featureId, "contains", {});
  upsertEdge(state.edges, state.projectNodeId, context.surfaceId, "contains", {});
  upsertEdge(state.edges, context.workspaceId, context.sourceFileId, "contains", { flow: "workspace" });
  upsertEdge(state.edges, context.featureId, context.sourceFileId, "contains", {});
  upsertEdge(state.edges, context.surfaceId, context.sourceFileId, "contains", {});
}

function addRouteGraph(state: GraphBuildState, file: AnalyzedFile, context: FileGraphContext) {
  for (const route of file.routes) {
    const routeId = routeNodeId(route.path, route.kind);
    upsertNode(state.nodes, {
      id: routeId,
      kind: "route",
      label: route.path,
      filePath: file.path,
      featureId: file.featureId,
      metadata: { routeKind: route.kind },
    });
    upsertEdge(state.edges, context.featureId, routeId, "owns", { routeKind: route.kind });
    upsertEdge(state.edges, routeId, context.sourceFileId, "implements", {});
  }
}

function addSymbolGraph(state: GraphBuildState, file: AnalyzedFile, context: FileGraphContext) {
  for (const component of file.components) {
    state.counters.componentCount += 1;
    addDeclaredSymbol(state, file, context, "component", component, stableId("component", `${file.path}:${component}`));
  }

  for (const hook of file.hooks) {
    state.counters.hookCount += 1;
    addDeclaredSymbol(state, file, context, "hook", hook, stableId("hook", `${file.path}:${hook}`));
  }
}

function addDeclaredSymbol(
  state: GraphBuildState,
  file: AnalyzedFile,
  context: FileGraphContext,
  kind: "component" | "hook",
  label: string,
  id: string,
) {
  upsertNode(state.nodes, {
    id,
    kind,
    label,
    filePath: file.path,
    featureId: file.featureId,
    metadata: {},
  });
  upsertEdge(state.edges, context.sourceFileId, id, "declares", {});
}

function addTypeGraph(state: GraphBuildState, file: AnalyzedFile, context: FileGraphContext) {
  for (const typeDeclaration of file.typeDeclarations) {
    state.counters.typeCount += 1;
    const nodeId = typeNodeId(file.path, typeDeclaration);
    upsertNode(state.nodes, {
      id: nodeId,
      kind: "type",
      label: typeDeclaration,
      filePath: file.path,
      featureId: file.featureId,
      metadata: { workspaceKey: context.workspace.key },
    });
    upsertEdge(state.edges, context.sourceFileId, nodeId, "declares", { contract: "type", health: "good", flow: "outflow" });
  }
}

function addPermissionGraph(state: GraphBuildState, file: AnalyzedFile, context: FileGraphContext) {
  for (const permission of permissionsForFile(file)) {
    state.counters.permissionCount += 1;
    const nodeId = permissionNodeId(permission.kind, permission.source);
    upsertNode(state.nodes, {
      id: nodeId,
      kind: "permission",
      label: permission.source,
      filePath: null,
      featureId: null,
      metadata: { permissionKind: permission.kind },
    });
    upsertEdge(state.edges, context.sourceFileId, nodeId, "uses", {
      permissionKind: permission.kind,
      source: permission.source,
      line: permission.line,
      health: permissionHealth(file, permission),
      flow: "outflow",
    });
  }
}

function addSourcePortGraph(state: GraphBuildState, file: AnalyzedFile, context: FileGraphContext) {
  for (const port of file.ports) {
    state.counters.runtimePortCount += 1;
    const runtimeId = runtimeNodeId(`source-port:${file.path}:${port.port}:${port.kind}:${port.line}`);
    upsertNode(state.nodes, {
      id: runtimeId,
      kind: "runtime",
      label: `:${port.port}`,
      filePath: file.path,
      featureId: file.featureId,
      metadata: { runtimeKind: "port", port: port.port, source: port.source, line: port.line, workspaceKey: context.workspace.key },
    });
    upsertEdge(state.edges, context.sourceFileId, runtimeId, "configures", {
      port: port.port,
      source: port.source,
      line: port.line,
      health: "good",
      flow: "runtime",
    });
  }
}

function addImportGraph(
  state: GraphBuildState,
  project: ProjectConfig,
  file: AnalyzedFile,
  context: FileGraphContext,
  resolverConfig: ImportResolverConfig,
) {
  for (const imported of file.imports) {
    const resolved = resolveImportPath(project.rootPath, file.path, imported.specifier, state.knownFiles, resolverConfig);
    if (resolved) {
      addResolvedImport(state, imported, context.sourceFileId, resolved);
    } else if (isProjectLocalImport(imported.specifier, resolverConfig)) {
      addUnresolvedImport(state, file.path, imported, context.sourceFileId);
    } else {
      addExternalImport(state, imported, context.sourceFileId);
    }
  }
}

function addResolvedImport(
  state: GraphBuildState,
  imported: AnalyzedFile["imports"][number],
  sourceFileId: string,
  resolved: string,
) {
  state.counters.internalImportCount += 1;
  upsertEdge(state.edges, sourceFileId, fileNodeId(resolved), "imports", importEdgeMetadata(imported, "good"));
}

function addUnresolvedImport(
  state: GraphBuildState,
  filePath: string,
  imported: AnalyzedFile["imports"][number],
  sourceFileId: string,
) {
  state.counters.unresolvedImportCount += 1;
  state.unresolvedImports.push({ filePath, specifier: imported.specifier });
  const dependencyId = dependencyNodeId(`unresolved:${imported.specifier}`);
  upsertNode(state.nodes, {
    id: dependencyId,
    kind: "dependency",
    label: imported.specifier,
    filePath: null,
    featureId: null,
    metadata: { external: false, unresolved: true },
  });
  upsertEdge(state.edges, sourceFileId, dependencyId, "imports", importEdgeMetadata(imported, "broken", true));
}

function addExternalImport(state: GraphBuildState, imported: AnalyzedFile["imports"][number], sourceFileId: string) {
  state.counters.externalDependencyCount += 1;
  const dependencyId = dependencyNodeId(imported.specifier);
  upsertNode(state.nodes, {
    id: dependencyId,
    kind: "dependency",
    label: imported.specifier,
    filePath: null,
    featureId: null,
    metadata: { external: true },
  });
  upsertEdge(state.edges, sourceFileId, dependencyId, "imports", importEdgeMetadata(imported, "good"));
}

function importEdgeMetadata(
  imported: AnalyzedFile["imports"][number],
  health: "good" | "broken",
  unresolved = false,
): GraphEdge["metadata"] {
  return {
    specifier: imported.specifier,
    importKind: imported.kind,
    importMode: imported.mode,
    unresolved,
    health,
    flow: imported.mode === "type" ? "type" : "inflow",
  };
}

function addApiCallGraph(state: GraphBuildState, file: AnalyzedFile, context: FileGraphContext) {
  for (const apiCall of file.apiCalls) {
    const targetRoute = state.routeByPath.get(apiCall);
    if (targetRoute) {
      upsertEdge(state.edges, context.sourceFileId, routeNodeId(targetRoute.path, targetRoute.kind), "calls", { apiCall, health: "good", flow: "outflow" });
    } else {
      addMissingApiRoute(state, file, apiCall, context.sourceFileId);
    }
  }
}

function addMissingApiRoute(state: GraphBuildState, file: AnalyzedFile, apiCall: string, sourceFileId: string) {
  const missingRouteId = routeNodeId(apiCall, "missing-api");
  upsertNode(state.nodes, {
    id: missingRouteId,
    kind: "route",
    label: apiCall,
    filePath: null,
    featureId: file.featureId,
    metadata: { routeKind: "missing-api", unresolved: true },
  });
  upsertEdge(state.edges, sourceFileId, missingRouteId, "calls", { apiCall, health: "broken", flow: "outflow" });
}

function addIssueEvidenceGraph(graphNodes: GraphNode[], graphEdges: GraphEdge[], issues: IssueSignal[]) {
  for (const issue of issues) {
    const nodeId = issueNodeId(issue.id);
    graphNodes.push(issueNode(issue, nodeId));
    graphEdges.push(...issueEdges(issue, nodeId));
  }
}

function issueNode(issue: IssueSignal, nodeId: string): GraphNode {
  return {
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
  };
}

function issueEdges(issue: IssueSignal, nodeId: string): GraphEdge[] {
  return issue.evidenceNodeIds.map((evidenceNodeId) => ({
    id: stableId("edge", `${nodeId}:flags:${evidenceNodeId}`),
    source: nodeId,
    target: evidenceNodeId,
    kind: issueEdgeKind(issue),
    metadata: { issueId: issue.id, health: issue.severity === "critical" ? "broken" : "warning", flow: "signal" },
  }));
}

function issueEdgeKind(issue: IssueSignal): GraphEdge["kind"] {
  if (issue.kind === "duplicate-logic") {
    return "duplicates";
  }
  if (issue.kind === "dependency-cycle") {
    return "cycles";
  }

  return "flags";
}

function buildGraphSummary(
  project: ProjectConfig,
  scanId: string,
  files: AnalyzedFile[],
  state: GraphBuildState,
  graphEdges: GraphEdge[],
  issues: IssueSignal[],
): GraphSummary {
  return {
    projectName: project.name,
    fileCount: files.length,
    workspaceCount: state.workspaceFileCounts.size,
    featureCount: new Set(files.map((file) => file.featureId)).size,
    routeCount: state.routes.length,
    internalImportCount: state.counters.internalImportCount,
    externalDependencyCount: state.counters.externalDependencyCount,
    unresolvedImportCount: state.counters.unresolvedImportCount,
    componentCount: state.counters.componentCount,
    hookCount: state.counters.hookCount,
    typeCount: state.counters.typeCount,
    permissionCount: state.counters.permissionCount,
    runtimePortCount: state.counters.runtimePortCount,
    startupIssueCount: issues.filter(isStartupIssue).length,
    timingIssueCount: issues.filter(isTimingIssue).length,
    brokenEdgeCount: graphEdges.filter((edge) => edge.metadata.health === "broken").length,
    warningEdgeCount: graphEdges.filter((edge) => edge.metadata.health === "warning").length,
    edgeCount: graphEdges.length,
    issueCount: issues.length,
    scanId,
    scannedAt: new Date().toISOString(),
  };
}

function isStartupIssue(issue: IssueSignal): boolean {
  return issue.kind === "startup-problem" || issue.kind === "port-mismatch" || issue.kind === "env-contract-risk";
}

function isTimingIssue(issue: IssueSignal): boolean {
  return issue.kind === "timer-without-cleanup"
    || issue.kind === "suspicious-async-effect"
    || issue.kind === "stale-closure-risk"
    || issue.kind === "unguarded-parallel-async";
}

function requiredValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }

  return value;
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
