import type {
  ContextSnapshot,
  FactoryAgent,
  FactoryGuardrail,
  FactoryMetric,
  FactoryPacket,
  FactoryTrigger,
  GraphSlice,
  ReusableSkill,
  SoftwareFactoryProfile,
} from "@/lib/atlas/types";

export function buildSoftwareFactoryProfile(slice: GraphSlice): SoftwareFactoryProfile {
  const generatedAt = new Date().toISOString();
  const criticalIssues = slice.issues.filter((issue) => issue.severity === "critical");
  const warningIssues = slice.issues.filter((issue) => issue.severity === "warning");
  const routeNodes = slice.nodes.filter((node) => node.kind === "route");
  const featureNodes = slice.nodes.filter((node) => node.kind === "feature");
  const fileNodes = slice.nodes.filter((node) => node.kind === "file");
  const dependencyEdges = slice.edges.filter((edge) => edge.kind === "imports");
  const contextScore = contextCoverageScore(slice);

  const metrics: FactoryMetric[] = [
    {
      label: "Context coverage",
      value: `${contextScore}%`,
      detail: `${slice.nodes.length} mapped nodes and ${slice.edges.length} relationships in this slice.`,
    },
    {
      label: "Factory readiness",
      value: criticalIssues.length > 0 ? "Review first" : warningIssues.length > 0 ? "Guarded" : "Ready",
      detail: `${criticalIssues.length} critical and ${warningIssues.length} warning signals shape the agent guardrails.`,
    },
    {
      label: "Agent lanes",
      value: "5",
      detail: "Context, planning, execution, review, and release sentinel lanes are generated from this graph.",
    },
    {
      label: "Reusable skills",
      value: `${buildReusableSkills(slice).length}`,
      detail: "Each skill turns a repeated cleanup or debugging pattern into a reusable agent prompt.",
    },
  ];

  const snapshots: ContextSnapshot[] = [
    {
      id: "architecture-map",
      title: "Architecture Map",
      description: `Feature, surface, route, and dependency structure for ${slice.summary.projectName}.`,
      sources: unique([
        ...featureNodes.map((node) => node.label),
        ...routeNodes.map((node) => node.label),
        ...fileNodes.slice(0, 12).map((node) => node.filePath ?? node.label),
      ]),
    },
    {
      id: "route-knowledge",
      title: "Route Knowledge",
      description: "Route start points, handlers, pages, and traced downstream files available to agents.",
      sources: routeNodes.map((node) => node.label),
    },
    {
      id: "issue-memory",
      title: "Issue Memory",
      description: "Explainable static signals preserved as context for review and cleanup workflows.",
      sources: slice.issues.map((issue) => `${issue.kind}: ${issue.title}`),
    },
    {
      id: "dependency-context",
      title: "Dependency Context",
      description: "Imports and shared package relationships that define safe execution boundaries.",
      sources: dependencyEdges.slice(0, 16).map((edge) => `${edge.source} -> ${edge.target}`),
    },
  ];

  const agents = buildAgents(slice);
  const triggers = buildTriggers(slice);
  const guardrails = buildGuardrails(slice);
  const skills = buildReusableSkills(slice);

  return {
    projectName: slice.summary.projectName,
    generatedAt,
    metrics,
    snapshots,
    agents,
    triggers,
    guardrails,
    skills,
    mermaid: buildFactoryMermaid(),
  };
}

export function buildFactoryPacket(profile: SoftwareFactoryProfile): FactoryPacket {
  return {
    profile,
    markdown: [
      `# Software Factory Context: ${profile.projectName}`,
      "",
      `Generated: ${profile.generatedAt}`,
      "",
      "## Metrics",
      profile.metrics.map((metric) => `- ${metric.label}: ${metric.value}. ${metric.detail}`).join("\n"),
      "",
      "## Context Snapshots",
      profile.snapshots.map((snapshot) => {
        const sources = snapshot.sources.length > 0 ? snapshot.sources.slice(0, 8).map((source) => `  - ${source}`).join("\n") : "  - No sources in current slice.";
        return `### ${snapshot.title}\n${snapshot.description}\n${sources}`;
      }).join("\n\n"),
      "",
      "## Agent Lanes",
      profile.agents.map((agent) => {
        return `### ${agent.name}\nRole: ${agent.role}\nTrigger: ${agent.trigger}\nInputs: ${agent.inputs.join(", ")}\nOutputs: ${agent.outputs.join(", ")}`;
      }).join("\n\n"),
      "",
      "## Triggers",
      profile.triggers.map((trigger) => `- ${trigger.name}: when ${trigger.event}, if ${trigger.condition}, then ${trigger.action}`).join("\n"),
      "",
      "## Guardrails",
      profile.guardrails.map((guardrail) => `- ${guardrail.name} (${guardrail.severity}): ${guardrail.rationale}`).join("\n"),
      "",
      "## Reusable Skills",
      profile.skills.map((skill) => `### ${skill.name}\nApplies to: ${skill.appliesTo}\n${skill.prompt}`).join("\n\n"),
      "",
      "## Factory Flow",
      "```mermaid",
      profile.mermaid,
      "```",
    ].join("\n"),
  };
}

