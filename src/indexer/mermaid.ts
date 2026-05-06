import type { GraphEdge, GraphNode, IssueSignal } from "@/lib/atlas/types";

export function buildMermaid(nodes: GraphNode[], edges: GraphEdge[], issues: IssueSignal[] = []): string {
  const visibleNodes = nodes.slice(0, 80);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)).slice(0, 120);
  const lines = ["flowchart LR"];

  for (const node of visibleNodes) {
    lines.push(`  ${mermaidId(node.id)}["${escapeLabel(`${node.label}\\n${node.kind}`)}"]`);
  }

  for (const edge of visibleEdges) {
    lines.push(`  ${mermaidId(edge.source)} -->|"${escapeLabel(edge.kind)}"| ${mermaidId(edge.target)}`);
  }

  const issueNodeIds = new Set(issues.flatMap((issue) => issue.evidenceNodeIds));
  for (const node of visibleNodes) {
    if (issueNodeIds.has(node.id) || node.kind === "issue") {
      lines.push(`  class ${mermaidId(node.id)} issue`);
    }
  }

  lines.push("  classDef issue fill:#fff7ed,stroke:#c2410c,color:#7c2d12");
  lines.push("  classDef default fill:#f8fafc,stroke:#94a3b8,color:#0f172a");

  return lines.join("\n");
}

function mermaidId(id: string): string {
  return `n_${id.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function escapeLabel(value: string): string {
  return value.replace(/"/g, "'").replace(/\n/g, "<br/>");
}
