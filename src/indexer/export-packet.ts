import type { ExportPacket, GraphSlice } from "@/lib/atlas/types";
import { buildFactoryPacket, buildSoftwareFactoryProfile } from "@/indexer/factory";
import { buildDebugGuide } from "@/lib/atlas/debug-guide";

export function buildExportPacket(slice: GraphSlice): ExportPacket {
  const factoryPacket = buildFactoryPacket(buildSoftwareFactoryProfile(slice));
  const debugGuide = buildDebugGuide(slice);
  const files = [...new Set(slice.nodes.map((node) => node.filePath).filter((filePath): filePath is string => Boolean(filePath)))];
  const issues = slice.issues.map((issue) => {
    return `- ${issue.title} (${issue.kind}, ${issue.severity}, confidence ${Math.round(issue.confidence * 100)}%): ${issue.explanation}`;
  });
  const edges = slice.edges.slice(0, 80).map((edge) => {
    const source = slice.nodes.find((node) => node.id === edge.source)?.label ?? edge.source;
    const target = slice.nodes.find((node) => node.id === edge.target)?.label ?? edge.target;
    return `- ${source} --${edge.kind}--> ${target}`;
  });

  return {
    markdown: [
      `# Bloodhoud Packet: ${slice.kind}${slice.target ? ` / ${slice.target}` : ""}`,
      "",
      `Project: ${slice.summary.projectName}`,
      `Files indexed: ${slice.summary.fileCount}`,
      `Slice nodes: ${slice.nodes.length}`,
      `Slice edges: ${slice.edges.length}`,
      `Issues in slice: ${slice.issues.length}`,
      "",
      "## Files",
      files.length > 0 ? files.map((file) => `- ${file}`).join("\n") : "- No files in this slice.",
      "",
      "## Issue Signals",
      issues.length > 0 ? issues.join("\n") : "- No issue signals in this slice.",
      "",
      "## Graph Edges",
      edges.length > 0 ? edges.join("\n") : "- No edges in this slice.",
      "",
      "## Mermaid",
      "```mermaid",
      slice.mermaid,
      "```",
      "",
      "## Cleanup Prompt",
      "Use the files, evidence, and graph above to identify the smallest safe cleanup. Focus on duplicated logic, route divergence, suspicious async behavior, and dependency cycles. Explain every recommendation with file-level evidence before proposing edits.",
      "",
      "## Visual Debug Guide",
      `Architecture score: ${debugGuide.score}/100`,
      debugGuide.headline,
      "",
      "### Slop Radar",
      debugGuide.lanes.map((lane) => `- ${lane.label}: ${lane.count} signals, ${lane.severity}. Repair: ${lane.repair}`).join("\n"),
      "",
      "### Guided Debug Path",
      debugGuide.steps.map((step) => `- ${step.title}: ${step.nextAction}`).join("\n"),
      "",
      "### Architecture Recommendations",
      debugGuide.recommendations.map((item) => `- ${item.title}: ${item.from} -> ${item.to}`).join("\n"),
      "",
      "## Software Factory Handoff",
      factoryPacket.markdown,
    ].join("\n"),
  };
}