function buildAgents(slice: GraphSlice): FactoryAgent[] {
  const highRisk = slice.issues.some((issue) => issue.severity === "critical");

  return [
    {
      id: "context-librarian",
      name: "Context Librarian",
      role: "Maintains shared context snapshots from scans, routes, issues, and Mermaid slices.",
      trigger: "After every successful scan",
      inputs: ["Graph slice", "Mermaid chart", "Issue signals"],
      outputs: ["Context snapshot", "Agent briefing", "Updated packet"],
    },
    {
      id: "planner",
      name: "Planner",
      role: "Breaks graph findings into scoped implementation tasks with explicit acceptance checks.",
      trigger: highRisk ? "Critical signals present" : "Feature cleanup requested",
      inputs: ["Context snapshot", "Route trace", "Guardrails"],
      outputs: ["Task plan", "Risk list", "Test checklist"],
    },
    {
      id: "executor",
      name: "Executor",
      role: "Carries out a single scoped cleanup using the selected files and issue evidence.",
      trigger: "Planner produces a bounded task",
      inputs: ["Task plan", "Selected files", "Reusable skill"],
      outputs: ["Patch proposal", "Changed file list", "Verification notes"],
    },
    {
      id: "reviewer",
      name: "Reviewer",
      role: "Checks whether the patch resolves the graph signal without widening scope.",
      trigger: "Executor completes a patch",
      inputs: ["Patch", "Original issue evidence", "Graph slice"],
      outputs: ["Review findings", "Residual risk", "Approval recommendation"],
    },
    {
      id: "release-sentinel",
      name: "Release Sentinel",
      role: "Decides whether scan signals, tests, and guardrails allow the work to ship.",
      trigger: "Before merge or deployment",
      inputs: ["Tests", "Scan summary", "Reviewer output"],
      outputs: ["Ship decision", "Required follow-up", "Rollback watchpoints"],
    },
  ];
}

function buildTriggers(slice: GraphSlice): FactoryTrigger[] {
  const triggers: FactoryTrigger[] = [
    {
      id: "scan-complete",
      name: "Refresh Context",
      event: "a scan completes",
      condition: "file, route, feature, or issue counts changed",
      action: "regenerate snapshots and factory packet",
    },
    {
      id: "critical-signal",
      name: "Require Review",
      event: "a critical signal appears",
      condition: "dependency cycles or missing route handlers are detected",
      action: "route the slice through Planner and Reviewer before cleanup",
    },
    {
      id: "duplicate-signal",
      name: "Consolidation Pass",
      event: "duplicate logic is detected",
      condition: "two or more files share a normalized function fingerprint",
      action: "generate a duplicate-consolidation skill packet",
    },
    {
      id: "async-signal",
      name: "Async Audit",
      event: "async React signals appear",
      condition: "effects start async work without cancellation evidence",
      action: "generate a race-condition review packet",
    },
  ];

  if (slice.summary.routeCount > 0) {
    triggers.push({
      id: "route-drift",
      name: "Route Drift Check",
      event: "route graph changes",
      condition: "route count or route issue signals changed",
      action: "rebuild route start-to-finish traces",
    });
  }

  return triggers;
}

