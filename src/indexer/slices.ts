import type { GraphEdge, GraphNode, GraphSlice, GraphSliceKind, GraphSummary, IssueSignal } from "@/lib/atlas/types";
import { buildMermaid } from "@/indexer/mermaid";

export function buildGraphSlice(
  kind: GraphSliceKind,
  target: string | null,
  nodes: GraphNode[],
  edges: GraphEdge[],
  issues: IssueSignal[],
  summary: GraphSummary,
): GraphSlice {
  const selected = selectSlice(kind, target, nodes, edges, issues);
  return {
    kind,
    target,
    nodes: selected.nodes,
    edges: selected.edges,
    issues: selected.issues,
    summary,
    mermaid: buildMermaid(selected.nodes, selected.edges, selected.issues),
  };
}

function selectSlice(
  kind: GraphSliceKind,
  target: string | null,
  nodes: GraphNode[],
  edges: GraphEdge[],
  issues: IssueSignal[],
): { nodes: GraphNode[]; edges: GraphEdge[]; issues: IssueSignal[] } {
  if (kind === "overview") {
    const overviewKinds = new Set(["project", "workspace", "feature", "surface", "route"]);
    const ids = new Set(nodes.filter((node) => overviewKinds.has(node.kind)).map((node) => node.id));
    const selectedNodes = nodes.filter((node) => ids.has(node.id));
    const nodeIds = new Set(selectedNodes.map((node) => node.id));
    return {
      nodes: selectedNodes,
      edges: edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
      issues,
    };
  }

  if (kind === "workspace") {
    const matchingNodes = target
      ? nodes.filter((node) => node.id === target || node.metadata.workspaceKey === target)
      : nodes.filter((node) => node.kind === "workspace");
    return expandByOneHop(nodes, edges, issues, new Set(matchingNodes.map((node) => node.id)));
  }

  if (kind === "feature") {
    const matchingNodes = nodes.filter((node) => node.featureId === target || node.id === target);
    return expandByOneHop(nodes, edges, issues, new Set(matchingNodes.map((node) => node.id)));
  }

  if (kind === "route") {
    const routeNode = nodes.find((node) => node.id === target || (node.kind === "route" && node.label === target));
    return expandByOneHop(nodes, edges, issues, new Set(routeNode ? [routeNode.id] : []));
  }

  if (kind === "dependencies") {
    const seed = target ? nodes.find((node) => node.id === target || node.filePath === target) : nodes.find((node) => node.kind === "project");
    return expandByOneHop(nodes, edges, issues, new Set(seed ? [seed.id] : []));
  }

  if (kind === "contracts") {
    const contractNode = target
      ? nodes.find((node) => node.id === target || node.filePath === target)
      : null;
    const contractIds = contractNode
      ? new Set([contractNode.id])
      : new Set(nodes.filter((node) => node.kind === "type" || node.kind === "permission" || node.kind === "dependency").map((node) => node.id));
    return expandByOneHop(nodes, edges, issues, contractIds);
  }

  if (kind === "runtime") {
    const runtimeNode = target
      ? nodes.find((node) => node.id === target || node.filePath === target)
      : null;
    const runtimeIds = runtimeNode
      ? new Set([runtimeNode.id])
      : new Set(nodes.filter((node) => node.kind === "runtime").map((node) => node.id));
    return expandByOneHop(nodes, edges, issues, runtimeIds);
  }

  if (kind === "duplicates") {
    const duplicateIssues = issues.filter((issue) => issue.kind === "duplicate-logic");
    return byNodeIds(nodes, edges, duplicateIssues, new Set(duplicateIssues.flatMap((issue) => issue.evidenceNodeIds)));
  }

  if (kind === "slop") {
    const slopIssues = issues.filter(isSlopIssue);
    return byNodeIds(nodes, edges, slopIssues, new Set(slopIssues.flatMap((issue) => issue.evidenceNodeIds)));
  }

  const selectedIssue = target ? issues.filter((issue) => issue.id === target) : issues;
  return byNodeIds(nodes, edges, selectedIssue, new Set(selectedIssue.flatMap((issue) => issue.evidenceNodeIds)));
}

function expandByOneHop(
  nodes: GraphNode[],
  edges: GraphEdge[],
  issues: IssueSignal[],
  seedIds: Set<string>,
): { nodes: GraphNode[]; edges: GraphEdge[]; issues: IssueSignal[] } {
  const ids = new Set(seedIds);

  for (const edge of edges) {
    if (seedIds.has(edge.source)) {
      ids.add(edge.target);
    }
    if (seedIds.has(edge.target)) {
      ids.add(edge.source);
    }
  }

  return byNodeIds(nodes, edges, issues, ids);
}

function byNodeIds(
  nodes: GraphNode[],
  edges: GraphEdge[],
  issues: IssueSignal[],
  ids: Set<string>,
): { nodes: GraphNode[]; edges: GraphEdge[]; issues: IssueSignal[] } {
  const issueIds = new Set(
    issues
      .filter((issue) => issue.evidenceNodeIds.some((nodeId) => ids.has(nodeId)))
      .flatMap((issue) => [`issue:${issue.id}`, ...issue.evidenceNodeIds]),
  );
  const selectedIds = new Set([...ids, ...issueIds]);
  const selectedNodes = nodes.filter((node) => selectedIds.has(node.id) || node.kind === "issue" && issues.some((issue) => node.id.includes(issue.id)));
  const nodeIds = new Set(selectedNodes.map((node) => node.id));

  return {
    nodes: selectedNodes.slice(0, 160),
    edges: edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)).slice(0, 240),
    issues: issues.filter((issue) => issue.evidenceNodeIds.some((nodeId) => nodeIds.has(nodeId))),
  };
}

function isSlopIssue(issue: IssueSignal): boolean {
  return new Set<IssueSignal["kind"]>([
    "duplicate-logic",
    "suspicious-async-effect",
    "stale-closure-risk",
    "unguarded-parallel-async",
    "timer-without-cleanup",
    "unresolved-import",
    "port-mismatch",
    "startup-problem",
    "env-contract-risk",
    "high-divergence",
    "weak-typing",
    "silent-fallback",
    "swallowed-error",
    "console-debugging",
    "placeholder-code",
    "boundary-leak",
    "oversized-file",
  ]).has(issue.kind);
}
