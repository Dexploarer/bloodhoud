"use client";

import {
  Activity,
  AlertTriangle,
  Bot,
  Braces,
  BookOpen,
  Boxes,
  Copy,
  Factory,
  FileCode2,
  Gauge,
  GitBranch,
  Home,
  Layers3,
  ListFilter,
  Loader2,
  LogIn,
  MapIcon,
  Play,
  RefreshCcw,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
  Wrench,
  Workflow,
} from "lucide-react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  ExportPacket,
  AiScanResult,
  CodexLogin,
  CodexLoginResponse,
  CodexSession,
  DebugGuide,
  FactoryPacket,
  GraphEdge,
  GraphNode,
  GraphNodeKind,
  GraphSlice,
  GraphSliceKind,
  IgnorePreview,
  IssueKind,
  IssueSeverity,
  IssueSignal,
  ProjectConfig,
  ScanJob,
  ScanProgress,
  SoftwareFactoryProfile,
} from "@/lib/atlas/types";
import { MermaidPreview } from "@/components/mermaid-preview";
import { buildDebugGuide } from "@/lib/atlas/debug-guide";

type ProjectResponse = {
  projects: ProjectConfig[];
};

type GraphResponse = {
  slice: GraphSlice;
};

type PreviewResponse = {
  preview: IgnorePreview;
};

type ExportResponse = {
  packet: ExportPacket;
};

type FactoryResponse = {
  packet: FactoryPacket;
};

type AiScanResponse = {
  result: AiScanResult;
};

type CodexSessionResponse = {
  session: CodexSession;
};

type ScanCompletePayload = {
  job: ScanJob;
  summary: GraphSlice["summary"];
};

type ScanEvent =
  | { event: "job"; data: ScanJob }
  | { event: "progress"; data: ScanProgress }
  | { event: "complete"; data: ScanCompletePayload }
  | { event: "error"; data: { error: string; job: ScanJob } };

type SidePanelMode = "warnings" | "inspect" | "story" | "ai";

const viewOptions: { kind: GraphSliceKind; label: string; icon: typeof Layers3 }[] = [
  { kind: "overview", label: "Overview", icon: Layers3 },
  { kind: "workspace", label: "Workspaces", icon: Boxes },
  { kind: "feature", label: "Features", icon: GitBranch },
  { kind: "route", label: "Routes", icon: Route },
  { kind: "dependencies", label: "Dependencies", icon: FileCode2 },
  { kind: "contracts", label: "Contracts", icon: ShieldCheck },
  { kind: "runtime", label: "Runtime", icon: Gauge },
  { kind: "duplicates", label: "Duplicates", icon: Copy },
  { kind: "slop", label: "Slop Map", icon: MapIcon },
  { kind: "issues", label: "Issues", icon: AlertTriangle },
];

const nodePalette: Record<GraphNode["kind"], { background: string; border: string; color: string }> = {
  project: { background: "var(--panel)", border: "var(--primary)", color: "var(--foreground)" },
  workspace: { background: "var(--workspace)", border: "var(--workspace-border)", color: "var(--workspace-foreground)" },
  feature: { background: "var(--feature)", border: "var(--feature-border)", color: "var(--feature-foreground)" },
  surface: { background: "var(--surface)", border: "var(--surface-border)", color: "var(--surface-foreground)" },
  route: { background: "var(--route)", border: "var(--route-border)", color: "var(--route-foreground)" },
  file: { background: "var(--file)", border: "var(--file-border)", color: "var(--file-foreground)" },
  component: { background: "var(--component)", border: "var(--component-border)", color: "var(--component-foreground)" },
  hook: { background: "var(--component)", border: "var(--component-border)", color: "var(--component-foreground)" },
  type: { background: "var(--type)", border: "var(--type-border)", color: "var(--type-foreground)" },
  dependency: { background: "var(--dependency)", border: "var(--dependency-border)", color: "var(--dependency-foreground)" },
  permission: { background: "var(--permission)", border: "var(--permission-border)", color: "var(--permission-foreground)" },
  runtime: { background: "var(--runtime)", border: "var(--runtime-border)", color: "var(--runtime-foreground)" },
  issue: { background: "var(--issue)", border: "var(--issue-border)", color: "var(--issue-foreground)" },
};

type ParserHealth = {
  coverageLabel: string;
  metrics: Array<{
    label: string;
    value: string;
    detail: string;
    width: number;
    tone: string;
  }>;
};

type SelectOption = { value: string; label: string };

export function AtlasDashboard({
  initialProjects,
  initialSlice,
}: {
  initialProjects: ProjectConfig[];
  initialSlice: GraphSlice | null;
}) {
  const initialProject = initialProjects[0] ?? null;
  const [projects, setProjects] = useState<ProjectConfig[]>(initialProjects);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialProject?.id ?? null);
  const [projectName, setProjectName] = useState(initialProject?.name ?? "Bloodhoud Demo");
  const [rootPath, setRootPath] = useState(initialProject?.rootPath ?? "");
  const [ignoreText, setIgnoreText] = useState(initialProject?.ignorePatterns.join("\n") ?? "node_modules\n.next\ndist\ncoverage");
  const [preview, setPreview] = useState<IgnorePreview | null>(null);
  const [slice, setSlice] = useState<GraphSlice | null>(initialSlice);
  const [catalog, setCatalog] = useState<GraphNode[]>(initialSlice?.nodes ?? []);
  const [viewKind, setViewKind] = useState<GraphSliceKind>("overview");
  const [target, setTarget] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [packet, setPacket] = useState("");
  const [factoryProfile, setFactoryProfile] = useState<SoftwareFactoryProfile | null>(null);
  const [factoryPacket, setFactoryPacket] = useState("");
  const [aiResult, setAiResult] = useState<AiScanResult | null>(null);
  const [codexSession, setCodexSession] = useState<CodexSession | null>(null);
  const [codexLogin, setCodexLogin] = useState<CodexLogin | null>(null);
  const [codexSigningIn, setCodexSigningIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [aiScanning, setAiScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [sidePanelMode, setSidePanelMode] = useState<SidePanelMode>("warnings");
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const codexConnected = codexSession?.connected === true;
  const debugGuide = useMemo(() => (slice ? buildDebugGuide(slice) : null), [slice]);
  const parserHealth = useMemo(() => buildParserHealth(slice ? slice.summary : null), [slice]);
  const loadGraph = useCallback(
    async (projectId: string, kind: GraphSliceKind, nextTarget: string | null) => {
      setError(null);
      const params = new URLSearchParams({ kind });
      if (nextTarget) {
        params.set("target", nextTarget);
      }

      const response = await fetch(`/api/projects/${projectId}/graph?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Could not load graph slice.");
      }

      const data = (await response.json()) as GraphResponse;
      setSlice(data.slice);
      setSelectedNodeId(null);
      if (kind === "overview") {
        setCatalog(data.slice.nodes);
      }
    },
    [],
  );

  const selectProject = useCallback(
    (project: ProjectConfig) => {
      setSelectedProjectId(project.id);
      setProjectName(project.name);
      setRootPath(project.rootPath);
      setIgnoreText(project.ignorePatterns.join("\n"));
      setPreview(null);
      setPacket("");
      setFactoryPacket("");
      setFactoryProfile(null);
      setAiResult(null);
      setTarget(null);
      setViewKind("overview");
      setSidePanelMode("warnings");
      loadGraph(project.id, "overview", null).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Could not load graph.");
      });
    },
    [loadGraph],
  );

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) {
        throw new Error("Could not load projects.");
      }

      const data = (await response.json()) as ProjectResponse;
      setProjects(data.projects);
      if (data.projects.length > 0) {
        selectProject(data.projects[0]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load projects.");
    } finally {
      setLoading(false);
    }
  }, [selectProject]);

  const refreshCodexSession = useCallback(async (): Promise<CodexSession | null> => {
    const response = await fetch("/api/codex/session");
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as CodexSessionResponse;
    setCodexSession(data.session);
    if (data.session.connected) {
      setCodexLogin(null);
    }

    return data.session;
  }, []);

  useEffect(() => {
    let mounted = true;

    fetch("/api/codex/session")
      .then((response) => response.ok ? response.json() as Promise<CodexSessionResponse> : null)
      .then((data) => {
        if (!mounted || !data) {
          return;
        }

        setCodexSession(data.session);
        if (data.session.connected) {
          setCodexLogin(null);
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  const flowNodes = useMemo<FlowNode[]>(() => {
    if (!slice) {
      return [];
    }

    const grouped = new Map<GraphNode["kind"], number>();
    return slice.nodes.map((node) => {
      const index = grouped.get(node.kind) ?? 0;
      grouped.set(node.kind, index + 1);
      const lane = laneForKind(node.kind);
      const palette = nodePalette[node.kind];
      const column = Math.floor(index / 8);
      const row = index % 8;

      return {
        id: node.id,
        position: { x: lane * 280 + column * 250, y: row * 108 },
        data: {
          label: (
            <div className="space-y-1">
              <div className="text-[11px] uppercase text-muted-foreground">{node.kind}</div>
              <div className="max-w-48 truncate text-sm font-semibold">{node.label}</div>
              {node.filePath ? <div className="max-w-48 truncate text-xs text-muted-foreground">{node.filePath}</div> : null}
            </div>
          ),
        },
        style: {
          width: 224,
          minHeight: 76,
          background: palette.background,
          borderColor: palette.border,
          color: palette.color,
          borderRadius: 8,
          borderWidth: 1,
          fontFamily: "var(--font-geist-sans)",
        },
      };
    });
  }, [slice]);

  const flowEdges = useMemo<FlowEdge[]>(() => {
    if (!slice) {
      return [];
    }

    return slice.edges.map((edge) => {
      const color = edgeColor(edge);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        animated: edgeHealth(edge) !== "good" || edge.kind === "calls" || edge.kind === "cycles",
        label: edgeLabel(edge),
        style: { stroke: color, strokeWidth: edgeHealth(edge) === "broken" ? 2.4 : 1.5 },
        labelStyle: { fill: "var(--muted-foreground)", fontSize: 11 },
        markerEnd: { type: MarkerType.ArrowClosed, color },
      };
    });
  }, [slice]);
  const selectedGraphNode = useMemo(() => {
    if (!slice || !selectedNodeId) {
      return null;
    }

    return slice.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [selectedNodeId, slice]);
  const selectedNodeIssues = useMemo(() => {
    if (!slice || !selectedNodeId) {
      return [];
    }

    return slice.issues.filter((issue) => {
      return issue.evidenceNodeIds.includes(selectedNodeId) || (selectedGraphNode?.filePath ? issue.filePaths.includes(selectedGraphNode.filePath) : false);
    });
  }, [selectedGraphNode?.filePath, selectedNodeId, slice]);

  const targetOptions = useMemo(() => targetOptionsFor(viewKind, catalog, slice?.issues ?? []), [catalog, slice?.issues, viewKind]);

  async function saveProject() {
    setLoading(true);
    setError(null);
    try {
      const payload = { name: projectName, rootPath, ignorePatterns: ignoreLines() };
      const response = await fetch(selectedProjectId ? `/api/projects/${selectedProjectId}` : "/api/projects", {
        method: selectedProjectId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Could not save project.");
      }

      const data = (await response.json()) as { project: ProjectConfig };
      setProjects((current) => [data.project, ...current.filter((project) => project.id !== data.project.id)]);
      selectProject(data.project);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save project.");
    } finally {
      setLoading(false);
    }
  }

  async function previewIgnore() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/projects/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath, ignorePatterns: ignoreLines() }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Could not preview ignore rules.");
      }

      const data = (await response.json()) as PreviewResponse;
      setPreview(data.preview);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Could not preview ignore rules.");
    } finally {
      setLoading(false);
    }
  }

  async function runScan() {
    if (!selectedProjectId) {
      setError("Save a project before scanning.");
      return;
    }

    setScanning(true);
    setError(null);
    setScanProgress({ phase: "discovering", progress: 0, fileCount: 0, indexedCount: 0, message: "Preparing scan." });
    setPacket("");
    setFactoryPacket("");
    setFactoryProfile(null);
    setAiResult(null);

    try {
      const response = await fetch(`/api/projects/${selectedProjectId}/scan/stream`, { method: "POST" });
      if (!response.ok || !response.body) {
        throw new Error("Could not start scan.");
      }

      await readScanStream(response.body, (event) => {
        if (event.event === "progress") {
          setScanProgress(event.data);
        }
        if (event.event === "complete") {
          setScanProgress({
            phase: "complete",
            progress: 1,
            fileCount: event.data.summary.fileCount,
            indexedCount: event.data.summary.fileCount,
            message: "Scan complete.",
          });
        }
        if (event.event === "error") {
          setError(event.data.error);
        }
      });

      await loadGraph(selectedProjectId, "overview", null);
      setViewKind("overview");
      setTarget(null);
      setSidePanelMode("warnings");
      await buildFactoryProfile(selectedProjectId, "overview", null);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  async function changeView(nextKind: GraphSliceKind) {
    if (!selectedProjectId) {
      setViewKind(nextKind);
      return;
    }

    const nextTarget = defaultTargetFor(nextKind, targetOptionsFor(nextKind, catalog, slice?.issues ?? []));
    setViewKind(nextKind);
    setTarget(nextTarget);
    setFactoryProfile(null);
    setFactoryPacket("");
    setAiResult(null);
    setLoading(true);
    try {
      await loadGraph(selectedProjectId, nextKind, nextTarget);
    } catch (viewError) {
      setError(viewError instanceof Error ? viewError.message : "Could not load view.");
    } finally {
      setLoading(false);
    }
  }

  async function changeTarget(nextTarget: string) {
    if (!selectedProjectId) {
      return;
    }

    setTarget(nextTarget.length > 0 ? nextTarget : null);
    setFactoryProfile(null);
    setFactoryPacket("");
    setAiResult(null);
    setLoading(true);
    try {
      await loadGraph(selectedProjectId, viewKind, nextTarget.length > 0 ? nextTarget : null);
    } catch (targetError) {
      setError(targetError instanceof Error ? targetError.message : "Could not load target.");
    } finally {
      setLoading(false);
    }
  }

  async function buildPacket() {
    if (!selectedProjectId) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${selectedProjectId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: viewKind, target }),
      });
      if (!response.ok) {
        throw new Error("Could not build export packet.");
      }

      const data = (await response.json()) as ExportResponse;
      setPacket(data.packet.markdown);
    } catch (packetError) {
      setError(packetError instanceof Error ? packetError.message : "Could not build export packet.");
    } finally {
      setLoading(false);
    }
  }

  async function buildFactoryProfile(
    projectId = selectedProjectId,
    kind = viewKind,
    nextTarget = target,
  ) {
    if (!projectId) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ kind });
      if (nextTarget) {
        params.set("target", nextTarget);
      }

      const response = await fetch(`/api/projects/${projectId}/factory?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Could not build factory profile.");
      }

      const data = (await response.json()) as FactoryResponse;
      setFactoryProfile(data.packet.profile);
      setFactoryPacket(data.packet.markdown);
    } catch (factoryError) {
      setError(factoryError instanceof Error ? factoryError.message : "Could not build factory profile.");
    } finally {
      setLoading(false);
    }
  }

  async function runAiScan() {
    if (!selectedProjectId) {
      setError("Save a project before running an AI scan.");
      return;
    }

    setAiScanning(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${selectedProjectId}/ai-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: viewKind, target }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Could not build AI scan.");
      }

      const data = (await response.json()) as AiScanResponse;
      setAiResult(data.result);
      setSidePanelMode("ai");
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Could not build AI scan.");
    } finally {
      setAiScanning(false);
    }
  }

  async function signInWithCodex() {
    setCodexSigningIn(true);
    setError(null);
    setSidePanelMode("ai");
    try {
      const response = await fetch("/api/codex/login", { method: "POST" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Could not start Codex login.");
      }

      const data = (await response.json()) as CodexLoginResponse;
      setCodexSession(data.session);
      setCodexLogin(data.login);
      if (data.session.connected) {
        return;
      }

      if (data.login?.type === "chatgpt") {
        window.open(data.login.authUrl, "_blank", "noopener,noreferrer");
        await pollCodexSession(refreshCodexSession);
      } else if (data.login?.type === "chatgptDeviceCode") {
        window.open(data.login.verificationUrl, "_blank", "noopener,noreferrer");
        await pollCodexSession(refreshCodexSession);
      }
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Could not start Codex login.");
    } finally {
      setCodexSigningIn(false);
    }
  }

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
  }

  function ignoreLines() {
    return ignoreText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  return (
    <DashboardLayout
      projects={projects}
      selectedProjectId={selectedProjectId}
      selectedProject={selectedProject}
      projectName={projectName}
      rootPath={rootPath}
      ignoreText={ignoreText}
      preview={preview}
      loading={loading}
      scanning={scanning}
      error={error}
      slice={slice}
      debugGuide={debugGuide}
      parserHealth={parserHealth}
      scanProgress={scanProgress}
      viewKind={viewKind}
      target={target}
      targetOptions={targetOptions}
      flowNodes={flowNodes}
      flowEdges={flowEdges}
      selectedGraphNode={selectedGraphNode}
      selectedNodeIssues={selectedNodeIssues}
      sidePanelMode={sidePanelMode}
      factoryProfile={factoryProfile}
      factoryPacket={factoryPacket}
      aiResult={aiResult}
      aiScanning={aiScanning}
      codexSession={codexSession}
      codexLogin={codexLogin}
      codexSigningIn={codexSigningIn}
      codexConnected={codexConnected}
      packet={packet}
      onProjectNameChange={setProjectName}
      onRootPathChange={setRootPath}
      onIgnoreTextChange={setIgnoreText}
      onLoadProjects={loadProjects}
      onSelectProject={selectProject}
      onPreviewIgnore={previewIgnore}
      onSaveProject={saveProject}
      onChangeView={changeView}
      onBuildFactory={() => buildFactoryProfile()}
      onSignInWithCodex={signInWithCodex}
      onRunScan={runScan}
      onChangeTarget={changeTarget}
      onRunAiScan={runAiScan}
      onBuildPacket={buildPacket}
      onSelectNode={(nodeId) => {
        setSelectedNodeId(nodeId);
        setSidePanelMode("inspect");
      }}
      onClearNode={() => setSelectedNodeId(null)}
      onSidePanelModeChange={setSidePanelMode}
      onInspectIssue={(issueId) => changeView("issues").then(() => changeTarget(issueId))}
      onOpenSlop={() => changeView("slop")}
      onCopy={copyText}
    />
  );
}

