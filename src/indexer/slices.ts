import type { GraphEdge, GraphNode, GraphSlice, GraphSliceKind, GraphSummary, IssueSignal } from "@/lib/atlas/types";
import { buildMermaid } from "@/indexer/mermaid";

type SliceSelection = { nodes: GraphNode[]; edges: GraphEdge[]; issues: IssueSignal[] };

type SliceSelector = (input: SliceInput) => SliceSelection;

type SliceInput = {
  target: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  issues: IssueSignal[];
};

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
): SliceSelection {
  return sliceSelectors[kind]({ target, nodes, edges, issues });
}

const sliceSelectors: Record<GraphSliceKind, SliceSelector> = {
  overview: overviewSlice,
  workspace: workspaceSlice,
  feature: featureSlice,
  route: routeSlice,
  dependencies: dependenciesSlice,
  contracts: contractsSlice,
  runtime: runtimeSlice,
  duplicates: duplicatesSlice,
  slop: slopSlice,
  issues: issuesSlice,
};

function overviewSlice({ nodes, edges, issues }: SliceInput): SliceSelection {
  const overviewKinds = new Set(["project", "workspace", "feature", "surface", "route"]);
  const selectedNodes = nodes.filter((node) => overviewKinds.has(node.kind));
  const nodeIds = new Set(selectedNodes.map((node) => node.id));

  return {
    nodes: selectedNodes,
    edges: edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    issues,
  };
}

function workspaceSlice({ target, nodes, edges, issues }: SliceInput): SliceSelection {
  const matchingNodes = target
    ? nodes.filter((node) => node.id === target || node.metadata.workspaceKey === target)
    : nodes.filter((node) => node.kind === "workspace");
  return expandByOneHop(nodes, edges, issues, idsForNodes(matchingNodes));
}

function featureSlice({ target, nodes, edges, issues }: SliceInput): SliceSelection {
  const matchingNodes = nodes.filter((node) => node.featureId === target || node.id === target);
  return expandByOneHop(nodes, edges, issues, idsForNodes(matchingNodes));
}

function routeSlice({ target, nodes, edges, issues }: SliceInput): SliceSelection {
  const routeNode = nodes.find((node) => node.id === target || (node.kind === "route" && node.label === target));
  return expandByOneHop(nodes, edges, issues, idsForNodes(routeNode ? [routeNode] : []));
}

function dependenciesSlice({ target, nodes, edges, issues }: SliceInput): SliceSelection {
  const seed = target ? nodes.find((node) => node.id === target || node.filePath === target) : nodes.find((node) => node.kind === "project");
  return expandByOneHop(nodes, edges, issues, idsForNodes(seed ? [seed] : []));
}

function contractsSlice({ target, nodes, edges, issues }: SliceInput): SliceSelection {
  const contractNode = target ? nodes.find((node) => node.id === target || node.filePath === target) : null;
  const contractNodes = contractNode ? [contractNode] : nodes.filter(isContractNode);
  return expandByOneHop(nodes, edges, issues, idsForNodes(contractNodes));
}

function runtimeSlice({ target, nodes, edges, issues }: SliceInput): SliceSelection {
  const runtimeNode = target ? nodes.find((node) => node.id === target || node.filePath === target) : null;
  const runtimeNodes = runtimeNode ? [runtimeNode] : nodes.filter((node) => node.kind === "runtime");
  return expandByOneHop(nodes, edges, issues, idsForNodes(runtimeNodes));
}

function duplicatesSlice({ nodes, edges, issues }: SliceInput): SliceSelection {
  const duplicateIssues = issues.filter((issue) => issue.kind === "duplicate-logic");
  return byIssueEvidence(nodes, edges, duplicateIssues);
}

function slopSlice({ nodes, edges, issues }: SliceInput): SliceSelection {
  return byIssueEvidence(nodes, edges, issues.filter(isSlopIssue));
}

function issuesSlice({ target, nodes, edges, issues }: SliceInput): SliceSelection {
  const selectedIssues = target ? issues.filter((issue) => issue.id === target) : issues;
  return byIssueEvidence(nodes, edges, selectedIssues);
}

function idsForNodes(nodes: GraphNode[]): Set<string> {
  return new Set(nodes.map((node) => node.id));
}

function byIssueEvidence(nodes: GraphNode[], edges: GraphEdge[], issues: IssueSignal[]): SliceSelection {
  return byNodeIds(nodes, edges, issues, new Set(issues.flatMap((issue) => issue.evidenceNodeIds)));
}

function isContractNode(node: GraphNode): boolean {
  return node.kind === "type" || node.kind === "permission" || node.kind === "dependency";
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
