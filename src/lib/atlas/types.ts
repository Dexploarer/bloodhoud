export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ProjectConfig = {
  id: string;
  name: string;
  rootPath: string;
  ignorePatterns: string[];
  createdAt: string;
  updatedAt: string;
};

export type ScanStatus = "queued" | "running" | "complete" | "failed";

export type ScanJob = {
  id: string;
  projectId: string;
  status: ScanStatus;
  progress: number;
  fileCount: number;
  indexedCount: number;
  issueCount: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

export type GraphNodeKind =
  | "project"
  | "workspace"
  | "feature"
  | "surface"
  | "route"
  | "file"
  | "component"
  | "hook"
  | "type"
  | "dependency"
  | "permission"
  | "runtime"
  | "issue";

export type GraphEdgeKind =
  | "contains"
  | "owns"
  | "implements"
  | "imports"
  | "calls"
  | "declares"
  | "uses"
  | "configures"
  | "flags"
  | "duplicates"
  | "cycles";

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  filePath: string | null;
  featureId: string | null;
  metadata: JsonObject;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  metadata: JsonObject;
};

export type IssueKind =
  | "duplicate-logic"
  | "dependency-cycle"
  | "route-dead-end"
  | "missing-route-handler"
  | "unresolved-import"
  | "port-mismatch"
  | "startup-problem"
  | "env-contract-risk"
  | "suspicious-async-effect"
  | "stale-closure-risk"
  | "unguarded-parallel-async"
  | "timer-without-cleanup"
  | "high-divergence"
  | "weak-typing"
  | "silent-fallback"
  | "swallowed-error"
  | "console-debugging"
  | "placeholder-code"
  | "boundary-leak"
  | "oversized-file";

export type IssueSeverity = "info" | "warning" | "critical";

export type IssueSignal = {
  id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  confidence: number;
  title: string;
  evidenceNodeIds: string[];
  filePaths: string[];
  explanation: string;
};

export type ImportRecord = {
  specifier: string;
  kind: "static" | "dynamic" | "export" | "commonjs";
  mode: "value" | "type";
};

export type PermissionRecord = {
  kind: "filesystem" | "process" | "network" | "storage" | "database" | "shell";
  source: string;
  line: number;
};

export type PortRecord = {
  port: number;
  kind: "listen" | "config" | "env" | "url";
  source: string;
  line: number;
};

export type RuntimePortRecord = {
  filePath: string;
  port: number;
  kind: "script" | "docker" | "env" | "config" | "listen" | "url";
  source: string;
  line: number;
  workspaceKey: string;
};

export type RuntimeScriptRecord = {
  filePath: string;
  packageName: string;
  scriptName: string;
  command: string;
  ports: number[];
  workspaceKey: string;
};

export type RuntimeDiagnostic = {
  kind: "port-mismatch" | "startup-problem" | "env-contract-risk";
  severity: IssueSeverity;
  confidence: number;
  title: string;
  filePaths: string[];
  explanation: string;
};

export type RuntimeProfile = {
  scripts: RuntimeScriptRecord[];
  ports: RuntimePortRecord[];
  diagnostics: RuntimeDiagnostic[];
};

export type RouteRecord = {
  id: string;
  path: string;
  kind: "page" | "layout" | "api-route" | "middleware" | "react-router";
  filePath: string;
};

export type AsyncSignal = {
  kind: "async-effect" | "stale-closure-risk" | "unguarded-parallel-async" | "timer-without-cleanup";
  line: number;
  detail: string;
};

export type FingerprintRecord = {
  id: string;
  filePath: string;
  name: string;
  hash: string;
  size: number;
};

export type SlopSignal = {
  kind:
    | "weak-typing"
    | "silent-fallback"
    | "swallowed-error"
    | "console-debugging"
    | "placeholder-code";
  line: number;
  detail: string;
  repair: string;
};

export type AnalyzedFile = {
  path: string;
  absolutePath: string;
  hash: string;
  language: "ts" | "tsx" | "js" | "jsx";
  size: number;
  surface: string;
  featureId: string;
  imports: ImportRecord[];
  exports: string[];
  components: string[];
  hooks: string[];
  typeDeclarations: string[];
  routes: RouteRecord[];
  apiCalls: string[];
  permissions: PermissionRecord[];
  ports: PortRecord[];
  asyncSignals: AsyncSignal[];
  slopSignals: SlopSignal[];
  fingerprints: FingerprintRecord[];
};

export type GraphSummary = {
  projectName: string;
  fileCount: number;
  workspaceCount: number;
  featureCount: number;
  routeCount: number;
  internalImportCount: number;
  externalDependencyCount: number;
  unresolvedImportCount: number;
  componentCount: number;
  hookCount: number;
  typeCount: number;
  permissionCount: number;
  runtimePortCount: number;
  startupIssueCount: number;
  timingIssueCount: number;
  brokenEdgeCount: number;
  warningEdgeCount: number;
  edgeCount: number;
  issueCount: number;
  scanId: string;
  scannedAt: string;
};