function buildGuardrails(slice: GraphSlice): FactoryGuardrail[] {
  const guardrails: FactoryGuardrail[] = [
    {
      id: "local-only",
      name: "Local Context Only",
      severity: "critical",
      rationale: "Scanned source and generated context stay on the local machine unless the user explicitly exports a packet.",
      evidence: [slice.summary.projectName],
    },
    {
      id: "slice-first",
      name: "Slice Before Patch",
      severity: "warning",
      rationale: "Agents should work from a selected graph slice and issue evidence instead of operating over the whole repo at once.",
      evidence: [`${slice.nodes.length} nodes`, `${slice.edges.length} edges`],
    },
    {
      id: "human-approval",
      name: "Human Approval Gate",
      severity: "critical",
      rationale: "Factory agents can prepare patches and review packets, but shipping decisions remain explicit human approvals.",
      evidence: ["Planner", "Reviewer", "Release Sentinel"],
    },
  ];

  for (const issue of slice.issues.slice(0, 6)) {
    guardrails.push({
      id: `issue-${issue.id}`,
      name: issue.title,
      severity: issue.severity,
      rationale: issue.explanation,
      evidence: issue.filePaths.length > 0 ? issue.filePaths : issue.evidenceNodeIds,
    });
  }

  return guardrails;
}

function buildReusableSkills(slice: GraphSlice): ReusableSkill[] {
  const skills: ReusableSkill[] = [
    {
      id: "route-trace",
      name: "Route Trace Debugger",
      appliesTo: "Route slices",
      prompt: "Trace the selected route from entrypoint to downstream files. Identify divergence, missing handlers, and the smallest inspection path.",
    },
    {
      id: "dependency-untangle",
      name: "Dependency Untangler",
      appliesTo: "Dependency slices",
      prompt: "Review import edges for cycles, high fan-out, and misplaced boundaries. Recommend one scoped refactor that reduces coupling.",
    },
    {
      id: "context-brief",
      name: "Context Brief Writer",
      appliesTo: "Any graph slice",
      prompt: "Convert the graph slice into compact agent guidance: what exists, what changed, known gotchas, and what not to touch.",
    },
  ];

  if (slice.issues.some((issue) => issue.kind === "duplicate-logic")) {
    skills.push({
      id: "duplicate-consolidation",
      name: "Duplicate Consolidation",
      appliesTo: "Duplicate logic signals",
      prompt: "Compare duplicate fingerprints, explain the shared behavior, and propose a single extraction only if it reduces drift without widening scope.",
    });
  }

  if (slice.issues.some((issue) => issue.kind.includes("async") || issue.kind === "stale-closure-risk")) {
    skills.push({
      id: "async-safety-review",
      name: "Async Safety Review",
      appliesTo: "React async effect signals",
      prompt: "Inspect async effects for cancellation, stale closures, delayed work, and competing updates. Recommend explicit fixes with tests.",
    });
  }

  return skills;
}

function buildFactoryMermaid(): string {
  return [
    "flowchart LR",
    "  Codebase[Codebase Index] --> Context[Shared Context Layer]",
    "  Context --> Planner[Planner Agent]",
    "  Planner --> Executor[Executor Agent]",
    "  Executor --> Reviewer[Reviewer Agent]",
    "  Reviewer --> Sentinel[Release Sentinel]",
    "  Context --> Skills[Reusable Skills]",
    "  Context --> Triggers[Workflow Triggers]",
    "  Guardrails[Guardrails] --> Planner",
    "  Guardrails --> Executor",
    "  Guardrails --> Reviewer",
    "  Sentinel --> Snapshot[Traceable Snapshot]",
    "  Snapshot --> Context",
    "  classDef context fill:#eef2ff,stroke:#4f46e5,color:#312e81",
    "  classDef guard fill:#fef2f2,stroke:#dc2626,color:#7f1d1d",
    "  class Context,Snapshot context",
    "  class Guardrails guard",
  ].join("\n");
}

function contextCoverageScore(slice: GraphSlice): number {
  const hasRoutes = slice.summary.routeCount > 0 ? 25 : 0;
  const hasFeatures = slice.summary.featureCount > 0 ? 25 : 0;
  const hasEdges = slice.edges.length > 0 ? 25 : 0;
  const hasIssues = slice.issues.length > 0 ? 15 : 10;
  const hasMermaid = slice.mermaid.trim().length > 0 ? 10 : 0;
  return Math.min(100, hasRoutes + hasFeatures + hasEdges + hasIssues + hasMermaid);
}

function unique(values: string[]): string[] {
  return [...new Set(values)].filter(Boolean).slice(0, 24);
}
