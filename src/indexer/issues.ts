import type { AnalyzedFile, GraphEdge, IssueSignal } from "@/lib/atlas/types";
import { fileNodeId } from "@/indexer/ids";

export function detectIssues(files: AnalyzedFile[], edges: GraphEdge[]): IssueSignal[] {
  const issues: IssueSignal[] = [];
  issues.push(...detectDuplicateLogic(files));
  issues.push(...detectDependencyCycles(edges));
  issues.push(...detectAsyncIssues(files));
  issues.push(...detectSlopSignals(files));
  issues.push(...detectMissingRouteHandlers(files));
  issues.push(...detectRouteDeadEnds(files));
  issues.push(...detectBoundaryLeaks(files));
  issues.push(...detectOversizedFiles(files));
  issues.push(...detectHighDivergence(edges));
  return issues;
}

function detectDuplicateLogic(files: AnalyzedFile[]): IssueSignal[] {
  const groups = new Map<string, AnalyzedFile["fingerprints"]>();

  for (const file of files) {
    for (const item of file.fingerprints) {
      const group = groups.get(item.hash) ?? [];
      group.push(item);
      groups.set(item.hash, group);
    }
  }

  const issues: IssueSignal[] = [];
  for (const [hash, group] of groups) {
    const filePaths = [...new Set(group.map((item) => item.filePath))];
    if (filePaths.length < 2) {
      continue;
    }

    const id = `duplicate-logic:${hash}`;
    issues.push({
      id,
      kind: "duplicate-logic",
      severity: "warning",
      confidence: 0.86,
      title: `Duplicate logic across ${filePaths.length} files`,
      evidenceNodeIds: filePaths.map(fileNodeId),
      filePaths,
      explanation: `Normalized function bodies match across ${filePaths.length} files. This usually points to copy-pasted logic that can drift during cleanup.`,
    });
  }

  return issues;
}

function detectDependencyCycles(edges: GraphEdge[]): IssueSignal[] {
  const imports = edges.filter((edge) => edge.kind === "imports" && edge.source.startsWith("file:") && edge.target.startsWith("file:"));
  const adjacency = new Map<string, string[]>();

  for (const edge of imports) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  }

  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  for (const node of adjacency.keys()) {
    walk(node);
  }

  return cycles.slice(0, 25).map((cycle, index) => ({
    id: `dependency-cycle:${index}:${cycle.join(">")}`,
    kind: "dependency-cycle",
    severity: "critical",
    confidence: 0.94,
    title: `Dependency cycle across ${cycle.length} files`,
    evidenceNodeIds: cycle,
    filePaths: cycle.map((nodeId) => pathFromFileNodeId(nodeId)),
    explanation: "A circular import can cause partially initialized modules, order-dependent bugs, and confusing AI edits.",
  }));

  function walk(node: string) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      if (start >= 0) {
        cycles.push(stack.slice(start));
      }
      return;
    }

    if (visited.has(node)) {
      return;
    }

    visiting.add(node);
    stack.push(node);

    for (const next of adjacency.get(node) ?? []) {
      walk(next);
    }

    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }
}

function detectAsyncIssues(files: AnalyzedFile[]): IssueSignal[] {
  const issues: IssueSignal[] = [];

  for (const file of files) {
    for (const signal of file.asyncSignals) {
      const kind = signal.kind === "async-effect" ? "suspicious-async-effect" : signal.kind;
      const id = `${kind}:${file.path}:${signal.line}`;
      issues.push({
        id,
        kind,
        severity: kind === "suspicious-async-effect" || kind === "timer-without-cleanup" ? "warning" : "info",
        confidence: kind === "stale-closure-risk" ? 0.68 : kind === "timer-without-cleanup" ? 0.8 : 0.74,
        title: signal.detail,
        evidenceNodeIds: [fileNodeId(file.path)],
        filePaths: [file.path],
        explanation: `${file.path}:${signal.line} ${signal.detail} Treat this as a static signal to inspect, not proof of a runtime bug.`,
      });
    }
  }

  return issues;
}

function detectSlopSignals(files: AnalyzedFile[]): IssueSignal[] {
  const issues: IssueSignal[] = [];

  for (const file of files) {
    const grouped = new Map<AnalyzedFile["slopSignals"][number]["kind"], AnalyzedFile["slopSignals"]>();
    for (const signal of file.slopSignals) {
      grouped.set(signal.kind, [...(grouped.get(signal.kind) ?? []), signal]);
    }

    for (const [kind, signals] of grouped) {
      const first = signals[0];
      const severity = kind === "swallowed-error" || kind === "weak-typing" ? "warning" : "info";
      const lineList = signals.map((signal) => signal.line).slice(0, 6).join(", ");
      issues.push({
        id: `${kind}:${file.path}`,
        kind,
        severity,
        confidence: confidenceForSlop(kind),
        title: signals.length === 1 ? first.detail : `${slopKindLabel(kind)} appears ${signals.length} times`,
        evidenceNodeIds: [fileNodeId(file.path)],
        filePaths: [file.path],
        explanation: `${file.path}:${lineList} ${first.detail} Repair path: ${first.repair}`,
      });
    }
  }

  return issues;
}