export type ScanResult = {
  files: AnalyzedFile[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  issues: IssueSignal[];
  summary: GraphSummary;
};

export type GraphSliceKind =
  | "overview"
  | "workspace"
  | "feature"
  | "route"
  | "dependencies"
  | "contracts"
  | "runtime"
  | "duplicates"
  | "slop"
  | "issues";

export type GraphSlice = {
  kind: GraphSliceKind;
  target: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  issues: IssueSignal[];
  summary: GraphSummary;
  mermaid: string;
};

export type ScanProgress = {
  phase: "discovering" | "analyzing" | "graphing" | "persisting" | "complete";
  progress: number;
  fileCount: number;
  indexedCount: number;
  message: string;
};

export type IgnorePreview = {
  rootPath: string;
  ignoredCount: number;
  indexedCount: number;
  ignoredSamples: string[];
  indexedSamples: string[];
};

export type ExportPacket = {
  markdown: string;
};

export type CodexPlanType =
  | "free"
  | "go"
  | "plus"
  | "pro"
  | "prolite"
  | "team"
  | "self_serve_business_usage_based"
  | "business"
  | "enterprise_cbp_usage_based"
  | "enterprise"
  | "edu"
  | "unknown";

export type CodexAccount =
  | { type: "chatgpt"; email: string; planType: CodexPlanType }
  | { type: "apiKey" }
  | { type: "amazonBedrock" };

export type CodexSession = {
  connected: boolean;
  requiresOpenaiAuth: boolean;
  account: CodexAccount | null;
};

export type CodexLogin =
  | { type: "chatgpt"; loginId: string; authUrl: string }
  | { type: "chatgptDeviceCode"; loginId: string; verificationUrl: string; userCode: string }
  | { type: "apiKey" }
  | { type: "chatgptAuthTokens" };

export type CodexLoginResponse = {
  session: CodexSession;
  login: CodexLogin | null;
};

export type FactoryMetric = {
  label: string;
  value: string;
  detail: string;
};

export type ContextSnapshot = {
  id: string;
  title: string;
  description: string;
  sources: string[];
};

export type FactoryAgent = {
  id: string;
  name: string;
  role: string;
  trigger: string;
  inputs: string[];
  outputs: string[];
};

export type FactoryTrigger = {
  id: string;
  name: string;
  event: string;
  condition: string;
  action: string;
};

export type FactoryGuardrail = {
  id: string;
  name: string;
  severity: IssueSeverity;
  rationale: string;
  evidence: string[];
};

export type ReusableSkill = {
  id: string;
  name: string;
  appliesTo: string;
  prompt: string;
};

export type SoftwareFactoryProfile = {
  projectName: string;
  generatedAt: string;
  metrics: FactoryMetric[];
  snapshots: ContextSnapshot[];
  agents: FactoryAgent[];
  triggers: FactoryTrigger[];
  guardrails: FactoryGuardrail[];
  skills: ReusableSkill[];
  mermaid: string;
};

export type FactoryPacket = {
  profile: SoftwareFactoryProfile;
  markdown: string;
};

export type DebugLane = {
  id: string;
  label: string;
  description: string;
  repair: string;
  severity: IssueSeverity;
  issueIds: string[];
  count: number;
};

export type DebugStep = {
  id: string;
  title: string;
  why: string;
  issueIds: string[];
  files: string[];
  nextAction: string;
};

export type ArchitectureRecommendation = {
  id: string;
  title: string;
  confidence: number;
  rationale: string;
  from: string;
  to: string;
};

export type DebugGuide = {
  score: number;
  headline: string;
  lanes: DebugLane[];
  steps: DebugStep[];
  recommendations: ArchitectureRecommendation[];
  mermaid: string;
};

export type AiScanMode = "setup-required" | "ai-reviewed";

export type AiFalsePositiveReview = {
  issueId: string;
  title: string;
  verdict: "likely-real" | "needs-human-review" | "likely-false-positive";
  confidence: number;
  reasoning: string;
  nextEvidence: string;
};

export type AiArchitectureMove = {
  title: string;
  why: string;
  firstStep: string;
  files: string[];
};

export type AiGeneratedSkill = {
  id: string;
  name: string;
  appliesTo: string;
  prompt: string;
  acceptanceChecks: string[];
};

export type AiGeneratedGuideline = {
  title: string;
  rule: string;
  rationale: string;
};

export type AiGeneratedDoc = {
  title: string;
  markdown: string;
};

export type AiVisualization = {
  title: string;
  use: string;
  mermaid: string;
};

export type AiAuthChecklist = {
  title: string;
  items: string[];
};

export type AiScanResult = {
  mode: AiScanMode;
  model: string;
  summary: string;
  confidenceScore: number;
  falsePositiveReviews: AiFalsePositiveReview[];
  architectureMoves: AiArchitectureMove[];
  generatedSkills: AiGeneratedSkill[];
  guidelines: AiGeneratedGuideline[];
  docs: AiGeneratedDoc[];
  visualizations: AiVisualization[];
  auth: AiAuthChecklist[];
  generatedAt: string;
};
