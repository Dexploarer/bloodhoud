import { buildDebugGuide } from "@/lib/atlas/debug-guide";
import { isJsonObject, stringFromJson } from "@/lib/atlas/json";
import type {
  AiArchitectureMove,
  AiAuthChecklist,
  AiFalsePositiveReview,
  AiGeneratedDoc,
  AiGeneratedGuideline,
  AiGeneratedSkill,
  AiScanResult,
  AiVisualization,
  GraphSlice,
  IssueSignal,
  JsonObject,
  JsonValue,
} from "@/lib/atlas/types";

const defaultModel = "gpt-5.5";

export async function buildAiScan(slice: GraphSlice): Promise<AiScanResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL && process.env.OPENAI_MODEL.trim().length > 0 ? process.env.OPENAI_MODEL : defaultModel;

  if (!apiKey || apiKey.trim().length === 0) {
    return buildLocalAiScan(slice, model, "OPENAI_API_KEY is not configured for this local server.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "You are Bloodhoud, a senior codebase visual debugging reviewer. Review only the supplied graph evidence. Do not claim certainty without evidence. Separate likely false positives from real repair work. Generate reusable skills, guidelines, docs, and Mermaid visualizations that help a visual learner debug and deslopify the codebase.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildAiPrompt(slice),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "bloodhoud_ai_scan",
          strict: true,
          schema: aiScanSchema(),
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI scan failed with ${response.status}: ${body.slice(0, 480)}`);
  }

  const payload = await response.json() as JsonValue;
  const outputText = outputTextFromResponse(payload);
  const parsed = JSON.parse(outputText) as JsonValue;
  return aiScanResultFromJson(parsed, model);
}

export function buildLocalAiScan(slice: GraphSlice, model = defaultModel, setupReason = "OpenAI API access is not configured."): AiScanResult {
  const guide = buildDebugGuide(slice);
  const queue = [...slice.issues].sort((left, right) => issueWeight(right) - issueWeight(left));
  const topIssues = queue.slice(0, 8);
  const falsePositiveReviews = topIssues.map((issue) => localReviewForIssue(issue));
  const architectureMoves = buildLocalMoves(slice);
  const generatedSkills = buildLocalSkills(slice);
  const guidelines = buildLocalGuidelines(slice);
  const docs = buildLocalDocs(slice, setupReason);
  const visualizations = buildLocalVisualizations(slice);

  return {
    mode: "setup-required",
    model,
    summary: `${setupReason} Bloodhoud still generated an evidence packet, setup checklist, skills, docs, and visual debugging views from the indexed graph. Architecture score is ${guide.score}/100 with ${slice.issues.length} grouped signals.`,
    confidenceScore: Math.max(35, Math.min(82, guide.score)),
    falsePositiveReviews,
    architectureMoves,
    generatedSkills,
    guidelines,
    docs,
    visualizations,
    auth: buildAuthChecklist(),
    generatedAt: new Date().toISOString(),
  };
}

function buildAiPrompt(slice: GraphSlice): string {
  const guide = buildDebugGuide(slice);
  const issues = slice.issues.slice(0, 28).map((issue) => ({
    id: issue.id,
    kind: issue.kind,
    severity: issue.severity,
    confidence: issue.confidence,
    title: issue.title,
    filePaths: issue.filePaths.slice(0, 6),
    explanation: issue.explanation,
  }));
  const nodes = slice.nodes.slice(0, 80).map((node) => ({
    id: node.id,
    kind: node.kind,
    label: node.label,
    filePath: node.filePath,
    featureId: node.featureId,
  }));
  const edges = slice.edges.slice(0, 120).map((edge) => ({
    source: edge.source,
    target: edge.target,
    kind: edge.kind,
  }));

  return JSON.stringify({
    project: slice.summary.projectName,
    slice: { kind: slice.kind, target: slice.target },
    score: guide.score,
    lanes: guide.lanes,
    recommendations: guide.recommendations,
    issues,
    nodes,
    edges,
    mermaid: slice.mermaid,
    requiredOutcome: "Validate static warning quality, identify likely false positives, generate visual debugging docs, generate reusable Codex/agent skills, and recommend the smallest safe architecture moves.",
  });
}

function aiScanSchema(): JsonObject {
  const stringArray = { type: "array", items: { type: "string" } };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "mode",
      "model",
      "summary",
      "confidenceScore",
      "falsePositiveReviews",
      "architectureMoves",
      "generatedSkills",
      "guidelines",
      "docs",
      "visualizations",
      "auth",
      "generatedAt",
    ],
    properties: {
      mode: { type: "string", enum: ["ai-reviewed"] },
      model: { type: "string" },
      summary: { type: "string" },
      confidenceScore: { type: "number" },
      falsePositiveReviews: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["issueId", "title", "verdict", "confidence", "reasoning", "nextEvidence"],
          properties: {
            issueId: { type: "string" },
            title: { type: "string" },
            verdict: { type: "string", enum: ["likely-real", "needs-human-review", "likely-false-positive"] },
            confidence: { type: "number" },
            reasoning: { type: "string" },
            nextEvidence: { type: "string" },
          },
        },
      },
      architectureMoves: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "why", "firstStep", "files"],
          properties: {
            title: { type: "string" },
            why: { type: "string" },
            firstStep: { type: "string" },
            files: stringArray,
          },
        },
      },
      generatedSkills: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "name", "appliesTo", "prompt", "acceptanceChecks"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            appliesTo: { type: "string" },
            prompt: { type: "string" },
            acceptanceChecks: stringArray,
          },
        },
      },
      guidelines: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "rule", "rationale"],
          properties: {
            title: { type: "string" },
            rule: { type: "string" },
            rationale: { type: "string" },
          },
        },
      },
      docs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "markdown"],
          properties: {
            title: { type: "string" },
            markdown: { type: "string" },
          },
        },
      },
      visualizations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "use", "mermaid"],
          properties: {
            title: { type: "string" },
            use: { type: "string" },
            mermaid: { type: "string" },
          },
        },
      },
      auth: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "items"],
          properties: {
            title: { type: "string" },
            items: stringArray,
          },
        },
      },
      generatedAt: { type: "string" },
    },
  };
}

function outputTextFromResponse(value: JsonValue): string {
  if (!isJsonObject(value)) {
    throw new Error("OpenAI response was not a JSON object.");
  }

  const direct = stringFromJson(value.output_text);
  if (direct) {
    return direct;
  }

  const output = value.output;
  if (!Array.isArray(output)) {
    throw new Error("OpenAI response did not include output text.");
  }

  for (const item of output) {
    if (!isJsonObject(item)) {
      continue;
    }
    const content = item.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const contentItem of content) {
      if (!isJsonObject(contentItem)) {
        continue;
      }
      const text = stringFromJson(contentItem.text);
      if (text) {
        return text;
      }
    }
  }

  throw new Error("OpenAI response output text was empty.");
}

function aiScanResultFromJson(value: JsonValue, model: string): AiScanResult {
  if (!isJsonObject(value)) {
    throw new Error("AI scan result was not a JSON object.");
  }

  return {
    mode: "ai-reviewed",
    model: readString(value, "model", model),
    summary: readString(value, "summary", "AI review completed."),
    confidenceScore: readNumber(value, "confidenceScore", 70),
    falsePositiveReviews: readArray(value.falsePositiveReviews).map(falsePositiveReviewFromJson),
    architectureMoves: readArray(value.architectureMoves).map(architectureMoveFromJson),
    generatedSkills: readArray(value.generatedSkills).map(generatedSkillFromJson),
    guidelines: readArray(value.guidelines).map(generatedGuidelineFromJson),
    docs: readArray(value.docs).map(generatedDocFromJson),
    visualizations: readArray(value.visualizations).map(visualizationFromJson),
    auth: readArray(value.auth).map(authChecklistFromJson),
    generatedAt: readString(value, "generatedAt", new Date().toISOString()),
  };
}

function falsePositiveReviewFromJson(value: JsonValue): AiFalsePositiveReview {
  const object = objectFromJson(value);
  const verdictValue = readString(object, "verdict", "needs-human-review");
  const verdict = verdictValue === "likely-real" || verdictValue === "likely-false-positive" ? verdictValue : "needs-human-review";
  return {
    issueId: readString(object, "issueId", "unmapped"),
    title: readString(object, "title", "Unmapped issue"),
    verdict,
    confidence: readNumber(object, "confidence", 0.5),
    reasoning: readString(object, "reasoning", "No model reasoning returned."),
    nextEvidence: readString(object, "nextEvidence", "Open the issue evidence trail."),
  };
}

function architectureMoveFromJson(value: JsonValue): AiArchitectureMove {
  const object = objectFromJson(value);
  return {
    title: readString(object, "title", "Architecture move"),
    why: readString(object, "why", "No rationale returned."),
    firstStep: readString(object, "firstStep", "Inspect the highest evidence file first."),
    files: readStringArray(object.files),
  };
}

function generatedSkillFromJson(value: JsonValue): AiGeneratedSkill {
  const object = objectFromJson(value);
  return {
    id: readString(object, "id", "generated-skill"),
    name: readString(object, "name", "Generated Skill"),
    appliesTo: readString(object, "appliesTo", "Current graph slice"),
    prompt: readString(object, "prompt", "Review the selected graph slice and propose a scoped cleanup."),
    acceptanceChecks: readStringArray(object.acceptanceChecks),
  };
}

function generatedGuidelineFromJson(value: JsonValue): AiGeneratedGuideline {
  const object = objectFromJson(value);
  return {
    title: readString(object, "title", "Guideline"),
    rule: readString(object, "rule", "Keep cleanup scoped to the selected evidence."),
    rationale: readString(object, "rationale", "Scoped changes are easier to verify after rescanning."),
  };
}

function generatedDocFromJson(value: JsonValue): AiGeneratedDoc {
  const object = objectFromJson(value);
  return {
    title: readString(object, "title", "AI Review Notes"),
    markdown: readString(object, "markdown", "No document text returned."),
  };
}

function visualizationFromJson(value: JsonValue): AiVisualization {
  const object = objectFromJson(value);
  return {
    title: readString(object, "title", "Debug Visualization"),
    use: readString(object, "use", "Use this chart to review the selected slice."),
    mermaid: readString(object, "mermaid", "flowchart TD\n  Start[Scan] --> Review[Review evidence]"),
  };
}

function authChecklistFromJson(value: JsonValue): AiAuthChecklist {
  const object = objectFromJson(value);
  return {
    title: readString(object, "title", "AI Setup"),
    items: readStringArray(object.items),
  };
}

function objectFromJson(value: JsonValue): JsonObject {
  if (isJsonObject(value)) {
    return value;
  }

  return {};
}

function readArray(value: JsonValue): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function readString(object: JsonObject, key: string, fallback: string): string {
  const value = object[key];
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function readNumber(object: JsonObject, key: string, fallback: number): number {
  const value = object[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readStringArray(value: JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function localReviewForIssue(issue: IssueSignal): AiFalsePositiveReview {
  const isInfoOnly = issue.severity === "info";
  const hasFileEvidence = issue.filePaths.length > 0;
  const verdict = isInfoOnly ? "needs-human-review" : hasFileEvidence ? "likely-real" : "needs-human-review";
  return {
    issueId: issue.id,
    title: issue.title,
    verdict,
    confidence: isInfoOnly ? 0.56 : Math.max(0.62, issue.confidence),
    reasoning: isInfoOnly
      ? "The static signal is useful for navigation, but it needs source-level confirmation before becoming cleanup work."
      : "The issue has grouped file evidence and a warning severity, so it should stay in the repair queue until reviewed.",
    nextEvidence: hasFileEvidence ? `Open ${issue.filePaths[0]} and inspect the exact evidence line.` : "Open the graph neighborhood and confirm this edge exists in code.",
  };
}

function buildLocalMoves(slice: GraphSlice): AiArchitectureMove[] {
  const issueFiles = [...new Set(slice.issues.flatMap((issue) => issue.filePaths))].slice(0, 6);
  return [
    {
      title: "Turn the largest warning cluster into a route-to-file trace",
      why: "Visual learners need one concrete journey before broad cleanup. A route trace makes the behavior path visible.",
      firstStep: "Open the route slice, choose the route tied to the highest warning file, and inspect the first divergent edge.",
      files: issueFiles,
    },
    {
      title: "Separate evidence from speculation",
      why: "False positives drop when each warning keeps a line, file, confidence, and next-evidence action.",
      firstStep: "Mark info-level findings as review prompts and keep warning-level findings in the cleanup queue.",
      files: issueFiles.slice(0, 3),
    },
  ];
}

function buildLocalSkills(slice: GraphSlice): AiGeneratedSkill[] {
  const issueKinds = [...new Set(slice.issues.map((issue) => issue.kind))];
  return [
    {
      id: "atlas-false-positive-review",
      name: "False Positive Triage",
      appliesTo: "Issue evidence view",
      prompt: "Review each static signal against its file path, graph edge, confidence, and explanation. Mark it likely-real, needs-human-review, or likely-false-positive. Do not propose edits until the evidence survives review.",
      acceptanceChecks: ["Every reviewed issue has a verdict", "Every likely-real issue has file-level evidence", "Info-level signals remain prompts unless confirmed"],
    },
    {
      id: "atlas-route-story-debugger",
      name: "Route Story Debugger",
      appliesTo: "Route slices",
      prompt: "Read the selected route as a story from entrypoint to page, handler, dependency, and issue evidence. Identify the first confusing edge and the smallest testable cleanup.",
      acceptanceChecks: ["One route path is named", "The first divergence point is identified", "The recommended change stays inside the route slice"],
    },
    {
      id: "atlas-slop-pattern-compressor",
      name: "Slop Pattern Compressor",
      appliesTo: issueKinds.length > 0 ? issueKinds.join(", ") : "Grouped issue signals",
      prompt: "Group repeated warnings by file and behavior. Prefer one architecture move per repeated pattern over many small cosmetic edits.",
      acceptanceChecks: ["Duplicate findings are grouped", "The repair path names the owner layer", "A rescan metric is chosen before editing"],
    },
  ];
}

function buildLocalGuidelines(slice: GraphSlice): AiGeneratedGuideline[] {
  return [
    {
      title: "Signals are evidence, not verdicts",
      rule: "Treat static warnings as prompts for inspection until file-level evidence confirms the risk.",
      rationale: `${slice.issues.length} grouped signals are easier to review when the UI separates confidence from severity.`,
    },
    {
      title: "Debug through stories",
      rule: "Start cleanup from one route, feature, or dependency story instead of scanning the whole graph at once.",
      rationale: "Story-shaped debugging reduces context overload and makes architecture drift visible.",
    },
    {
      title: "Rescan after every cleanup lane",
      rule: "A cleanup is complete only when the graph slice, score, and active lane counts improve or explain why they did not.",
      rationale: "The product should teach architecture improvement as an observable feedback loop.",
    },
  ];
}

function buildLocalDocs(slice: GraphSlice, setupReason: string): AiGeneratedDoc[] {
  return [
    {
      title: "AI Setup",
      markdown: [
        "# AI Setup",
        "",
        setupReason,
        "",
        "## Local API review",
        "- Set `OPENAI_API_KEY` in the server environment.",
        "- Optionally set `OPENAI_MODEL`; otherwise Bloodhoud uses `gpt-5.5`.",
        "- Restart `npm run dev` after changing environment variables.",
        "",
        "## ChatGPT app path",
        "- Convert Bloodhoud into an Apps SDK app with an MCP server.",
        "- Expose graph, scan, issue, and export tools through MCP.",
        "- Add OAuth 2.1/PKCE if the app needs user-specific data or write actions.",
      ].join("\n"),
    },
    {
      title: "Visual Debugging Playbook",
      markdown: [
        "# Visual Debugging Playbook",
        "",
        `Project: ${slice.summary.projectName}`,
        `Visible nodes: ${slice.nodes.length}`,
        `Visible edges: ${slice.edges.length}`,
        `Grouped signals: ${slice.issues.length}`,
        "",
        "1. Open Warnings and triage likely-real signals first.",
        "2. Select the related node on the canvas and inspect incoming/outgoing edges.",
        "3. Switch to Story and follow the route or feature path.",
        "4. Export a packet only after the evidence path is clear.",
        "5. Rescan and compare score, signal count, and active lanes.",
      ].join("\n"),
    },
  ];
}

function buildLocalVisualizations(slice: GraphSlice): AiVisualization[] {
  const guide = buildDebugGuide(slice);
  const lanes = guide.lanes.filter((lane) => lane.count > 0).slice(0, 5);
  const lines = ["flowchart TD", "  Scan[Static scan] --> Filter[False-positive triage]", "  Filter --> Story[Route or feature story]", "  Story --> Repair[Smallest safe repair]", "  Repair --> Rescan[Rescan and compare]"];
  for (const lane of lanes) {
    lines.push(`  Filter --> ${safeMermaidId(lane.id)}["${lane.label}: ${lane.count}"]`);
  }
  return [
    {
      title: "AI Review Loop",
      use: "Shows how static evidence becomes AI-reviewed cleanup work.",
      mermaid: lines.join("\n"),
    },
  ];
}

function buildAuthChecklist(): AiAuthChecklist[] {
  return [
    {
      title: "Local OpenAI API",
      items: [
        "Keep API calls server-side; never expose the API key to the browser.",
        "Set OPENAI_API_KEY before running AI scans.",
        "Use structured JSON output so the UI can render evidence, docs, and skills predictably.",
      ],
    },
    {
      title: "ChatGPT Apps SDK",
      items: [
        "Build an MCP server for Bloodhoud scan, graph, issue, Mermaid, and export tools.",
        "Use OAuth 2.1 with PKCE and dynamic client registration for authenticated ChatGPT app data.",
        "Keep anonymous read-only mode available for local demo scans where possible.",
      ],
    },
    {
      title: "Codex workflow",
      items: [
        "Generate skills and guidelines as Markdown packets for Codex to use during cleanup.",
        "Keep source local unless the user explicitly exports a packet.",
        "Use rescan metrics as the acceptance check after AI-assisted edits.",
      ],
    },
  ];
}

function issueWeight(issue: IssueSignal): number {
  const severity = issue.severity === "critical" ? 100 : issue.severity === "warning" ? 60 : 20;
  return severity + issue.confidence * 20 + issue.filePaths.length;
}

function safeMermaidId(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}