type DashboardLayoutProps = {
  projects: ProjectConfig[];
  selectedProjectId: string | null;
  selectedProject: ProjectConfig | null;
  projectName: string;
  rootPath: string;
  ignoreText: string;
  preview: IgnorePreview | null;
  loading: boolean;
  scanning: boolean;
  error: string | null;
  slice: GraphSlice | null;
  debugGuide: DebugGuide | null;
  parserHealth: ParserHealth;
  scanProgress: ScanProgress | null;
  viewKind: GraphSliceKind;
  target: string | null;
  targetOptions: SelectOption[];
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  selectedGraphNode: GraphNode | null;
  selectedNodeIssues: IssueSignal[];
  sidePanelMode: SidePanelMode;
  factoryProfile: SoftwareFactoryProfile | null;
  factoryPacket: string;
  aiResult: AiScanResult | null;
  aiScanning: boolean;
  codexSession: CodexSession | null;
  codexLogin: CodexLogin | null;
  codexSigningIn: boolean;
  codexConnected: boolean;
  packet: string;
  onProjectNameChange: (value: string) => void;
  onRootPathChange: (value: string) => void;
  onIgnoreTextChange: (value: string) => void;
  onLoadProjects: () => void;
  onSelectProject: (project: ProjectConfig) => void;
  onPreviewIgnore: () => void;
  onSaveProject: () => void;
  onChangeView: (kind: GraphSliceKind) => void;
  onBuildFactory: () => void;
  onSignInWithCodex: () => void;
  onRunScan: () => void;
  onChangeTarget: (target: string) => void;
  onRunAiScan: () => void;
  onBuildPacket: () => void;
  onSelectNode: (nodeId: string) => void;
  onClearNode: () => void;
  onSidePanelModeChange: (mode: SidePanelMode) => void;
  onInspectIssue: (issueId: string) => void;
  onOpenSlop: () => void;
  onCopy: (value: string) => void;
};

function DashboardLayout(props: DashboardLayoutProps) {
  return (
    <div className="atlas-shell min-h-screen text-foreground">
      <DashboardSidebar {...props} />
      <div className="atlas-main">
        <DashboardTopbar {...props} />
        <DashboardMain {...props} />
      </div>
    </div>
  );
}

function DashboardSidebar({
  projects,
  selectedProjectId,
  selectedProject,
  projectName,
  rootPath,
  ignoreText,
  preview,
  loading,
  viewKind,
  onProjectNameChange,
  onRootPathChange,
  onIgnoreTextChange,
  onLoadProjects,
  onSelectProject,
  onPreviewIgnore,
  onSaveProject,
  onChangeView,
  onBuildFactory,
}: DashboardLayoutProps) {
  return (
    <aside className="atlas-sidebar">
      <div className="flex items-center gap-3 px-4 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-primary/40 bg-primary/15 text-primary">
          <Activity className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">Bloodhoud</p>
          <h1 className="text-lg font-semibold">Code Cartography</h1>
        </div>
      </div>

      <nav className="atlas-sidebar-nav space-y-6 px-3">
        <SidebarGroup label="Workspace">
          <SidebarNavItem icon={Home} label="Dashboard" active />
          <SidebarNavItem icon={MapIcon} label="Slop Map" active={viewKind === "slop"} onClick={() => onChangeView("slop")} />
          <SidebarNavItem icon={Factory} label="Software Factory" onClick={onBuildFactory} />
          <SidebarNavItem icon={Search} label="Signals" active={viewKind === "issues"} onClick={() => onChangeView("issues")} />
        </SidebarGroup>
        <SidebarGroup label="Graph Slices">
          {viewOptions.slice(0, 7).map((option) => (
            <SidebarNavItem
              key={option.kind}
              icon={option.icon}
              label={option.label}
              active={viewKind === option.kind}
              onClick={() => onChangeView(option.kind)}
            />
          ))}
        </SidebarGroup>
      </nav>

      <div className="atlas-sidebar-panels mt-6 space-y-4 px-3 pb-4">
        <ProjectSidePanel
          projectName={projectName}
          rootPath={rootPath}
          ignoreText={ignoreText}
          preview={preview}
          loading={loading}
          selectedProject={selectedProject}
          onProjectNameChange={onProjectNameChange}
          onRootPathChange={onRootPathChange}
          onIgnoreTextChange={onIgnoreTextChange}
          onLoadProjects={onLoadProjects}
          onPreviewIgnore={onPreviewIgnore}
          onSaveProject={onSaveProject}
        />
        <RepositorySidePanel
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={onSelectProject}
        />
      </div>
    </aside>
  );
}

function ProjectSidePanel({
  projectName,
  rootPath,
  ignoreText,
  preview,
  loading,
  selectedProject,
  onProjectNameChange,
  onRootPathChange,
  onIgnoreTextChange,
  onLoadProjects,
  onPreviewIgnore,
  onSaveProject,
}: Pick<DashboardLayoutProps, "projectName" | "rootPath" | "ignoreText" | "preview" | "loading" | "selectedProject" | "onProjectNameChange" | "onRootPathChange" | "onIgnoreTextChange" | "onLoadProjects" | "onPreviewIgnore" | "onSaveProject">) {
  const projectActionDisabled = loading || rootPath.trim().length === 0;

  return (
    <section className="atlas-side-panel">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Project</h2>
          <p className="text-xs text-muted-foreground">{selectedProject ? "Indexed workspace" : "No workspace"}</p>
        </div>
        <button type="button" onClick={onLoadProjects} className="atlas-icon-button" aria-label="Refresh projects">
          <RefreshCcw className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-3">
        <Field label="Name" value={projectName} onChange={onProjectNameChange} placeholder="Bloodhoud Demo" />
        <Field label="Root path" value={rootPath} onChange={onRootPathChange} placeholder="/Users/home/path/to/project" />
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Ignore patterns</span>
          <textarea
            value={ignoreText}
            onChange={(event) => onIgnoreTextChange(event.target.value)}
            className="atlas-textarea min-h-24"
            spellCheck={false}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onPreviewIgnore} disabled={projectActionDisabled} className="atlas-button-secondary">
            <ListFilter className="h-4 w-4" aria-hidden="true" />
            Preview
          </button>
          <button type="button" onClick={onSaveProject} disabled={projectActionDisabled} className="atlas-button-primary">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Braces className="h-4 w-4" aria-hidden="true" />}
            Save
          </button>
        </div>
      </div>

      {preview ? <IgnorePreviewSummary preview={preview} /> : null}
    </section>
  );
}

function IgnorePreviewSummary({ preview }: { preview: IgnorePreview }) {
  return (
    <div className="mt-4 space-y-3 border-t border-border pt-3 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <MiniMetric label="Indexed" value={preview.indexedCount} />
        <MiniMetric label="Ignored" value={preview.ignoredCount} />
      </div>
      <p className="line-clamp-3 text-muted-foreground">
        {preview.ignoredSamples.length > 0 ? preview.ignoredSamples.join(", ") : "No ignored files matched."}
      </p>
    </div>
  );
}

