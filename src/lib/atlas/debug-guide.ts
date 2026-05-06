import type {
  ArchitectureRecommendation,
  DebugGuide,
  DebugLane,
  DebugStep,
  GraphSlice,
  IssueSeverity,
  IssueSignal,
} from "@/lib/atlas/types";

type LaneConfig = {
  id: string;
  label: string;
  description: string;
  repair: string;
  kinds: IssueSignal["kind"][];
};

const lanes: LaneConfig[] = [
  {
    id: "architecture",
    label: "Architecture Drift",
    description: "Boundaries, fan-out, and oversized files that make the system hard to reason about.",
    repair: "Move work toward feature-owned use cases, thinner presentation, and explicit domain boundaries.",
    kinds: ["boundary-leak", "high-divergence", "oversized-file", "dependency-cycle"],
  },
  {
    id: "routes",
    label: "Route Flow",
    description: "Broken or incomplete start-to-finish paths through pages, handlers, and APIs.",
    repair: "Trace the route, connect missing handlers, and keep business work out of presentation files.",
    kinds: ["missing-route-handler", "route-dead-end", "unresolved-import"],
  },
  {
    id: "async",
    label: "Async Risk",
    description: "Effects and delayed work that can race, leak, or update stale state.",
    repair: "Add cancellation, dependency correctness, and tests around competing state changes.",
    kinds: ["suspicious-async-effect", "stale-closure-risk", "unguarded-parallel-async", "timer-without-cleanup"],
  },
  {
    id: "runtime",
    label: "Runtime Readiness",
    description: "Ports, startup commands, and env contracts that can fail before the app is usable.",
    repair: "Align ports, make production startup explicit, and document required env variables.",
    kinds: ["port-mismatch", "startup-problem", "env-contract-risk"],
  },
  {
    id: "duplication",
    label: "Copy Drift",
    description: "Near-identical logic that will diverge under repeated AI edits.",
    repair: "Compare intent first, then extract only the shared domain rule.",
    kinds: ["duplicate-logic"],
  },
  {
    id: "contracts",
    label: "Weak Contracts",
    description: "Weak types and hidden defaults that make invalid states look valid.",
    repair: "Validate once at the boundary and carry narrow required types through the pipeline.",
    kinds: ["weak-typing", "silent-fallback", "swallowed-error"],
  },
  {
    id: "polish",
    label: "Generated Residue",
    description: "Placeholders and debug traces that show a feature was generated but not finished.",
    repair: "Replace placeholders with real empty states or remove the debug residue entirely.",
    kinds: ["console-debugging", "placeholder-code"],
  },
];

export function buildDebugGuide(slice: GraphSlice): DebugGuide {
  const debugLanes = lanes.map((lane) => buildLane(lane, slice.issues));
  const activeLanes = debugLanes.filter((lane) => lane.count > 0);
  const score = architectureScore(slice.issues);

  return {
    score,
    headline: headlineForScore(score),
    lanes: debugLanes,
    steps: buildSteps(slice, activeLanes),
    recommendations: buildRecommendations(slice),
    mermaid: buildDebugMermaid(activeLanes),
  };
}

function buildLane(config: LaneConfig, issues: IssueSignal[]): DebugLane {
  const matching = issues.filter((issue) => config.kinds.includes(issue.kind));

  return {
    id: config.id,
    label: config.label,
    description: config.description,
    repair: config.repair,
    severity: highestSeverity(matching),
    issueIds: matching.map((issue) => issue.id),
    count: matching.length,
  };
}

function buildSteps(slice: GraphSlice, activeLanes: DebugLane[]): DebugStep[] {
  if (activeLanes.length === 0) {
    return [
      {
        id: "confirm-shape",
        title: "Confirm the architecture shape",
        why: "No slop signals are active in this slice, so use the graph to confirm ownership and route flow.",
        issueIds: [],
        files: [],
        nextAction: "Open the feature or route slice and verify the visual path matches the intended architecture.",
      },
    ];
  }

  return activeLanes
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || right.count - left.count)
    .slice(0, 6)
    .map((lane, index) => {
      const laneIssues = slice.issues.filter((issue) => lane.issueIds.includes(issue.id));
      return {
        id: `step-${lane.id}`,
        title: `${index + 1}. ${lane.label}`,
        why: lane.description,
        issueIds: lane.issueIds,
        files: unique(laneIssues.flatMap((issue) => issue.filePaths)).slice(0, 8),
        nextAction: lane.repair,
      };
    });
}