function detectMissingRouteHandlers(files: AnalyzedFile[]): IssueSignal[] {
  const knownApiRoutes = new Set(
    files.flatMap((file) => file.routes.filter((route) => route.kind === "api-route").map((route) => route.path)),
  );
  const issues: IssueSignal[] = [];

  for (const file of files) {
    for (const apiCall of file.apiCalls) {
      if (!apiCall.startsWith("/api") || knownApiRoutes.has(apiCall)) {
        continue;
      }

      const id = `missing-route-handler:${file.path}:${apiCall}`;
      issues.push({
        id,
        kind: "missing-route-handler",
        severity: "critical",
        confidence: 0.78,
        title: `No route handler found for ${apiCall}`,
        evidenceNodeIds: [fileNodeId(file.path)],
        filePaths: [file.path],
        explanation: `${file.path} calls ${apiCall}, but no matching Next route handler or pages API file was indexed.`,
      });
    }
  }

  return issues;
}

function detectRouteDeadEnds(files: AnalyzedFile[]): IssueSignal[] {
  const issues: IssueSignal[] = [];

  for (const file of files) {
    const pageRoutes = file.routes.filter((route) => route.kind === "page" || route.kind === "react-router");
    if (pageRoutes.length === 0 || file.imports.length > 0 || file.components.length > 0) {
      continue;
    }

    for (const route of pageRoutes) {
      const id = `route-dead-end:${file.path}:${route.path}`;
      issues.push({
        id,
        kind: "route-dead-end",
        severity: "info",
        confidence: 0.58,
        title: `Route ${route.path} has no visible downstream surface`,
        evidenceNodeIds: [fileNodeId(file.path)],
        filePaths: [file.path],
        explanation: "The route file has no component declarations or imports, so the visual route trace stops immediately.",
      });
    }
  }

  return issues;
}

function detectBoundaryLeaks(files: AnalyzedFile[]): IssueSignal[] {
  const issues: IssueSignal[] = [];
  const serverOnlyPattern = /^(node:)?(fs|path|child_process|sqlite|net|tls)$|prisma|drizzle|sequelize|typeorm|mongoose|database|\/db\b|^@\/server/i;

  for (const file of files) {
    const isPresentationFile = file.surface === "components" || file.routes.some((route) => route.kind === "page" || route.kind === "layout" || route.kind === "react-router");
    const isApiRoute = file.routes.some((route) => route.kind === "api-route");
    if (!isPresentationFile || isApiRoute) {
      continue;
    }

    const leakingImports = file.imports.filter((item) => serverOnlyPattern.test(item.specifier));
    if (leakingImports.length === 0) {
      continue;
    }

    issues.push({
      id: `boundary-leak:${file.path}`,
      kind: "boundary-leak",
      severity: "critical",
      confidence: 0.76,
      title: "Presentation surface imports server or persistence concerns",
      evidenceNodeIds: [fileNodeId(file.path)],
      filePaths: [file.path],
      explanation: `${file.path} imports ${leakingImports.map((item) => item.specifier).join(", ")} from a presentation-facing surface. Move persistence and server-only work behind a route handler, use case, or domain service.`,
    });
  }

  return issues;
}

function detectOversizedFiles(files: AnalyzedFile[]): IssueSignal[] {
  return files
    .filter((file) => file.size > 24_000)
    .map((file) => ({
      id: `oversized-file:${file.path}`,
      kind: "oversized-file",
      severity: "warning",
      confidence: 0.7,
      title: "Oversized file likely mixes responsibilities",
      evidenceNodeIds: [fileNodeId(file.path)],
      filePaths: [file.path],
      explanation: `${file.path} is ${file.size.toLocaleString()} characters. Large generated files often mix UI, orchestration, state, and data shaping; split by route, feature, or domain responsibility before asking agents to edit it.`,
    }));
}

function detectHighDivergence(edges: GraphEdge[]): IssueSignal[] {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    if ((edge.kind === "imports" || edge.kind === "calls") && edge.source.startsWith("file:")) {
      counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 12)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([nodeId, count]) => ({
      id: `high-divergence:${nodeId}`,
      kind: "high-divergence",
      severity: count >= 24 ? "warning" : "info",
      confidence: count >= 24 ? 0.72 : 0.62,
      title: `High fan-out file with ${count} import or call paths`,
      evidenceNodeIds: [nodeId],
      filePaths: [pathFromFileNodeId(nodeId)],
      explanation: "This file fans out through many imports or API calls. Inspect it when debugging tangled ownership, but treat the signal as architectural pressure rather than a defect.",
    }));
}

function pathFromFileNodeId(nodeId: string): string {
  return nodeId.replace(/^file:/, "");
}

function confidenceForSlop(kind: AnalyzedFile["slopSignals"][number]["kind"]): number {
  if (kind === "swallowed-error") {
    return 0.82;
  }
  if (kind === "weak-typing") {
    return 0.76;
  }
  if (kind === "silent-fallback") {
    return 0.72;
  }
  if (kind === "placeholder-code") {
    return 0.68;
  }

  return 0.62;
}

function slopKindLabel(kind: AnalyzedFile["slopSignals"][number]["kind"]): string {
  if (kind === "weak-typing") {
    return "Weak typing";
  }
  if (kind === "silent-fallback") {
    return "Silent fallback";
  }
  if (kind === "swallowed-error") {
    return "Swallowed error";
  }
  if (kind === "console-debugging") {
    return "Console debugging";
  }

  return "Placeholder code";
}