function RepositorySidePanel({
  projects,
  selectedProjectId,
  onSelectProject,
}: Pick<DashboardLayoutProps, "projects" | "selectedProjectId" | "onSelectProject">) {
  return (
    <section className="atlas-side-panel">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Repositories</h2>
        <span className="atlas-count">{projects.length}</span>
      </div>
      {projects.length === 0 ? (
        <EmptyState title="No projects yet" copy="Save a local path to begin." />
      ) : (
        <div className="max-h-52 space-y-2 overflow-auto pr-1">
          {projects.map((project) => (
            <button
              type="button"
              key={project.id}
              onClick={() => onSelectProject(project)}
              className={`atlas-project-row ${project.id === selectedProjectId ? "atlas-project-row-active" : ""}`}
            >
              <span className="block truncate font-medium">{project.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{project.rootPath}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function DashboardTopbar({
  viewKind,
  slice,
  loading,
  factoryProfile,
  selectedProject,
  scanning,
  codexSession,
  codexSigningIn,
  codexConnected,
  onChangeView,
  onBuildFactory,
  onSignInWithCodex,
  onRunScan,
}: DashboardLayoutProps) {
  return (
    <header className="atlas-topbar">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-8">
        <div>
          <p className="atlas-eyebrow">Home</p>
          <h2 className="text-2xl font-semibold">Bloodhoud</h2>
        </div>
        <TopTabs
          viewKind={viewKind}
          factoryActive={Boolean(factoryProfile)}
          factoryDisabled={!slice || loading}
          onChangeView={onChangeView}
          onBuildFactory={onBuildFactory}
        />
      </div>
      <div className="flex items-center gap-2">
        <div className="atlas-command hidden sm:flex">
          <Search className="h-4 w-4" aria-hidden="true" />
          <span>Search graph</span>
          <kbd>⌘K</kbd>
        </div>
        <CodexButton
          session={codexSession}
          signingIn={codexSigningIn}
          connected={codexConnected}
          onSignIn={onSignInWithCodex}
        />
        <button type="button" onClick={onRunScan} disabled={!selectedProject || scanning} className="atlas-button-primary">
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          Scan
        </button>
      </div>
    </header>
  );
}

function TopTabs({
  viewKind,
  factoryActive,
  factoryDisabled,
  onChangeView,
  onBuildFactory,
}: {
  viewKind: GraphSliceKind;
  factoryActive: boolean;
  factoryDisabled: boolean;
  onChangeView: (kind: GraphSliceKind) => void;
  onBuildFactory: () => void;
}) {
  return (
    <div className="atlas-top-tabs">
      <button type="button" onClick={() => onChangeView("overview")} className={`atlas-top-tab ${viewKind === "overview" ? "atlas-top-tab-active" : ""}`}>
        Overview
      </button>
      <button type="button" onClick={() => onChangeView("feature")} className={`atlas-top-tab ${contentTabActive(viewKind) ? "atlas-top-tab-active" : ""}`}>
        Content
      </button>
      <button type="button" onClick={() => onChangeView("slop")} className={`atlas-top-tab ${debuggingTabActive(viewKind) ? "atlas-top-tab-active" : ""}`}>
        Debugging
      </button>
      <button type="button" onClick={onBuildFactory} disabled={factoryDisabled} className={`atlas-top-tab ${factoryActive ? "atlas-top-tab-active" : ""}`}>
        Factory
      </button>
    </div>
  );
}

function CodexButton({
  session,
  signingIn,
  connected,
  onSignIn,
}: {
  session: CodexSession | null;
  signingIn: boolean;
  connected: boolean;
  onSignIn: () => void;
}) {
  return (
    <button type="button" onClick={onSignIn} disabled={signingIn} className={connected ? "atlas-button-secondary" : "atlas-button-primary"}>
      {signingIn ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : connected ? <Bot className="h-4 w-4" aria-hidden="true" /> : <LogIn className="h-4 w-4" aria-hidden="true" />}
      {signingIn ? "Connecting Codex" : connected ? codexAccountLabel(session) : "Sign in with Codex"}
    </button>
  );
}

function DashboardMain(props: DashboardLayoutProps) {
  return (
    <main className="space-y-5 p-4 md:p-6">
      {props.error ? <div className="atlas-alert">{props.error}</div> : null}
      <StudioSummary slice={props.slice} guide={props.debugGuide} scanProgress={props.scanProgress} />
      <ParserHealthPanel health={props.parserHealth} />
      <GraphStudioSection {...props} />
      {props.debugGuide ? <DebugGuidePanel guide={props.debugGuide} onCopy={() => props.onCopy(props.debugGuide?.mermaid ?? "")} /> : null}
      {props.slice && props.debugGuide ? <DeslopifyWorkbench slice={props.slice} guide={props.debugGuide} onInspectIssue={props.onInspectIssue} onOpenSlop={props.onOpenSlop} onOpenView={props.onChangeView} onBuildPacket={props.onBuildPacket} /> : null}
      {props.aiResult ? <AiReviewWorkbench result={props.aiResult} onInspectIssue={props.onInspectIssue} onCopy={props.onCopy} /> : null}
      <SoftwareFactorySection {...props} />
      <MermaidSignalsGrid {...props} />
      <PacketSection packet={props.packet} onCopy={props.onCopy} />
    </main>
  );
}

function StudioSummary({
  slice,
  guide,
  scanProgress,
}: {
  slice: GraphSlice | null;
  guide: DebugGuide | null;
  scanProgress: ScanProgress | null;
}) {
  return (
    <section className="atlas-studio-summary">
      <StudioStat icon={Gauge} label="Architecture" value={guide ? `${guide.score}/100` : "-"} />
      <StudioStat icon={FileCode2} label="Files" value={`${slice?.summary.fileCount ?? 0}`} />
      <StudioStat icon={Boxes} label="Workspaces" value={`${slice?.summary.workspaceCount ?? 0}`} />
      <StudioStat icon={Boxes} label="Features" value={`${slice?.summary.featureCount ?? 0}`} />
      <StudioStat icon={Route} label="Routes" value={`${slice?.summary.routeCount ?? 0}`} />
      <StudioStat icon={Gauge} label="Runtime Ports" value={`${slice?.summary.runtimePortCount ?? 0}`} />
      <StudioStat icon={AlertTriangle} label="Broken Paths" value={`${slice?.summary.brokenEdgeCount ?? 0}`} />
      <ScanProgressStat progress={scanProgress} />
    </section>
  );
}

function ScanProgressStat({ progress }: { progress: ScanProgress | null }) {
  return (
    <div className="atlas-studio-progress">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Scan</span>
        <span className="text-sm font-semibold">{progress?.phase ?? "Idle"}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round((progress?.progress ?? 0) * 100)}%` }} />
      </div>
      <p className="mt-2 truncate text-xs text-muted-foreground">{progress ? progress.message : "No active scan."}</p>
    </div>
  );
}

function GraphStudioSection(props: DashboardLayoutProps) {
  return (
    <section className="atlas-graph-studio">
      <GraphToolbar {...props} />
      <div className="atlas-graph-body">
        <FlowCanvas
          slice={props.slice}
          flowNodes={props.flowNodes}
          flowEdges={props.flowEdges}
          loading={props.loading}
          viewKind={props.viewKind}
          target={props.target}
          onSelectNode={props.onSelectNode}
          onClearNode={props.onClearNode}
        />
        <CanvasSidePanel
          mode={props.sidePanelMode}
          onModeChange={props.onSidePanelModeChange}
          node={props.selectedGraphNode}
          issues={props.selectedNodeIssues}
          slice={props.slice}
          guide={props.debugGuide}
          aiResult={props.aiResult}
          aiScanning={props.aiScanning}
          codexSession={props.codexSession}
          codexLogin={props.codexLogin}
          codexSigningIn={props.codexSigningIn}
          codexConnected={props.codexConnected}
          onInspectIssue={props.onInspectIssue}
          onOpenView={props.onChangeView}
          onRunAiScan={props.onRunAiScan}
          onSignInWithCodex={props.onSignInWithCodex}
          onCopy={props.onCopy}
        />
      </div>
    </section>
  );
}

function GraphToolbar({
  selectedProject,
  viewKind,
  target,
  targetOptions,
  slice,
  loading,
  aiScanning,
  codexSigningIn,
  codexConnected,
  onChangeView,
  onChangeTarget,
  onRunAiScan,
  onSignInWithCodex,
  onBuildPacket,
}: DashboardLayoutProps) {
  return (
    <div className="atlas-graph-toolbar">
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-base font-semibold">Graph Canvas</h3>
        <p className="truncate text-xs text-muted-foreground">{selectedProject?.rootPath ?? "Save a local project to begin"}</p>
      </div>
      <GraphViewTabs viewKind={viewKind} onChangeView={onChangeView} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <GraphTargetSelect target={target} targetOptions={targetOptions} onChangeTarget={onChangeTarget} />
        <button
          type="button"
          onClick={codexConnected ? onRunAiScan : onSignInWithCodex}
          disabled={codexConnected ? !slice || aiScanning : codexSigningIn}
          className={codexConnected ? "atlas-button-primary" : "atlas-button-secondary"}
        >
          {aiScanning || codexSigningIn ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : codexConnected ? <Bot className="h-4 w-4" aria-hidden="true" /> : <LogIn className="h-4 w-4" aria-hidden="true" />}
          {codexConnected ? "AI Scan" : codexSigningIn ? "Connecting Codex" : "Sign in with Codex"}
        </button>
        <button type="button" onClick={onBuildPacket} disabled={!slice || loading} className="atlas-button-secondary">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Packet
        </button>
      </div>
    </div>
  );
}

function GraphViewTabs({ viewKind, onChangeView }: { viewKind: GraphSliceKind; onChangeView: (kind: GraphSliceKind) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {viewOptions.map((option) => {
        const Icon = option.icon;
        return (
          <button type="button" key={option.kind} onClick={() => onChangeView(option.kind)} className={`atlas-tab ${viewKind === option.kind ? "atlas-tab-active" : ""}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function GraphTargetSelect({
  target,
  targetOptions,
  onChangeTarget,
}: {
  target: string | null;
  targetOptions: SelectOption[];
  onChangeTarget: (target: string) => void;
}) {
  return (
    <select value={target ?? ""} onChange={(event) => onChangeTarget(event.target.value)} disabled={targetOptions.length === 0} className="atlas-select" aria-label="Graph target">
      <option value="">Whole slice</option>
      {targetOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function FlowCanvas({
  slice,
  flowNodes,
  flowEdges,
  loading,
  viewKind,
  target,
  onSelectNode,
  onClearNode,
}: {
  slice: GraphSlice | null;
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  loading: boolean;
  viewKind: GraphSliceKind;
  target: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearNode: () => void;
}) {
  return (
    <div className="atlas-canvas">
      <FlowCanvasContent
        slice={slice}
        flowNodes={flowNodes}
        flowEdges={flowEdges}
        loading={loading}
        viewKind={viewKind}
        target={target}
        onSelectNode={onSelectNode}
        onClearNode={onClearNode}
      />
    </div>
  );
}

function FlowCanvasContent({
  slice,
  flowNodes,
  flowEdges,
  loading,
  viewKind,
  target,
  onSelectNode,
  onClearNode,
}: {
  slice: GraphSlice | null;
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  loading: boolean;
  viewKind: GraphSliceKind;
  target: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearNode: () => void;
}) {
  if (slice && flowNodes.length > 0) {
    return <InteractiveFlow slice={slice} flowNodes={flowNodes} flowEdges={flowEdges} viewKind={viewKind} target={target} onSelectNode={onSelectNode} onClearNode={onClearNode} />;
  }

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-label="Loading graph" />
      </div>
    );
  }

  return (
    <div className="grid h-full place-items-center">
      <EmptyState title="No graph loaded" copy="Save a project and scan it to populate the canvas." />
    </div>
  );
}

function InteractiveFlow({
  slice,
  flowNodes,
  flowEdges,
  viewKind,
  target,
  onSelectNode,
  onClearNode,
}: {
  slice: GraphSlice;
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  viewKind: GraphSliceKind;
  target: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearNode: () => void;
}) {
  return (
    <>
      <ReactFlow
        key={`${slice.summary.scanId}:${viewKind}:${target ?? "all"}`}
        defaultNodes={flowNodes}
        defaultEdges={flowEdges}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onSelectionChange={({ nodes }) => {
          const selectedNode = nodes[0];
          if (selectedNode) {
            onSelectNode(selectedNode.id);
          } else {
            onClearNode();
          }
        }}
        onPaneClick={onClearNode}
        defaultViewport={{ x: 32, y: 112, zoom: 0.76 }}
        elementsSelectable
        nodesDraggable
        panOnDrag
        zoomOnScroll
        minZoom={0.2}
        maxZoom={1.4}
      >
        <Background />
        <MiniMap pannable zoomable bgColor="#11110f" maskColor="rgba(8, 8, 7, 0.68)" nodeColor="#e5b72f" />
        <Controls />
      </ReactFlow>
      <FlowLegend slice={slice} />
    </>
  );
}

function SoftwareFactorySection({
  slice,
  loading,
  factoryProfile,
  factoryPacket,
  onBuildFactory,
  onCopy,
}: DashboardLayoutProps) {
  return (
    <section className="atlas-card p-4">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Factory className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold">Software Factory</h2>
          </div>
          <p className="text-sm text-muted-foreground">Shared context, agent lanes, triggers, guardrails, and reusable skills from the current graph slice.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={onBuildFactory} disabled={!slice || loading} className="atlas-button-primary">
            <Workflow className="h-4 w-4" aria-hidden="true" />
            Build Factory
          </button>
          <button type="button" onClick={() => onCopy(factoryPacket)} disabled={!factoryPacket} className="atlas-button-secondary">
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy
          </button>
        </div>
      </div>

      {factoryProfile ? <SoftwareFactoryProfileView profile={factoryProfile} /> : <EmptyState title="No factory profile yet" copy="Build one after loading a graph slice to create agent-ready shared context." />}
    </section>
  );
}

function SoftwareFactoryProfileView({ profile }: { profile: SoftwareFactoryProfile }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {profile.metrics.map((metric) => (
          <div key={metric.label} className="rounded-md border border-border bg-background p-3">
            <div className="text-xs text-muted-foreground">{metric.label}</div>
            <div className="mt-1 text-xl font-semibold">{metric.value}</div>
            <p className="mt-2 text-xs text-muted-foreground">{metric.detail}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <FactoryColumn icon={BookOpen} title="Context Snapshots" items={profile.snapshots.map((snapshot) => ({ title: snapshot.title, detail: snapshot.description, meta: `${snapshot.sources.length} sources` }))} />
        <FactoryColumn icon={Bot} title="Agent Lanes" items={profile.agents.map((agent) => ({ title: agent.name, detail: agent.role, meta: agent.trigger }))} />
        <FactoryColumn icon={ShieldCheck} title="Guardrails" items={profile.guardrails.map((guardrail) => ({ title: guardrail.name, detail: guardrail.rationale, meta: guardrail.severity }))} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <FactoryColumn icon={Workflow} title="Triggers" items={profile.triggers.map((trigger) => ({ title: trigger.name, detail: `${trigger.event}; ${trigger.action}`, meta: trigger.condition }))} />
        <FactoryColumn icon={Sparkles} title="Reusable Skills" items={profile.skills.map((skill) => ({ title: skill.name, detail: skill.prompt, meta: skill.appliesTo }))} />
      </div>
    </div>
  );
}

function MermaidSignalsGrid({ slice, onCopy, onInspectIssue }: DashboardLayoutProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="atlas-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Mermaid</h2>
            <p className="text-sm text-muted-foreground">Flowchart for the current graph slice.</p>
          </div>
          <button type="button" onClick={() => onCopy(slice?.mermaid ?? "")} disabled={!slice} className="atlas-button-secondary">
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy
          </button>
        </div>
        {slice ? <MermaidPreview chart={slice.mermaid} /> : <EmptyState title="No chart yet" copy="Mermaid appears after a graph slice loads." />}
      </section>
      <SignalsCard slice={slice} onInspectIssue={onInspectIssue} />
    </div>
  );
}

function SignalsCard({ slice, onInspectIssue }: { slice: GraphSlice | null; onInspectIssue: (issueId: string) => void }) {
  return (
    <section className="atlas-card p-4">
      <div className="mb-3">
        <h2 className="text-base font-semibold">Signals</h2>
        <p className="text-sm text-muted-foreground">Static findings with confidence labels.</p>
      </div>
      {slice?.issues.length ? (
        <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
          {slice.issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} onInspect={() => onInspectIssue(issue.id)} />
          ))}
        </div>
      ) : (
        <EmptyState title="No signals in slice" copy="Switch views or scan a project with more route and dependency data." />
      )}
    </section>
  );
}

function PacketSection({ packet, onCopy }: { packet: string; onCopy: (value: string) => void }) {
  if (!packet) {
    return null;
  }

  return (
    <section className="atlas-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">AI Packet</h2>
          <p className="text-sm text-muted-foreground">Evidence bundle for cleanup, debugging, and de-sloppification prompts.</p>
        </div>
        <button type="button" onClick={() => onCopy(packet)} className="atlas-button-secondary">
          <Copy className="h-4 w-4" aria-hidden="true" />
          Copy
        </button>
      </div>
      <textarea
        value={packet}
        readOnly
        className="h-80 w-full rounded-md border border-border bg-background/80 p-3 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </section>
  );
}

function contentTabActive(kind: GraphSliceKind): boolean {
  return kind === "workspace" || kind === "feature" || kind === "route" || kind === "dependencies" || kind === "contracts" || kind === "runtime";
}

function debuggingTabActive(kind: GraphSliceKind): boolean {
  return kind === "slop" || kind === "issues" || kind === "duplicates";
}

function SidebarGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="atlas-sidebar-group space-y-2">
      <p className="atlas-sidebar-label px-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <div className="atlas-sidebar-items space-y-1">{children}</div>
    </div>
  );
}

function SidebarNavItem({
  icon: Icon,
  label,
  active = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={`atlas-nav-item ${active ? "atlas-nav-item-active" : ""}`}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="atlas-input"
      />
    </label>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-background/70 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

function buildParserHealth(summary: GraphSlice["summary"] | null): ParserHealth {
  if (!summary) {
    return {
      coverageLabel: "0%",
      metrics: [
        { label: "Resolved Local Imports", value: "0", detail: "No scan loaded.", width: 0, tone: "atlas-parser-fill-good" },
        { label: "Unresolved Local Imports", value: "0", detail: "Run a scan to validate aliases.", width: 0, tone: "atlas-parser-fill-warn" },
        { label: "External Dependencies", value: "0", detail: "No dependency nodes loaded.", width: 0, tone: "atlas-parser-fill-info" },
        { label: "Types + Permissions", value: "0", detail: "No contract nodes loaded.", width: 0, tone: "atlas-parser-fill-type" },
        { label: "Runtime Readiness", value: "0", detail: "No startup or port signals loaded.", width: 0, tone: "atlas-parser-fill-runtime" },
        { label: "Broken Paths", value: "0", detail: "No broken edges loaded.", width: 0, tone: "atlas-parser-fill-broken" },
        { label: "Components + Hooks", value: "0", detail: "No declarations loaded.", width: 0, tone: "atlas-parser-fill-neutral" },
      ],
    };
  }

  const localImportCount = summary.internalImportCount + summary.unresolvedImportCount;
  const coverage = localImportCount === 0 ? 100 : Math.round((summary.internalImportCount / localImportCount) * 100);
  const contractCount = summary.typeCount + summary.permissionCount;
  const declarationCount = summary.componentCount + summary.hookCount;
  const pathHealthCount = summary.brokenEdgeCount + summary.warningEdgeCount;
  const runtimeCount = summary.runtimePortCount + summary.startupIssueCount + summary.timingIssueCount;
  const largestMetric = Math.max(localImportCount, summary.externalDependencyCount, contractCount, runtimeCount, declarationCount, pathHealthCount, 1);

  return {
    coverageLabel: `${coverage}%`,
    metrics: [
      {
        label: "Resolved Local Imports",
        value: summary.internalImportCount.toLocaleString(),
        detail: `${localImportCount.toLocaleString()} local import references detected.`,
        width: localImportCount === 0 ? 0 : coverage,
        tone: "atlas-parser-fill-good",
      },
      {
        label: "Unresolved Local Imports",
        value: summary.unresolvedImportCount.toLocaleString(),
        detail: "Aliases and relative paths that did not resolve.",
        width: localImportCount === 0 ? 0 : Math.round((summary.unresolvedImportCount / localImportCount) * 100),
        tone: "atlas-parser-fill-warn",
      },
      {
        label: "External Dependencies",
        value: summary.externalDependencyCount.toLocaleString(),
        detail: "Package imports separated from project files.",
        width: scaledMetricWidth(summary.externalDependencyCount, largestMetric),
        tone: "atlas-parser-fill-info",
      },
      {
        label: "Types + Permissions",
        value: contractCount.toLocaleString(),
        detail: `${summary.typeCount.toLocaleString()} types, ${summary.permissionCount.toLocaleString()} permission uses.`,
        width: scaledMetricWidth(contractCount, largestMetric),
        tone: "atlas-parser-fill-type",
      },
      {
        label: "Runtime Readiness",
        value: runtimeCount.toLocaleString(),
        detail: `${summary.runtimePortCount.toLocaleString()} ports, ${summary.startupIssueCount.toLocaleString()} startup risks, ${summary.timingIssueCount.toLocaleString()} timing risks.`,
        width: scaledMetricWidth(runtimeCount, largestMetric),
        tone: summary.startupIssueCount > 0 || summary.timingIssueCount > 0 ? "atlas-parser-fill-warn" : "atlas-parser-fill-runtime",
      },
      {
        label: "Broken + Warning Paths",
        value: pathHealthCount.toLocaleString(),
        detail: `${summary.brokenEdgeCount.toLocaleString()} broken, ${summary.warningEdgeCount.toLocaleString()} warning.`,
        width: scaledMetricWidth(pathHealthCount, largestMetric),
        tone: summary.brokenEdgeCount > 0 ? "atlas-parser-fill-broken" : "atlas-parser-fill-warn",
      },
      {
        label: "Components + Hooks",
        value: declarationCount.toLocaleString(),
        detail: `${summary.componentCount.toLocaleString()} components, ${summary.hookCount.toLocaleString()} hooks.`,
        width: scaledMetricWidth(declarationCount, largestMetric),
        tone: "atlas-parser-fill-neutral",
      },
    ],
  };
}

function scaledMetricWidth(value: number, maxValue: number): number {
  if (value === 0) {
    return 0;
  }

  return Math.max(8, Math.round((value / maxValue) * 100));
}

function ParserHealthPanel({ health }: { health: ParserHealth }) {
  return (
    <section className="atlas-parser-health" aria-label="Parser health">
      <div className="atlas-parser-health-header">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold">Parser Health</h3>
            <p className="text-xs text-muted-foreground">Import coverage, dependency resolution, and structural signals.</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Local Import Coverage</p>
          <p className="text-lg font-semibold tabular-nums">{health.coverageLabel}</p>
        </div>
      </div>
      <div className="atlas-parser-health-grid">
        {health.metrics.map((metric) => (
          <div key={metric.label} className="atlas-parser-metric">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{metric.label}</span>
              <span className="text-sm font-semibold tabular-nums">{metric.value}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${metric.tone}`} style={{ width: `${metric.width}%` }} />
            </div>
            <p className="mt-2 truncate text-xs text-muted-foreground">{metric.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FlowLegend({ slice }: { slice: GraphSlice }) {
  const good = slice.edges.filter((edge) => edgeHealth(edge) === "good").length;
  const warning = slice.edges.filter((edge) => edgeHealth(edge) === "warning").length;
  const broken = slice.edges.filter((edge) => edgeHealth(edge) === "broken").length;
  const runtime = slice.nodes.filter((node) => node.kind === "runtime").length;

  return (
    <div className="atlas-flow-legend" aria-label="Flow health legend">
      <LegendItem tone="good" label="Good" value={good} />
      <LegendItem tone="warning" label="Warning" value={warning} />
      <LegendItem tone="broken" label="Broken" value={broken} />
      <LegendItem tone="runtime" label="Runtime" value={runtime} />
    </div>
  );
}

function LegendItem({ tone, label, value }: { tone: "good" | "warning" | "broken" | "runtime"; label: string; value: number }) {
  return (
    <div className="atlas-legend-item">
      <span className={`atlas-legend-dot atlas-legend-${tone}`} />
      <span>{label}</span>
      <span>{value.toLocaleString()}</span>
    </div>
  );
}

function StudioStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="atlas-studio-stat">
      <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-base font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function CanvasSidePanel({
  mode,
  onModeChange,
  node,
  issues,
  slice,
  guide,
  aiResult,
  aiScanning,
  codexSession,
  codexLogin,
  codexSigningIn,
  codexConnected,
  onInspectIssue,
  onOpenView,
  onRunAiScan,
  onSignInWithCodex,
  onCopy,
}: {
  mode: SidePanelMode;
  onModeChange: (mode: SidePanelMode) => void;
  node: GraphNode | null;
  issues: IssueSignal[];
  slice: GraphSlice | null;
  guide: DebugGuide | null;
  aiResult: AiScanResult | null;
  aiScanning: boolean;
  codexSession: CodexSession | null;
  codexLogin: CodexLogin | null;
  codexSigningIn: boolean;
  codexConnected: boolean;
  onInspectIssue: (issueId: string) => void;
  onOpenView: (kind: GraphSliceKind) => void;
  onRunAiScan: () => void;
  onSignInWithCodex: () => void;
  onCopy: (value: string) => void;
}) {
  return (
    <aside className="atlas-inspector">
      <div className="atlas-side-tabs" role="tablist" aria-label="Canvas side panel">
        <SidePanelTab label="Warnings" active={mode === "warnings"} onClick={() => onModeChange("warnings")} />
        <SidePanelTab label="Inspect" active={mode === "inspect"} onClick={() => onModeChange("inspect")} />
        <SidePanelTab label="Story" active={mode === "story"} onClick={() => onModeChange("story")} />
        <SidePanelTab label="AI" active={mode === "ai"} onClick={() => onModeChange("ai")} />
      </div>

      {mode === "warnings" ? (
        <WarningsPanel slice={slice} guide={guide} onInspectIssue={onInspectIssue} onOpenView={onOpenView} />
      ) : null}
      {mode === "inspect" ? (
        <NodeInspectorPanel node={node} issues={issues} slice={slice} onInspectIssue={onInspectIssue} />
      ) : null}
      {mode === "story" ? (
        <StoryPanel slice={slice} guide={guide} onOpenView={onOpenView} />
      ) : null}
      {mode === "ai" ? (
        <AiPanel
          result={aiResult}
          scanning={aiScanning}
          codexSession={codexSession}
          codexLogin={codexLogin}
          codexSigningIn={codexSigningIn}
          codexConnected={codexConnected}
          onRunAiScan={onRunAiScan}
          onSignInWithCodex={onSignInWithCodex}
          onInspectIssue={onInspectIssue}
          onCopy={onCopy}
        />
      ) : null}
    </aside>
  );
}

function SidePanelTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`atlas-side-tab ${active ? "atlas-side-tab-active" : ""}`}>
      {label}
    </button>
  );
}

function WarningsPanel({
  slice,
  guide,
  onInspectIssue,
  onOpenView,
}: {
  slice: GraphSlice | null;
  guide: DebugGuide | null;
  onInspectIssue: (issueId: string) => void;
  onOpenView: (kind: GraphSliceKind) => void;
}) {
  const activeIssues = slice?.issues ?? [];
  const patterns = buildPatternRows(activeIssues).slice(0, 5);
  const queue = buildFixQueue(activeIssues).slice(0, 7);
  const criticalCount = activeIssues.filter((issue) => issue.severity === "critical").length;
  const warningCount = activeIssues.filter((issue) => issue.severity === "warning").length;
  const infoCount = activeIssues.filter((issue) => issue.severity === "info").length;

  return (
    <div className="atlas-panel-stack">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Slop Radar</p>
        <h3 className="mt-2 text-lg font-semibold">{guide ? `${guide.score}/100 architecture` : "No scan loaded"}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{guide?.headline ?? "Scan a project to rank architecture, route, async, and contract warnings."}</p>
      </div>

      <div className="atlas-inspector-grid">
        <MiniMetric label="Critical" value={criticalCount} />
        <MiniMetric label="Warning" value={warningCount} />
        <MiniMetric label="Info" value={infoCount} />
      </div>

      <div className="atlas-inspector-section">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4>Launch Readiness</h4>
          <button type="button" onClick={() => onOpenView("runtime")} className="atlas-panel-link">Runtime</button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <MiniMetric label="Ports" value={slice?.summary.runtimePortCount ?? 0} />
          <MiniMetric label="Startup" value={slice?.summary.startupIssueCount ?? 0} />
          <MiniMetric label="Timing" value={slice?.summary.timingIssueCount ?? 0} />
        </div>
      </div>

      <div className="atlas-inspector-section">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4>Signal Families</h4>
          <button type="button" onClick={() => onOpenView("slop")} className="atlas-panel-link">Slop Map</button>
        </div>
        <div className="space-y-3">
          {patterns.map((pattern) => (
            <div key={pattern.kind} className="atlas-warning-pattern">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-medium">{pattern.label}</span>
                <span className="text-xs text-muted-foreground">{pattern.count}</span>
              </div>
              <div className="atlas-matrix-bar mt-2">
                <span className="bg-critical" style={{ width: `${pattern.criticalPercent}%` }} />
                <span className="bg-warning" style={{ width: `${pattern.warningPercent}%` }} />
                <span className="bg-primary" style={{ width: `${pattern.infoPercent}%` }} />
              </div>
            </div>
          ))}
          {patterns.length === 0 ? <p className="text-sm text-muted-foreground">No active warning families.</p> : null}
        </div>
      </div>

      <div className="atlas-inspector-section">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4>Highest Evidence</h4>
          <button type="button" onClick={() => onOpenView("issues")} className="atlas-panel-link">All Issues</button>
        </div>
        <div className="space-y-2">
          {queue.map((issue) => (
            <button type="button" key={issue.id} onClick={() => onInspectIssue(issue.id)} className="atlas-warning-row">
              <span className="min-w-0">
                <span className="line-clamp-2 text-sm font-medium">{issue.title}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{issue.filePaths[0] ?? issue.kind}</span>
              </span>
              <IssueConfidenceBadge issue={issue} />
            </button>
          ))}
          {queue.length === 0 ? <p className="text-sm text-muted-foreground">No warnings in this slice.</p> : null}
        </div>
      </div>
    </div>
  );
}

function StoryPanel({
  slice,
  guide,
  onOpenView,
}: {
  slice: GraphSlice | null;
  guide: DebugGuide | null;
  onOpenView: (kind: GraphSliceKind) => void;
}) {
  const story = slice && guide ? buildCodebaseStory(slice, guide) : [];
  const learningPath = slice && guide ? buildLearningPath(slice, guide) : [];

  return (
    <div className="atlas-panel-stack">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Codebase Story</p>
        <h3 className="mt-2 text-lg font-semibold">{slice?.summary.projectName ?? "No project selected"}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Routes, ownership, dependencies, runtime pressure, and cleanup progress.</p>
      </div>

      <div className="atlas-inspector-section">
        <h4>Story Chapters</h4>
        <div className="space-y-2">
          {story.map((chapter, index) => (
            <button
              type="button"
              key={chapter.id}
              onClick={() => onOpenView(chapter.view)}
              className={`atlas-story-mini atlas-story-${chapter.status}`}
            >
              <span>{index + 1}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{chapter.title}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{chapter.metric}</span>
              </span>
            </button>
          ))}
          {story.length === 0 ? <p className="text-sm text-muted-foreground">Scan a project to build the story path.</p> : null}
        </div>
      </div>

      <div className="atlas-inspector-section">
        <h4>Learning Path</h4>
        <div className="space-y-2">
          {learningPath.map((step) => (
            <button
              type="button"
              key={step.id}
              onClick={() => onOpenView(step.view)}
              className={`atlas-learning-mini atlas-learning-${step.status}`}
            >
              <span className="atlas-learning-dot" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{step.title}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{step.metric}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AiPanel({
  result,
  scanning,
  codexSession,
  codexLogin,
  codexSigningIn,
  codexConnected,
  onRunAiScan,
  onSignInWithCodex,
  onInspectIssue,
  onCopy,
}: {
  result: AiScanResult | null;
  scanning: boolean;
  codexSession: CodexSession | null;
  codexLogin: CodexLogin | null;
  codexSigningIn: boolean;
  codexConnected: boolean;
  onRunAiScan: () => void;
  onSignInWithCodex: () => void;
  onInspectIssue: (issueId: string) => void;
  onCopy: (value: string) => void;
}) {
  if (!result) {
    return (
      <div className="atlas-panel-stack">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">AI Review</p>
          <h3 className="mt-2 text-lg font-semibold">{codexConnected ? "Codex connected" : codexSigningIn ? "Waiting for Codex login" : "Sign in with Codex"}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Connect through the local Codex app-server, then run an AI review to check false positives and generate skills, docs, guidelines, and visual debugging charts.</p>
        </div>
        <button
          type="button"
          onClick={codexConnected ? onRunAiScan : onSignInWithCodex}
          disabled={codexConnected ? scanning : codexSigningIn}
          className="atlas-button-primary"
        >
          {scanning || codexSigningIn ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : codexConnected ? <Bot className="h-4 w-4" aria-hidden="true" /> : <LogIn className="h-4 w-4" aria-hidden="true" />}
          {codexConnected ? "Run AI Scan" : codexSigningIn ? "Waiting for Codex" : "Sign in with Codex"}
        </button>
        <CodexAuthCard session={codexSession} login={codexLogin} />
        <div className="atlas-inspector-section">
          <h4>Connection Model</h4>
          <p>Bloodhoud calls the local Codex app-server account/login/start flow and never asks for or stores tokens.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="atlas-panel-stack">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">AI Review</p>
        <div className="mt-2 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold">{aiModeLabel(result)}</h3>
          <span className="atlas-registry-badge">{codexConnected ? "Codex" : result.model}</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{result.summary}</p>
      </div>

      <div className="atlas-inspector-grid">
        <MiniMetric label="Confidence" value={Math.round(result.confidenceScore)} />
        <MiniMetric label="Reviews" value={result.falsePositiveReviews.length} />
        <MiniMetric label="Skills" value={result.generatedSkills.length} />
      </div>

      <div className="atlas-inspector-section">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4>False Positive Filter</h4>
          <button type="button" onClick={onRunAiScan} disabled={scanning} className="atlas-panel-link">
            {scanning ? "Running" : "Rerun"}
          </button>
        </div>
        <div className="space-y-2">
          {result.falsePositiveReviews.slice(0, 5).map((review) => (
            <button type="button" key={review.issueId} onClick={() => onInspectIssue(review.issueId)} className={`atlas-ai-review atlas-ai-${review.verdict}`}>
              <span className="min-w-0">
                <span className="line-clamp-2 text-sm font-medium">{review.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{review.verdict.replace(/-/g, " ")} · {Math.round(review.confidence * 100)}%</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="atlas-inspector-section">
        <h4>Generated Skills</h4>
        <div className="space-y-2">
          {result.generatedSkills.slice(0, 4).map((skill) => (
            <button type="button" key={skill.id} onClick={() => onCopy(skill.prompt)} className="atlas-ai-artifact">
              <span className="font-medium">{skill.name}</span>
              <span>{skill.appliesTo}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="atlas-inspector-section">
        <h4>Docs and Guidelines</h4>
        <div className="space-y-2">
          {result.docs.slice(0, 3).map((doc) => (
            <button type="button" key={doc.title} onClick={() => onCopy(doc.markdown)} className="atlas-ai-artifact">
              <span className="font-medium">{doc.title}</span>
              <span>Copy markdown</span>
            </button>
          ))}
          {result.guidelines.slice(0, 3).map((guideline) => (
            <div key={guideline.title} className="atlas-warning-pattern">
              <p className="text-sm font-medium">{guideline.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{guideline.rule}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="atlas-inspector-section">
        <h4>Auth Path</h4>
        <div className="space-y-2">
          {result.auth.map((group) => (
            <div key={group.title} className="atlas-warning-pattern">
              <p className="text-sm font-medium">{group.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{group.items[0]}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CodexAuthCard({ session, login }: { session: CodexSession | null; login: CodexLogin | null }) {
  const account = session?.account;

  if (account?.type === "chatgpt") {
    return (
      <div className="atlas-inspector-section">
        <h4>Codex Account</h4>
        <p className="mt-2 text-sm font-medium">{account.email}</p>
        <p className="mt-1 text-xs text-muted-foreground">ChatGPT {account.planType} plan</p>
      </div>
    );
  }

  if (login?.type === "chatgpt") {
    return (
      <div className="atlas-inspector-section">
        <h4>Codex Login</h4>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Browser login started by Codex.</p>
        <a className="atlas-panel-link mt-3" href={login.authUrl} target="_blank" rel="noreferrer">
          Open Login
        </a>
      </div>
    );
  }

  if (login?.type === "chatgptDeviceCode") {
    return (
      <div className="atlas-inspector-section">
        <h4>Codex Device Login</h4>
        <p className="mt-2 text-sm font-medium">{login.userCode}</p>
        <a className="atlas-panel-link mt-3" href={login.verificationUrl} target="_blank" rel="noreferrer">
          Open Device Login
        </a>
      </div>
    );
  }

  return (
    <div className="atlas-inspector-section">
      <h4>Codex Account</h4>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">No Codex account is connected yet.</p>
    </div>
  );
}

function AiReviewWorkbench({
  result,
  onInspectIssue,
  onCopy,
}: {
  result: AiScanResult;
  onInspectIssue: (issueId: string) => void;
  onCopy: (value: string) => void;
}) {
  const likelyReal = result.falsePositiveReviews.filter((review) => review.verdict === "likely-real").length;
  const needsReview = result.falsePositiveReviews.filter((review) => review.verdict === "needs-human-review").length;
  const likelyFalse = result.falsePositiveReviews.filter((review) => review.verdict === "likely-false-positive").length;
  const primaryVisualization = result.visualizations[0];

  return (
    <section className="atlas-ai-workbench">
      <div className="atlas-deslopify-head">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold">AI Quality Control</h2>
          </div>
          <p className="text-sm text-muted-foreground">{result.summary}</p>
        </div>
        <button type="button" onClick={() => onCopy(aiReviewBundle(result))} className="atlas-button-secondary">
          <Copy className="h-4 w-4" aria-hidden="true" />
          Copy AI Packet
        </button>
      </div>

      <div className="atlas-ai-grid">
        <div className="atlas-deslopify-panel">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">False Positive Gate</h3>
              <p className="text-xs text-muted-foreground">AI-reviewed signal quality before cleanup.</p>
            </div>
            <span className="atlas-registry-badge">{Math.round(result.confidenceScore)}%</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MiniMetric label="Real" value={likelyReal} />
            <MiniMetric label="Review" value={needsReview} />
            <MiniMetric label="False" value={likelyFalse} />
          </div>
          <div className="mt-4 space-y-2">
            {result.falsePositiveReviews.slice(0, 6).map((review) => (
              <button type="button" key={review.issueId} onClick={() => onInspectIssue(review.issueId)} className={`atlas-ai-review atlas-ai-${review.verdict}`}>
                <span className="min-w-0">
                  <span className="line-clamp-1 text-sm font-medium">{review.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{review.reasoning}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="atlas-deslopify-panel">
          <h3 className="text-sm font-semibold">Architecture Moves</h3>
          <p className="mt-1 text-xs text-muted-foreground">Smallest safe moves from the evidence.</p>
          <div className="mt-4 space-y-3">
            {result.architectureMoves.map((move) => (
              <div key={move.title} className="atlas-ai-move">
                <p className="text-sm font-semibold">{move.title}</p>
                <p className="mt-2 text-xs text-muted-foreground">{move.why}</p>
                <p className="mt-2 text-xs font-medium">First: {move.firstStep}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="atlas-deslopify-panel">
          <h3 className="text-sm font-semibold">Generated Skills</h3>
          <p className="mt-1 text-xs text-muted-foreground">Reusable prompts for Codex and cleanup agents.</p>
          <div className="mt-4 space-y-2">
            {result.generatedSkills.map((skill) => (
              <button type="button" key={skill.id} onClick={() => onCopy(skill.prompt)} className="atlas-ai-artifact">
                <span className="font-medium">{skill.name}</span>
                <span>{skill.acceptanceChecks.length} checks</span>
              </button>
            ))}
          </div>
        </div>

        <div className="atlas-deslopify-panel xl:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">{primaryVisualization?.title ?? "AI Review Loop"}</h3>
              <p className="text-xs text-muted-foreground">{primaryVisualization?.use ?? "Run an AI scan to generate the visual review loop."}</p>
            </div>
          </div>
          {primaryVisualization ? <MermaidPreview chart={primaryVisualization.mermaid} /> : <EmptyState title="No AI chart yet" copy="Run an AI scan to create a review visualization." />}
        </div>

        <div className="atlas-deslopify-panel">
          <h3 className="text-sm font-semibold">Docs and Guidelines</h3>
          <p className="mt-1 text-xs text-muted-foreground">Generated operating material for the project.</p>
          <div className="mt-4 space-y-2">
            {result.docs.map((doc) => (
              <button type="button" key={doc.title} onClick={() => onCopy(doc.markdown)} className="atlas-ai-artifact">
                <span className="font-medium">{doc.title}</span>
                <span>Markdown</span>
              </button>
            ))}
            {result.guidelines.map((guideline) => (
              <div key={guideline.title} className="atlas-warning-pattern">
                <p className="text-sm font-medium">{guideline.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{guideline.rule}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function NodeInspectorPanel({
  node,
  issues,
  slice,
  onInspectIssue,
}: {
  node: GraphNode | null;
  issues: IssueSignal[];
  slice: GraphSlice | null;
  onInspectIssue: (issueId: string) => void;
}) {
  const model = useNodeInspectorModel(node, issues, slice);

  if (!node || !model) {
    return <EmptyNodeInspectorPanel slice={slice} />;
  }

  return <SelectedNodeInspectorPanel model={model} onInspectIssue={onInspectIssue} />;
}

type NodeInspectorModel = {
  node: GraphNode;
  incoming: GraphEdge[];
  outgoing: GraphEdge[];
  nodeLookup: Map<string, GraphNode>;
  metadataRows: Array<[string, GraphNode["metadata"][string]]>;
  runtimeRows: { label: string; value: string }[];
  issues: IssueSignal[];
};

function useNodeInspectorModel(node: GraphNode | null, issues: IssueSignal[], slice: GraphSlice | null): NodeInspectorModel | null {
  const incoming = node && slice ? slice.edges.filter((edge) => edge.target === node.id) : [];
  const outgoing = node && slice ? slice.edges.filter((edge) => edge.source === node.id) : [];
  const nodeLookup = useMemo(() => new Map((slice?.nodes ?? []).map((item) => [item.id, item])), [slice]);
  const metadataRows = node ? Object.entries(node.metadata).slice(0, 8) : [];
  const runtimeRows = node?.kind === "runtime" ? runtimeDetailRows(node) : [];

  if (!node) {
    return null;
  }

  return { node, incoming, outgoing, nodeLookup, metadataRows, runtimeRows, issues };
}

function EmptyNodeInspectorPanel({ slice }: { slice: GraphSlice | null }) {
  return (
    <div className="atlas-panel-stack">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Inspector</p>
        <h3 className="mt-2 text-lg font-semibold">Select a node</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Drag nodes to reorganize the canvas. Select any node to inspect its file, connections, metadata, and related issue signals.</p>
      </div>
      <div className="atlas-inspector-grid">
        <MiniMetric label="Nodes" value={slice?.nodes.length ?? 0} />
        <MiniMetric label="Edges" value={slice?.edges.length ?? 0} />
        <MiniMetric label="Signals" value={slice?.issues.length ?? 0} />
      </div>
    </div>
  );
}

function SelectedNodeInspectorPanel({
  model,
  onInspectIssue,
}: {
  model: NodeInspectorModel;
  onInspectIssue: (issueId: string) => void;
}) {
  return (
    <div className="atlas-panel-stack">
      <SelectedNodeHeader node={model.node} />
      <NodeLocationSection node={model.node} />
      <div className="grid grid-cols-2 gap-2">
        <MiniMetric label="Incoming" value={model.incoming.length} />
        <MiniMetric label="Outgoing" value={model.outgoing.length} />
      </div>
      <NodeConnectionsSection model={model} />
      <NodeSignalsSection issues={model.issues} onInspectIssue={onInspectIssue} />
      <RuntimeRowsSection rows={model.runtimeRows} />
      <MetadataRowsSection rows={model.metadataRows} />
    </div>
  );
}

function SelectedNodeHeader({ node }: { node: GraphNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Selected Node</p>
      <h3 className="break-words text-lg font-semibold">{node.label}</h3>
      <span className="atlas-node-kind">{node.kind}</span>
    </div>
  );
}

function NodeLocationSection({ node }: { node: GraphNode }) {
  return (
    <div className="atlas-inspector-section">
      <h4>Location</h4>
      <p>{node.filePath ?? "Graph-level node"}</p>
      {node.featureId ? <p>Feature: {node.featureId}</p> : null}
    </div>
  );
}

function NodeConnectionsSection({ model }: { model: NodeInspectorModel }) {
  const edges = [...model.incoming, ...model.outgoing].slice(0, 8);

  return (
      <div className="atlas-inspector-section">
        <h4>Connections</h4>
        <div className="space-y-2">
        {edges.map((edge) => (
            <div key={edge.id} className="atlas-connection-row">
              <span>{edge.kind}</span>
            <span className="truncate">{connectionLabel(edge, model.node.id, model.nodeLookup)}</span>
              <span className={`atlas-edge-health atlas-edge-health-${edgeHealth(edge)}`}>{edgeHealth(edge)}</span>
            </div>
          ))}
        {edges.length === 0 ? <p>No direct edges in this slice.</p> : null}
        </div>
      </div>
  );
}

function NodeSignalsSection({
  issues,
  onInspectIssue,
}: {
  issues: IssueSignal[];
  onInspectIssue: (issueId: string) => void;
}) {
  return (
      <div className="atlas-inspector-section">
        <h4>Signals</h4>
        <div className="space-y-2">
          {issues.map((issue) => (
            <button type="button" key={issue.id} onClick={() => onInspectIssue(issue.id)} className="atlas-inspector-issue">
              <span className="font-medium">{issue.title}</span>
              <span>{Math.round(issue.confidence * 100)}% {issue.severity}</span>
            </button>
          ))}
          {issues.length === 0 ? <p>No issue signals attached to this node.</p> : null}
        </div>
      </div>
  );
}

function RuntimeRowsSection({ rows }: { rows: { label: string; value: string }[] }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="atlas-inspector-section">
      <h4>Runtime Contract</h4>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="atlas-metadata-row">
            <span>{row.label}</span>
            <span>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetadataRowsSection({ rows }: { rows: Array<[string, GraphNode["metadata"][string]]> }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="atlas-inspector-section">
      <h4>Metadata</h4>
      <div className="space-y-2">
        {rows.map(([key, value]) => (
          <div key={key} className="atlas-metadata-row">
            <span>{key}</span>
            <span>{metadataValueLabel(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function metadataValueLabel(value: GraphNode["metadata"][string]): string {
  if (Array.isArray(value)) {
    return `${value.length} items`;
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function connectionLabel(edge: GraphEdge, selectedNodeId: string, nodeLookup: Map<string, GraphNode>): string {
  const connectedId = edge.source === selectedNodeId ? edge.target : edge.source;
  const connectedNode = nodeLookup.get(connectedId);
  return connectedNode ? `${connectedNode.kind}: ${connectedNode.label}` : connectedId;
}

function runtimeDetailRows(node: GraphNode): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  addMetadataRow(rows, "kind", node.metadata.runtimeKind);
  addMetadataRow(rows, "workspace", node.metadata.workspaceKey);
  addMetadataRow(rows, "port", node.metadata.port);
  addMetadataRow(rows, "source", node.metadata.source);
  addMetadataRow(rows, "script", node.metadata.script);
  addMetadataRow(rows, "command", node.metadata.command);
  addMetadataRow(rows, "line", node.metadata.line);
  return rows;
}

function addMetadataRow(rows: { label: string; value: string }[], label: string, value: GraphNode["metadata"][string]) {
  if (value === undefined || value === null) {
    return;
  }

  rows.push({ label, value: Array.isArray(value) ? value.map((item) => String(item)).join(", ") : String(value) });
}

function DeslopifyWorkbench({
  slice,
  guide,
  onInspectIssue,
  onOpenSlop,
  onOpenView,
  onBuildPacket,
}: {
  slice: GraphSlice;
  guide: DebugGuide;
  onInspectIssue: (issueId: string) => void;
  onOpenSlop: () => void;
  onOpenView: (kind: GraphSliceKind) => void;
  onBuildPacket: () => void;
}) {
  const heatmap = buildFileHeatmap(slice.issues);
  const patterns = buildPatternRows(slice.issues);
  const queue = buildFixQueue(slice.issues);
  const nodeRows = buildNodeKindRows(slice.nodes);
  const edgeRows = buildEdgeKindRows(slice.edges);
  const story = buildCodebaseStory(slice, guide);
  const learningPath = buildLearningPath(slice, guide);
  const learningProgress = learningPath.length === 0 ? 0 : Math.round((learningPath.filter((step) => step.status === "complete").length / learningPath.length) * 100);
  const activeLanes = guide.lanes
    .filter((lane) => lane.count > 0)
    .sort((left, right) => severityRankForIssue(right.severity) - severityRankForIssue(left.severity) || right.count - left.count);
  const highestRisk = heatmap[0]?.risk ?? 0;

  return (
    <section className="atlas-deslopify">
      <div className="atlas-deslopify-head">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold">Deslopify Workbench</h2>
          </div>
          <p className="text-sm text-muted-foreground">Risk heatmaps, issue patterns, evidence trails, and a cleanup queue from the current slice.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={onOpenSlop} className="atlas-button-secondary">
            <MapIcon className="h-4 w-4" aria-hidden="true" />
            Slop Map
          </button>
          <button type="button" onClick={onBuildPacket} className="atlas-button-primary">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Packet
          </button>
        </div>
      </div>

      <div className="atlas-story-grid">
        <div className="atlas-deslopify-panel xl:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Codebase Story</h3>
              <p className="text-xs text-muted-foreground">A readable path from entrypoints to cleanup pressure.</p>
            </div>
            <span className="atlas-registry-badge">{story.length} chapters</span>
          </div>
          <div className="atlas-storyline">
            {story.map((chapter, index) => (
              <button
                type="button"
                key={chapter.id}
                onClick={() => onOpenView(chapter.view)}
                className={`atlas-story-chapter atlas-story-${chapter.status}`}
              >
                <span className="atlas-story-index">{index + 1}</span>
                <span className="min-w-0">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-semibold">{chapter.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{chapter.metric}</span>
                  </span>
                  <span className="mt-1 block text-xs font-medium text-muted-foreground">{chapter.subtitle}</span>
                  <span className="mt-2 block text-xs leading-5 text-muted-foreground">{chapter.body}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="atlas-deslopify-panel">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Learning Path</h3>
              <p className="text-xs text-muted-foreground">Updates as cleanup reduces signals.</p>
            </div>
            <span className="atlas-registry-badge">{learningProgress}%</span>
          </div>
          <div className="atlas-learning-meter" aria-label={`Learning path ${learningProgress}% complete`}>
            <span style={{ width: `${learningProgress}%` }} />
          </div>
          <div className="mt-4 space-y-2">
            {learningPath.map((step) => (
              <button
                type="button"
                key={step.id}
                onClick={() => onOpenView(step.view)}
                className={`atlas-learning-step atlas-learning-${step.status}`}
              >
                <span className="atlas-learning-dot" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-semibold">{step.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{step.metric}</span>
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{step.body}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="atlas-deslopify-grid">
        <div className="atlas-deslopify-panel xl:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">File Risk Heatmap</h3>
              <p className="text-xs text-muted-foreground">Darker cells point to concentrated cleanup evidence.</p>
            </div>
            <span className="atlas-registry-badge">{heatmap.length} files</span>
          </div>
          {heatmap.length > 0 ? (
            <div className="atlas-heatmap-grid">
              {heatmap.map((file) => (
                <button
                  type="button"
                  key={file.filePath}
                  onClick={() => onInspectIssue(file.issueIds[0])}
                  className={`atlas-heatmap-cell atlas-risk-${file.severity}`}
                  style={{ opacity: heatmapOpacity(file.risk, highestRisk) }}
                >
                  <span className="truncate text-sm font-semibold">{file.label}</span>
                  <span className="mt-3 flex items-center justify-between gap-3 text-xs">
                    <span>{file.count} signals</span>
                    <span>{Math.round(file.confidence * 100)}%</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="No file-level heat yet" copy="Scan or switch to a denser graph slice to surface cleanup hotspots." />
          )}
        </div>

        <div className="atlas-deslopify-panel">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">Pattern Matrix</h3>
            <p className="text-xs text-muted-foreground">Issue families grouped by static signal.</p>
          </div>
          {patterns.length > 0 ? (
            <div className="space-y-3">
              {patterns.map((pattern) => (
                <div key={pattern.kind} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">{pattern.label}</span>
                    <span className="text-xs text-muted-foreground">{pattern.count}</span>
                  </div>
                  <div className="atlas-matrix-bar">
                    <span className="bg-critical" style={{ width: `${pattern.criticalPercent}%` }} />
                    <span className="bg-warning" style={{ width: `${pattern.warningPercent}%` }} />
                    <span className="bg-primary" style={{ width: `${pattern.infoPercent}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">{Math.round(pattern.confidence * 100)}% average confidence</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No active patterns" copy="The current slice has no static slop signals." />
          )}
        </div>

        <div className="atlas-deslopify-panel">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">Architecture Pressure</h3>
            <p className="text-xs text-muted-foreground">Node and edge volume that can hide drift.</p>
          </div>
          <div className="space-y-4">
            <PressureList title="Nodes" rows={nodeRows} />
            <PressureList title="Edges" rows={edgeRows} />
          </div>
        </div>

        <div className="atlas-deslopify-panel xl:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Evidence Trails</h3>
              <p className="text-xs text-muted-foreground">Symptom to files to smallest useful repair.</p>
            </div>
            <span className="atlas-registry-badge">{queue.length} ranked</span>
          </div>
          {queue.length > 0 ? (
            <div className="space-y-3">
              {queue.slice(0, 5).map((issue, index) => (
                <div key={issue.id} className="atlas-evidence-trail">
                  <button type="button" onClick={() => onInspectIssue(issue.id)} className="atlas-evidence-rank">
                    {index + 1}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                      <p className="truncate text-sm font-semibold">{issue.title}</p>
                      <IssueConfidenceBadge issue={issue} />
                    </div>
                    <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div className="atlas-evidence-box">
                        <span className="text-muted-foreground">Evidence</span>
                        <p className="mt-1 truncate">{issue.filePaths.slice(0, 3).join(", ") || "Graph-level signal"}</p>
                      </div>
                      <div className="atlas-evidence-box">
                        <span className="text-muted-foreground">Repair</span>
                        <p className="mt-1">{repairForIssue(issue.kind)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No queue yet" copy="The workbench will rank cleanup evidence after the scan finds signals." />
          )}
        </div>

        <div className="atlas-deslopify-panel">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">Cleanup Lanes</h3>
            <p className="text-xs text-muted-foreground">Best order for visual debugging.</p>
          </div>
          {activeLanes.length > 0 ? (
            <div className="space-y-2">
              {activeLanes.map((lane) => (
                <div key={lane.id} className="rounded-md border border-border bg-panel p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold">{lane.label}</p>
                    <SeverityBadge severity={lane.severity} count={lane.count} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{lane.repair}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No active lanes" copy="Use the graph to confirm the architecture shape before editing." />
          )}
        </div>
      </div>
    </section>
  );
}

function PressureList({ title, rows }: { title: string; rows: { label: string; count: number; percent: number }[] }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-muted-foreground">{title}</span>
        <span className="text-muted-foreground">{rows.reduce((total, row) => total + row.count, 0)}</span>
      </div>
      <div className="space-y-2">
        {rows.slice(0, 6).map((row) => (
          <div key={`${title}:${row.label}`} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span>{row.label}</span>
              <span className="text-muted-foreground">{row.count}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${row.percent}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type FileHeatmapCell = {
  filePath: string;
  label: string;
  count: number;
  confidence: number;
  risk: number;
  severity: IssueSeverity;
  issueIds: string[];
};

type PatternRow = {
  kind: IssueKind;
  label: string;
  count: number;
  confidence: number;
  criticalPercent: number;
  warningPercent: number;
  infoPercent: number;
};

type CodebaseStoryChapter = {
  id: string;
  title: string;
  subtitle: string;
  body: string;
  metric: string;
  status: "stable" | "watch" | "risk";
  view: GraphSliceKind;
};

type LearningPathStep = {
  id: string;
  title: string;
  body: string;
  metric: string;
  status: "complete" | "current" | "queued";
  view: GraphSliceKind;
};

type HeatmapGroup = {
  risk: number;
  count: number;
  confidence: number;
  severity: IssueSeverity;
  issueIds: string[];
};

function buildCodebaseStory(slice: GraphSlice, guide: DebugGuide): CodebaseStoryChapter[] {
  const routeLane = laneById(guide, "routes");
  const architectureLane = laneById(guide, "architecture");
  const asyncLane = laneById(guide, "async");
  const contractLane = laneById(guide, "contracts");
  const runtimeLane = laneById(guide, "runtime");
  const topFeature = firstNodeLabel(slice.nodes, "feature");
  const topRoute = firstNodeLabel(slice.nodes, "route");

  return [
    {
      id: "entrypoints",
      title: "The app enters through routes",
      subtitle: topRoute ? `Start at ${topRoute}` : "No route node is dominant yet",
      body: routeLane.count > 0 ? "The story starts with route uncertainty. Trace the visible route edges before changing behavior." : "Routes are mapped cleanly enough to read the first user journey.",
      metric: `${slice.summary.routeCount} routes`,
      status: routeLane.count > 0 ? "risk" : "stable",
      view: "route",
    },
    {
      id: "ownership",
      title: "Features own the plot",
      subtitle: topFeature ? `${topFeature} is a visible feature anchor` : "Feature ownership is still emerging",
      body: architectureLane.count > 0 ? "Ownership has pressure. Look for fan-out, boundary leaks, or oversized files before extracting abstractions." : "Feature boundaries are readable, so local improvements are less likely to ripple.",
      metric: `${slice.summary.featureCount} features`,
      status: architectureLane.count > 0 ? "watch" : "stable",
      view: "feature",
    },
    {
      id: "dependency-thread",
      title: "Dependencies reveal the hidden subplot",
      subtitle: `${slice.summary.edgeCount} edges carry the architecture`,
      body: architectureLane.severity === "critical" ? "The dependency graph is carrying critical pressure. Stabilize imports before adding new feature paths." : "Use dependency neighborhoods to spot coupling before it becomes a debugging surprise.",
      metric: `${slice.edges.length} visible`,
      status: architectureLane.severity === "critical" ? "risk" : architectureLane.count > 0 ? "watch" : "stable",
      view: "dependencies",
    },
    {
      id: "runtime-tension",
      title: "Runtime tells the truth",
      subtitle: `${asyncLane.count + contractLane.count + runtimeLane.count} timing, startup, and contract signals`,
      body: asyncLane.count + contractLane.count + runtimeLane.count > 0 ? "Startup, state timing, or data contracts need attention. These are the places where generated code often looks fine until the app is actually run." : "Startup, async ownership, and contracts are quiet in this slice.",
      metric: `${guide.score}/100`,
      status: asyncLane.count + contractLane.count + runtimeLane.count > 0 ? "watch" : "stable",
      view: "runtime",
    },
    {
      id: "cleanup-arc",
      title: "Cleanup changes the ending",
      subtitle: guide.headline,
      body: slice.issues.length > 0 ? "Fix the highest evidence trail, rescan, and the story should compress into fewer active lanes." : "The current story is clean. Preserve it with small edits and verification.",
      metric: `${slice.issues.length} signals`,
      status: slice.issues.length > 4 ? "risk" : slice.issues.length > 0 ? "watch" : "stable",
      view: "slop",
    },
  ];
}

function buildLearningPath(slice: GraphSlice, guide: DebugGuide): LearningPathStep[] {
  const rawSteps = [
    learningSeed("map", "Map the terrain", "Read the main surfaces, routes, and features before editing.", `${slice.summary.fileCount} files`, slice.summary.fileCount > 0, "overview"),
    learningSeed("routes", "Follow one route end to end", "Open the route trace and confirm page, handler, data, and dependency flow.", `${laneById(guide, "routes").count} route risks`, laneById(guide, "routes").count === 0, "route"),
    learningSeed("ownership", "Find feature ownership", "Check whether work belongs to a feature, shared surface, or boundary adapter.", `${laneById(guide, "architecture").count} drift`, laneById(guide, "architecture").count === 0, "feature"),
    learningSeed("runtime", "Prove startup", "Align ports, env contracts, scripts, and source listeners before debugging UI behavior.", `${laneById(guide, "runtime").count} startup`, laneById(guide, "runtime").count === 0, "runtime"),
    learningSeed("async", "Stabilize timing", "Review effects, parallel async work, and stale closure risks before trusting UI state.", `${laneById(guide, "async").count} async`, laneById(guide, "async").count === 0, "issues"),
    learningSeed("contracts", "Strengthen contracts", "Remove weak types, swallowed errors, and hidden defaults from the story path.", `${laneById(guide, "contracts").count} contract`, laneById(guide, "contracts").count === 0, "slop"),
    learningSeed("polish", "Remove generated residue", "Clean placeholders, debug traces, copy drift, and duplicate logic after behavior is safe.", `${laneById(guide, "polish").count + laneById(guide, "duplication").count} residue`, laneById(guide, "polish").count + laneById(guide, "duplication").count === 0, "duplicates"),
    learningSeed("verify", "Rescan and compare", "The path is complete when the score rises and active lanes shrink.", `${guide.score}/100`, guide.score >= 85 && slice.issues.length <= 2, "overview"),
  ];
  const currentIndex = rawSteps.findIndex((step) => !step.complete);

  return rawSteps.map((step, index) => ({
    id: step.id,
    title: step.title,
    body: step.body,
    metric: step.metric,
    view: step.view,
    status: step.complete ? "complete" : index === currentIndex ? "current" : "queued",
  }));
}

function learningSeed(
  id: string,
  title: string,
  body: string,
  metric: string,
  complete: boolean,
  view: GraphSliceKind,
): { id: string; title: string; body: string; metric: string; complete: boolean; view: GraphSliceKind } {
  return { id, title, body, metric, complete, view };
}

function laneById(guide: DebugGuide, id: string): DebugGuide["lanes"][number] {
  return guide.lanes.find((lane) => lane.id === id) ?? {
    id,
    label: id,
    description: "",
    repair: "",
    severity: "info",
    issueIds: [],
    count: 0,
  };
}

function firstNodeLabel(nodes: GraphNode[], kind: GraphNodeKind): string | null {
  return nodes.find((node) => node.kind === kind)?.label ?? null;
}

function buildFileHeatmap(issues: IssueSignal[]): FileHeatmapCell[] {
  const grouped = new Map<string, HeatmapGroup>();

  for (const issue of issues) {
    const paths = issue.filePaths.length > 0 ? issue.filePaths : ["Graph-level signal"];
    for (const filePath of paths) {
      const current = grouped.get(filePath) ?? emptyHeatmapGroup();
      grouped.set(filePath, {
        risk: current.risk + issueRisk(issue),
        count: current.count + 1,
        confidence: current.confidence + issue.confidence,
        severity: higherSeverity(current.severity, issue.severity),
        issueIds: [...current.issueIds, issue.id],
      });
    }
  }

  return [...grouped.entries()]
    .map(([filePath, value]) => ({
      filePath,
      label: fileHeatmapLabel(filePath),
      count: value.count,
      confidence: value.confidence / value.count,
      risk: value.risk,
      severity: value.severity,
      issueIds: value.issueIds,
    }))
    .sort((left, right) => right.risk - left.risk || right.count - left.count)
    .slice(0, 18);
}

function emptyHeatmapGroup(): HeatmapGroup {
  return { risk: 0, count: 0, confidence: 0, severity: "info", issueIds: [] };
}

function buildPatternRows(issues: IssueSignal[]): PatternRow[] {
  const grouped = new Map<IssueKind, { count: number; confidence: number; critical: number; warning: number; info: number }>();
  for (const issue of issues) {
    const current = grouped.get(issue.kind) ?? { count: 0, confidence: 0, critical: 0, warning: 0, info: 0 };
    grouped.set(issue.kind, {
      count: current.count + 1,
      confidence: current.confidence + issue.confidence,
      critical: current.critical + (issue.severity === "critical" ? 1 : 0),
      warning: current.warning + (issue.severity === "warning" ? 1 : 0),
      info: current.info + (issue.severity === "info" ? 1 : 0),
    });
  }

  return [...grouped.entries()]
    .map(([kind, value]) => ({
      kind,
      label: issueKindLabel(kind),
      count: value.count,
      confidence: value.confidence / value.count,
      criticalPercent: (value.critical / value.count) * 100,
      warningPercent: (value.warning / value.count) * 100,
      infoPercent: (value.info / value.count) * 100,
    }))
    .sort((left, right) => right.count - left.count || right.confidence - left.confidence);
}

function buildFixQueue(issues: IssueSignal[]): IssueSignal[] {
  return [...issues].sort((left, right) => issueRisk(right) - issueRisk(left));
}

function buildNodeKindRows(nodes: GraphNode[]): { label: string; count: number; percent: number }[] {
  const grouped = new Map<GraphNodeKind, number>();
  for (const node of nodes) {
    grouped.set(node.kind, (grouped.get(node.kind) ?? 0) + 1);
  }

  return rowsFromCounts(grouped);
}

function buildEdgeKindRows(edges: GraphSlice["edges"]): { label: string; count: number; percent: number }[] {
  const grouped = new Map<string, number>();
  for (const edge of edges) {
    grouped.set(edge.kind, (grouped.get(edge.kind) ?? 0) + 1);
  }

  return rowsFromCounts(grouped);
}

function rowsFromCounts<T extends string>(counts: Map<T, number>): { label: string; count: number; percent: number }[] {
  const max = Math.max(1, ...counts.values());
  return [...counts.entries()]
    .map(([label, count]) => ({
      label: label.replace(/-/g, " "),
      count,
      percent: Math.max(8, (count / max) * 100),
    }))
    .sort((left, right) => right.count - left.count);
}

function issueRisk(issue: IssueSignal): number {
  return severityWeight(issue.severity) * (0.65 + issue.confidence) + Math.min(20, issue.filePaths.length * 3);
}

function severityWeight(severity: IssueSeverity): number {
  if (severity === "critical") {
    return 100;
  }
  if (severity === "warning") {
    return 62;
  }

  return 28;
}

function severityRankForIssue(severity: IssueSeverity): number {
  if (severity === "critical") {
    return 3;
  }
  if (severity === "warning") {
    return 2;
  }

  return 1;
}

function higherSeverity(left: IssueSeverity, right: IssueSeverity): IssueSeverity {
  return severityRankForIssue(right) > severityRankForIssue(left) ? right : left;
}

function heatmapOpacity(risk: number, maxRisk: number): number {
  if (maxRisk <= 0) {
    return 1;
  }

  return Math.max(0.64, Math.min(1, 0.64 + (risk / maxRisk) * 0.36));
}

function fileHeatmapLabel(filePath: string): string {
  if (filePath === "Graph-level signal") {
    return filePath;
  }

  const parts = filePath.split("/").filter(Boolean);
  return parts.slice(-3).join("/");
}

function issueKindLabel(kind: IssueKind): string {
  return kind
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function repairForIssue(kind: IssueKind): string {
  if (kind === "duplicate-logic") {
    return "Compare intent, then extract the shared domain rule.";
  }
  if (kind === "dependency-cycle" || kind === "boundary-leak" || kind === "high-divergence") {
    return "Move decisions inward and make ownership explicit.";
  }
  if (kind === "missing-route-handler" || kind === "route-dead-end" || kind === "unresolved-import") {
    return "Trace the route start to finish and close the missing edge.";
  }
  if (kind === "suspicious-async-effect" || kind === "stale-closure-risk" || kind === "unguarded-parallel-async" || kind === "timer-without-cleanup") {
    return "Give async work one owner with cancellation and visible states.";
  }
  if (kind === "port-mismatch" || kind === "startup-problem" || kind === "env-contract-risk") {
    return "Align startup scripts, ports, env contracts, and health checks.";
  }
  if (kind === "weak-typing" || kind === "silent-fallback" || kind === "swallowed-error") {
    return "Validate at the boundary and remove hidden success paths.";
  }
  if (kind === "oversized-file") {
    return "Split by responsibility around the highest-change path.";
  }

  return "Replace generated residue with finished behavior or remove it.";
}

function aiModeLabel(result: AiScanResult): string {
  return result.mode === "ai-reviewed" ? "AI reviewed" : "Setup ready";
}

function codexAccountLabel(session: CodexSession | null): string {
  if (session?.account?.type === "chatgpt") {
    return `Codex ${session.account.planType}`;
  }

  return "Codex connected";
}

async function pollCodexSession(refresh: () => Promise<CodexSession | null>) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(1500);
    const session = await refresh();
    if (session?.connected) {
      return;
    }
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function aiReviewBundle(result: AiScanResult): string {
  return [
    `# AI Quality Control: ${aiModeLabel(result)}`,
    "",
    `Model: ${result.model}`,
    `Generated: ${result.generatedAt}`,
    `Confidence: ${Math.round(result.confidenceScore)}%`,
    "",
    "## Summary",
    result.summary,
    "",
    "## False Positive Review",
    result.falsePositiveReviews.map((review) => `- ${review.title}: ${review.verdict} (${Math.round(review.confidence * 100)}%). ${review.reasoning} Next: ${review.nextEvidence}`).join("\n"),
    "",
    "## Architecture Moves",
    result.architectureMoves.map((move) => `- ${move.title}: ${move.firstStep}`).join("\n"),
    "",
    "## Generated Skills",
    result.generatedSkills.map((skill) => `### ${skill.name}\nApplies to: ${skill.appliesTo}\n${skill.prompt}\nChecks:\n${skill.acceptanceChecks.map((check) => `- ${check}`).join("\n")}`).join("\n\n"),
    "",
    "## Guidelines",
    result.guidelines.map((guideline) => `- ${guideline.title}: ${guideline.rule}`).join("\n"),
    "",
    "## Docs",
    result.docs.map((doc) => `### ${doc.title}\n${doc.markdown}`).join("\n\n"),
  ].join("\n");
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-background p-4 text-sm">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-muted-foreground">{copy}</p>
    </div>
  );
}

function DebugGuidePanel({ guide, onCopy }: { guide: DebugGuide; onCopy: () => void }) {
  const activeLanes = guide.lanes.filter((lane) => lane.count > 0);

  return (
    <section className="rounded-lg border border-border bg-panel p-4">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold">Visual Debug Guide</h2>
          </div>
          <p className="text-sm text-muted-foreground">{guide.headline}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-md border border-border bg-background px-3 py-2">
            <div className="text-xs text-muted-foreground">Architecture score</div>
            <div className="text-xl font-semibold tabular-nums">{guide.score}/100</div>
          </div>
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy flow
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-background p-3">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold">Slop Radar</h3>
            </div>
            <div className="space-y-3">
              {guide.lanes.map((lane) => (
                <div key={lane.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">{lane.label}</span>
                    <SeverityBadge severity={lane.severity} count={lane.count} />
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className={barClassForSeverity(lane.severity)} style={{ width: `${Math.min(100, lane.count * 18)}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">{lane.repair}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-border bg-background p-3">
            <div className="mb-3 flex items-center gap-2">
              <Wrench className="h-4 w-4 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold">Guided Debug Path</h3>
            </div>
            <div className="space-y-2">
              {guide.steps.map((step) => (
                <div key={step.id} className="rounded-md border border-border bg-panel p-3 text-sm">
                  <p className="font-medium">{step.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{step.why}</p>
                  <p className="mt-2 text-xs font-medium">Next: {step.nextAction}</p>
                  {step.files.length > 0 ? (
                    <p className="mt-2 truncate text-xs text-muted-foreground">Files: {step.files.join(", ")}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-md border border-border bg-background p-3">
            <div className="mb-3 flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold">Architecture Repairs</h3>
            </div>
            <div className="space-y-2">
              {guide.recommendations.map((recommendation) => (
                <ArchitectureRepair key={recommendation.id} recommendation={recommendation} />
              ))}
            </div>
          </div>

          <div className="rounded-md border border-border bg-background p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Debug Flow</h3>
              <span className="text-xs text-muted-foreground">{activeLanes.length} active lanes</span>
            </div>
            <MermaidPreview chart={guide.mermaid} />
          </div>
        </div>
      </div>
    </section>
  );
}

function SeverityBadge({ severity, count }: { severity: DebugGuide["lanes"][number]["severity"]; count: number }) {
  return (
    <span className={`rounded-md border px-2 py-1 text-xs ${badgeClassForSeverity(severity)}`}>
      {count} {severity}
    </span>
  );
}

function IssueConfidenceBadge({ issue }: { issue: IssueSignal }) {
  return (
    <span className={`shrink-0 rounded-md border px-2 py-1 text-xs ${badgeClassForSeverity(issue.severity)}`}>
      {Math.round(issue.confidence * 100)}% {issue.severity}
    </span>
  );
}

function ArchitectureRepair({ recommendation }: { recommendation: DebugGuide["recommendations"][number] }) {
  return (
    <div className="rounded-md border border-border bg-panel p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{recommendation.title}</p>
        <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
          {Math.round(recommendation.confidence * 100)}%
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{recommendation.rationale}</p>
      <div className="mt-3 grid gap-2 text-xs">
        <div className="rounded-md border border-border bg-background p-2">
          <span className="text-muted-foreground">From: </span>
          {recommendation.from}
        </div>
        <div className="rounded-md border border-border bg-background p-2">
          <span className="text-muted-foreground">To: </span>
          {recommendation.to}
        </div>
      </div>
    </div>
  );
}

function barClassForSeverity(severity: DebugGuide["lanes"][number]["severity"]): string {
  if (severity === "critical") {
    return "h-full rounded-full bg-critical";
  }
  if (severity === "warning") {
    return "h-full rounded-full bg-warning";
  }

  return "h-full rounded-full bg-primary";
}

function badgeClassForSeverity(severity: DebugGuide["lanes"][number]["severity"]): string {
  if (severity === "critical") {
    return "border-critical/40 bg-critical/10 text-critical-foreground";
  }
  if (severity === "warning") {
    return "border-warning/40 bg-warning/10 text-warning-foreground";
  }

  return "border-border bg-background text-muted-foreground";
}

function FactoryColumn({
  icon: Icon,
  title,
  items,
}: {
  icon: LucideIcon;
  title: string;
  items: { title: string; detail: string; meta: string }[];
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="max-h-80 space-y-2 overflow-auto pr-1">
        {items.length > 0 ? (
          items.map((item) => (
            <div key={`${title}:${item.title}:${item.meta}`} className="rounded-md border border-border bg-panel p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{item.title}</p>
                <span className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">{item.meta}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{item.detail}</p>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No entries for this slice.</p>
        )}
      </div>
    </div>
  );
}

function IssueRow({ issue, onInspect }: { issue: IssueSignal; onInspect: () => void }) {
  return (
    <button
      type="button"
      onClick={onInspect}
      className="w-full rounded-md border border-border bg-background p-3 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-medium">{issue.title}</span>
        <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
          {Math.round(issue.confidence * 100)}%
        </span>
      </div>
      <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{issue.explanation}</p>
    </button>
  );
}

function laneForKind(kind: GraphNode["kind"]): number {
  if (kind === "project") {
    return 0;
  }
  if (kind === "workspace") {
    return 1;
  }
  if (kind === "feature" || kind === "surface") {
    return 2;
  }
  if (kind === "route") {
    return 3;
  }
  if (kind === "file") {
    return 4;
  }
  if (kind === "component" || kind === "hook" || kind === "type") {
    return 5;
  }
  if (kind === "dependency" || kind === "permission" || kind === "runtime") {
    return 6;
  }

  return 7;
}

function edgeHealth(edge: GraphEdge): "good" | "warning" | "broken" | "neutral" {
  const health = edge.metadata.health;
  if (health === "good" || health === "warning" || health === "broken") {
    return health;
  }

  return "neutral";
}

function edgeColor(edge: GraphEdge): string {
  const health = edgeHealth(edge);
  if (health === "good") {
    return "var(--path-good)";
  }
  if (health === "warning") {
    return "var(--path-warning)";
  }
  if (health === "broken") {
    return "var(--path-broken)";
  }

  return "var(--path-neutral)";
}

function edgeLabel(edge: GraphEdge): string {
  const flow = edge.metadata.flow;
  if (typeof flow === "string" && flow !== "structural") {
    return `${edge.kind}:${flow}`;
  }

  return edge.kind;
}

function runtimeKindLabel(node: GraphNode): string {
  const runtimeKind = node.metadata.runtimeKind;
  return typeof runtimeKind === "string" ? runtimeKind : "runtime";
}

function targetOptionsFor(kind: GraphSliceKind, catalog: GraphNode[], issues: IssueSignal[]): { value: string; label: string }[] {
  if (kind === "workspace") {
    return catalog
      .filter((node) => node.kind === "workspace")
      .map((node) => ({ value: node.id, label: node.label }));
  }

  if (kind === "feature") {
    return catalog
      .filter((node) => node.kind === "feature")
      .map((node) => ({ value: node.id, label: node.label }));
  }

  if (kind === "route") {
    return catalog
      .filter((node) => node.kind === "route")
      .map((node) => ({ value: node.id, label: node.label }));
  }

  if (kind === "dependencies") {
    return catalog
      .filter((node) => node.kind === "file")
      .slice(0, 100)
      .map((node) => ({ value: node.filePath ?? node.id, label: node.filePath ?? node.label }));
  }

  if (kind === "contracts") {
    return catalog
      .filter((node) => node.kind === "type" || node.kind === "permission" || node.kind === "dependency")
      .slice(0, 150)
      .map((node) => ({ value: node.id, label: `${node.kind}: ${node.label}` }));
  }

  if (kind === "runtime") {
    return catalog
      .filter((node) => node.kind === "runtime")
      .slice(0, 150)
      .map((node) => ({ value: node.id, label: `${runtimeKindLabel(node)}: ${node.label}` }));
  }

  if (kind === "issues") {
    return issues.map((issue) => ({ value: issue.id, label: issue.title }));
  }

  return [];
}

function defaultTargetFor(kind: GraphSliceKind, options: { value: string; label: string }[]): string | null {
  if (kind === "overview" || kind === "duplicates" || kind === "contracts" || kind === "runtime") {
    return null;
  }

  return options[0]?.value ?? null;
}

async function readScanStream(body: ReadableStream<Uint8Array>, onEvent: (event: ScanEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const event = parseScanEvent(part);
      if (event) {
        onEvent(event);
      }
    }
  }
}

function parseScanEvent(chunk: string): ScanEvent | null {
  const eventLine = chunk.split("\n").find((line) => line.startsWith("event: "));
  const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
  if (!eventLine || !dataLine) {
    return null;
  }

  const event = eventLine.slice("event: ".length);
  const data = JSON.parse(dataLine.slice("data: ".length)) as ScanEvent["data"];
  if (event === "job" || event === "progress" || event === "complete" || event === "error") {
    return { event, data } as ScanEvent;
  }

  return null;
}