function buildRecommendations(slice: GraphSlice): ArchitectureRecommendation[] {
  const recommendations: ArchitectureRecommendation[] = [];
  const issueKinds = new Set(slice.issues.map((issue) => issue.kind));

  if (issueKinds.has("boundary-leak") || issueKinds.has("high-divergence")) {
    recommendations.push({
      id: "thin-presentation",
      title: "Thin the presentation surface",
      confidence: 0.82,
      rationale: "Presentation nodes should describe UI and delegate decisions to use cases or route handlers.",
      from: "Page/component imports server or orchestration concerns",
      to: "Page/component calls a typed boundary and renders the returned state",
    });
  }

  if (issueKinds.has("duplicate-logic")) {
    recommendations.push({
      id: "extract-domain-rule",
      title: "Extract shared domain rules",
      confidence: 0.86,
      rationale: "Duplicate normalized logic is likely a product rule hiding in multiple places.",
      from: "Copy-pasted feature logic",
      to: "One named domain function with focused call sites",
    });
  }

  if (issueKinds.has("weak-typing") || issueKinds.has("silent-fallback") || issueKinds.has("swallowed-error")) {
    recommendations.push({
      id: "strengthen-contracts",
      title: "Strengthen data contracts",
      confidence: 0.78,
      rationale: "Weak contracts let broken data travel deeper until it appears as unrelated UI behavior.",
      from: "Casts, silent defaults, and swallowed failures",
      to: "Boundary validation plus required domain fields",
    });
  }

  if (issueKinds.has("suspicious-async-effect") || issueKinds.has("stale-closure-risk") || issueKinds.has("unguarded-parallel-async") || issueKinds.has("timer-without-cleanup")) {
    recommendations.push({
      id: "stabilize-effects",
      title: "Stabilize async ownership",
      confidence: 0.74,
      rationale: "Async work should have one owner, explicit cancellation, and visible loading/error states.",
      from: "Component effect starts unguarded work",
      to: "Dedicated data hook or route-backed loader with cancellation",
    });
  }

  if (issueKinds.has("port-mismatch") || issueKinds.has("startup-problem") || issueKinds.has("env-contract-risk")) {
    recommendations.push({
      id: "runtime-contract",
      title: "Stabilize runtime startup",
      confidence: 0.8,
      rationale: "A clean architecture still feels broken when ports, scripts, and env contracts drift.",
      from: "Implicit local-only startup assumptions",
      to: "One documented production start path with aligned ports and env examples",
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: "preserve-shape",
      title: "Preserve the current shape",
      confidence: 0.66,
      rationale: "This slice has no strong slop signal, so the safest move is local cleanup without new abstraction.",
      from: "Unverified broad refactor",
      to: "Small slice-level improvement with tests",
    });
  }

  return recommendations;
}

function buildDebugMermaid(activeLanes: DebugLane[]): string {
  const lines = [
    "flowchart TD",
    "  Index[Index project] --> Map[Build visual map]",
    "  Map --> Radar[Slop radar]",
  ];

  for (const lane of activeLanes.slice(0, 8)) {
    lines.push(`  Radar --> ${nodeId(lane.id)}["${lane.label}<br/>${lane.count} signals"]`);
    lines.push(`  ${nodeId(lane.id)} --> Repair_${nodeId(lane.id)}["${shortLabel(lane.repair)}"]`);
  }

  if (activeLanes.length === 0) {
    lines.push("  Radar --> Confirm[Confirm current architecture]");
  }

  lines.push("  Radar --> Plan[Pick smallest safe repair]");
  lines.push("  Plan --> Packet[Export AI packet]");
  lines.push("  Packet --> Verify[Run tests and rescan]");
  lines.push("  classDef risk fill:#fef2f2,stroke:#dc2626,color:#7f1d1d");
  lines.push("  classDef repair fill:#f0fdf4,stroke:#16a34a,color:#14532d");

  for (const lane of activeLanes.slice(0, 8)) {
    lines.push(`  class ${nodeId(lane.id)} risk`);
    lines.push(`  class Repair_${nodeId(lane.id)} repair`);
  }

  return lines.join("\n");
}

function architectureScore(issues: IssueSignal[]): number {
  const penalty = issues.reduce((total, issue) => {
    if (issue.severity === "critical") {
      return total + 16;
    }
    if (issue.severity === "warning") {
      return total + 6;
    }
    return total + 1;
  }, 0);

  return Math.max(0, 100 - Math.min(95, penalty));
}

function headlineForScore(score: number): string {
  if (score >= 85) {
    return "Clean slice. Preserve the architecture and keep edits small.";
  }
  if (score >= 65) {
    return "Mostly stable. Fix warning clusters before broad refactors.";
  }
  if (score >= 40) {
    return "Slop is visible. Start with boundaries, contracts, and route flow.";
  }

  return "High-risk slice. Stabilize architecture before adding features.";
}

function highestSeverity(issues: IssueSignal[]): IssueSeverity {
  if (issues.some((issue) => issue.severity === "critical")) {
    return "critical";
  }
  if (issues.some((issue) => issue.severity === "warning")) {
    return "warning";
  }

  return "info";
}

function severityRank(severity: IssueSeverity): number {
  if (severity === "critical") {
    return 3;
  }
  if (severity === "warning") {
    return 2;
  }

  return 1;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].filter(Boolean);
}

function nodeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}

function shortLabel(value: string): string {
  return value.length > 58 ? `${value.slice(0, 55)}...` : value;
}
