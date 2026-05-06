import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type SqlValue } from "node:sqlite";
import type {
  GraphEdge,
  GraphNode,
  GraphSummary,
  IssueSignal,
  ProjectConfig,
  ScanJob,
  ScanResult,
  ScanStatus,
} from "@/lib/atlas/types";

type ProjectRow = {
  id: string;
  name: string;
  root_path: string;
  ignore_patterns: string;
  created_at: string;
  updated_at: string;
};

type ScanJobRow = {
  id: string;
  project_id: string;
  status: string;
  progress: number;
  file_count: number;
  indexed_count: number;
  issue_count: number;
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

type NodeRow = {
  id: string;
  kind: string;
  label: string;
  file_path: string | null;
  feature_id: string | null;
  metadata: string;
};

type EdgeRow = {
  id: string;
  source: string;
  target: string;
  kind: string;
  metadata: string;
};

type IssueRow = {
  id: string;
  kind: string;
  severity: string;
  confidence: number;
  title: string;
  evidence_node_ids: string;
  file_paths: string;
  explanation: string;
};

type SummaryRow = {
  project_name: string;
  file_count: number;
  workspace_count: number;
  feature_count: number;
  route_count: number;
  internal_import_count: number;
  external_dependency_count: number;
  unresolved_import_count: number;
  component_count: number;
  hook_count: number;
  type_count: number;
  permission_count: number;
  runtime_port_count: number;
  startup_issue_count: number;
  timing_issue_count: number;
  broken_edge_count: number;
  warning_edge_count: number;
  edge_count: number;
  issue_count: number;
  scan_id: string;
  scanned_at: string;
};

type TableColumnRow = {
  name: string;
};

const dataPath = join(process.cwd(), ".atlas", "atlas.sqlite");

export class AtlasStore {
  private db: DatabaseSync;

  constructor(databasePath = dataPath) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  listProjects(): ProjectConfig[] {
    return this.db
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all<ProjectRow>()
      .map(projectFromRow);
  }

  getProject(projectId: string): ProjectConfig | null {
    const row = this.db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get<ProjectRow>(projectId);

    return row ? projectFromRow(row) : null;
  }

  upsertProject(project: ProjectConfig): ProjectConfig {
    this.db
      .prepare(
        `INSERT INTO projects (id, name, root_path, ignore_patterns, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           root_path = excluded.root_path,
           ignore_patterns = excluded.ignore_patterns,
           updated_at = excluded.updated_at`,
      )
      .run(
        project.id,
        project.name,
        project.rootPath,
        JSON.stringify(project.ignorePatterns),
        project.createdAt,
        project.updatedAt,
      );

    return project;
  }

  createScanJob(job: ScanJob): ScanJob {
    this.db
      .prepare(
        `INSERT INTO scan_jobs
         (id, project_id, status, progress, file_count, indexed_count, issue_count, started_at, finished_at, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        job.id,
        job.projectId,
        job.status,
        job.progress,
        job.fileCount,
        job.indexedCount,
        job.issueCount,
        job.startedAt,
        job.finishedAt,
        job.error,
      );

    return job;
  }

  updateScanJob(job: ScanJob): ScanJob {
    this.db
      .prepare(
        `UPDATE scan_jobs
         SET status = ?, progress = ?, file_count = ?, indexed_count = ?, issue_count = ?, finished_at = ?, error = ?
         WHERE id = ?`,
      )
      .run(
        job.status,
        job.progress,
        job.fileCount,
        job.indexedCount,
        job.issueCount,
        job.finishedAt,
        job.error,
        job.id,
      );

    return job;
  }

  getScanJob(jobId: string): ScanJob | null {
    const row = this.db
      .prepare("SELECT * FROM scan_jobs WHERE id = ?")
      .get<ScanJobRow>(jobId);

    return row ? scanJobFromRow(row) : null;
  }

  listScanJobs(projectId: string): ScanJob[] {
    return this.db
      .prepare("SELECT * FROM scan_jobs WHERE project_id = ? ORDER BY started_at DESC")
      .all<ScanJobRow>(projectId)
      .map(scanJobFromRow);
  }

  saveScanResult(projectId: string, scanId: string, result: ScanResult) {
    this.db.exec("BEGIN");
    try {
      this.deletePreviousGraph(projectId);
      this.insertSummary(projectId, scanId, result.summary);
      this.insertNodes(projectId, scanId, result.nodes);
      this.insertEdges(projectId, scanId, result.edges);
      this.insertIssues(projectId, scanId, result.issues);
      this.insertFiles(projectId, scanId, result.files);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getLatestSummary(projectId: string): GraphSummary | null {
    const row = this.db
      .prepare("SELECT * FROM graph_summaries WHERE project_id = ? ORDER BY scanned_at DESC LIMIT 1")
      .get<SummaryRow>(projectId);

    return row ? summaryFromRow(row) : null;
  }

  getNodes(projectId: string): GraphNode[] {
    return this.db
      .prepare("SELECT id, kind, label, file_path, feature_id, metadata FROM graph_nodes WHERE project_id = ?")
      .all<NodeRow>(projectId)
      .map(nodeFromRow);
  }

  getEdges(projectId: string): GraphEdge[] {
    return this.db
      .prepare("SELECT id, source, target, kind, metadata FROM graph_edges WHERE project_id = ?")
      .all<EdgeRow>(projectId)
      .map(edgeFromRow);
  }

  getIssues(projectId: string): IssueSignal[] {
    return this.db
      .prepare("SELECT id, kind, severity, confidence, title, evidence_node_ids, file_paths, explanation FROM issues WHERE project_id = ?")
      .all<IssueRow>(projectId)
      .map(issueFromRow);
  }

  getIssue(projectId: string, issueId: string): IssueSignal | null {
    const row = this.db
      .prepare(
        "SELECT id, kind, severity, confidence, title, evidence_node_ids, file_paths, explanation FROM issues WHERE project_id = ? AND id = ?",
      )
      .get<IssueRow>(projectId, issueId);

    return row ? issueFromRow(row) : null;
  }

  private deletePreviousGraph(projectId: string) {
    this.db.prepare("DELETE FROM graph_summaries WHERE project_id = ?").run(projectId);
    this.db.prepare("DELETE FROM graph_nodes WHERE project_id = ?").run(projectId);
    this.db.prepare("DELETE FROM graph_edges WHERE project_id = ?").run(projectId);
    this.db.prepare("DELETE FROM issues WHERE project_id = ?").run(projectId);
    this.db.prepare("DELETE FROM file_entries WHERE project_id = ?").run(projectId);
  }

  private insertSummary(projectId: string, scanId: string, summary: GraphSummary) {
    this.db
      .prepare(
        `INSERT INTO graph_summaries
         (project_id, scan_id, project_name, file_count, workspace_count, feature_count, route_count, internal_import_count, external_dependency_count,
          unresolved_import_count, component_count, hook_count, type_count, permission_count, runtime_port_count, startup_issue_count,
          timing_issue_count, broken_edge_count, warning_edge_count,
          edge_count, issue_count, scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        projectId,
        scanId,
        summary.projectName,
        summary.fileCount,
        summary.workspaceCount,
        summary.featureCount,
        summary.routeCount,
        summary.internalImportCount,
        summary.externalDependencyCount,
        summary.unresolvedImportCount,
        summary.componentCount,
        summary.hookCount,
        summary.typeCount,
        summary.permissionCount,
        summary.runtimePortCount,
        summary.startupIssueCount,
        summary.timingIssueCount,
        summary.brokenEdgeCount,
        summary.warningEdgeCount,
        summary.edgeCount,
        summary.issueCount,
        summary.scannedAt,
      );
  }

  private insertNodes(projectId: string, scanId: string, nodes: GraphNode[]) {
    const statement = this.db.prepare(
      `INSERT INTO graph_nodes
       (project_id, scan_id, id, kind, label, file_path, feature_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const node of nodes) {
      statement.run(
        projectId,
        scanId,
        node.id,
        node.kind,
        node.label,
        node.filePath,
        node.featureId,
        JSON.stringify(node.metadata),
      );
    }
  }

  private insertEdges(projectId: string, scanId: string, edges: GraphEdge[]) {
    const statement = this.db.prepare(
      `INSERT INTO graph_edges
       (project_id, scan_id, id, source, target, kind, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const edge of edges) {
      statement.run(
        projectId,
        scanId,
        edge.id,
        edge.source,
        edge.target,
        edge.kind,
        JSON.stringify(edge.metadata),
      );
    }
  }

  private insertIssues(projectId: string, scanId: string, issues: IssueSignal[]) {
    const statement = this.db.prepare(
      `INSERT INTO issues
       (project_id, scan_id, id, kind, severity, confidence, title, evidence_node_ids, file_paths, explanation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const issue of issues) {
      statement.run(
        projectId,
        scanId,
        issue.id,
        issue.kind,
        issue.severity,
        issue.confidence,
        issue.title,
        JSON.stringify(issue.evidenceNodeIds),
        JSON.stringify(issue.filePaths),
        issue.explanation,
      );
    }
  }

  private insertFiles(projectId: string, scanId: string, files: ScanResult["files"]) {
    const statement = this.db.prepare(
      `INSERT INTO file_entries
       (project_id, scan_id, file_path, hash, language, feature_id, imports, exports, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const file of files) {
      statement.run(
        projectId,
        scanId,
        file.path,
        file.hash,
        file.language,
        file.featureId,
        JSON.stringify(file.imports),
        JSON.stringify(file.exports),
        JSON.stringify({
          surface: file.surface,
          routes: file.routes,
          components: file.components,
          hooks: file.hooks,
          typeDeclarations: file.typeDeclarations,
          apiCalls: file.apiCalls,
          permissions: file.permissions,
          ports: file.ports,
          slopSignals: file.slopSignals,
        }),
      );
    }
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        ignore_patterns TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scan_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL NOT NULL,
        file_count INTEGER NOT NULL,
        indexed_count INTEGER NOT NULL,
        issue_count INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS graph_summaries (
        project_id TEXT PRIMARY KEY,
        scan_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        file_count INTEGER NOT NULL,
        workspace_count INTEGER NOT NULL DEFAULT 0,
        feature_count INTEGER NOT NULL,
        route_count INTEGER NOT NULL,
        internal_import_count INTEGER NOT NULL DEFAULT 0,
        external_dependency_count INTEGER NOT NULL DEFAULT 0,
        unresolved_import_count INTEGER NOT NULL DEFAULT 0,
        component_count INTEGER NOT NULL DEFAULT 0,
        hook_count INTEGER NOT NULL DEFAULT 0,
        type_count INTEGER NOT NULL DEFAULT 0,
        permission_count INTEGER NOT NULL DEFAULT 0,
        runtime_port_count INTEGER NOT NULL DEFAULT 0,
        startup_issue_count INTEGER NOT NULL DEFAULT 0,
        timing_issue_count INTEGER NOT NULL DEFAULT 0,
        broken_edge_count INTEGER NOT NULL DEFAULT 0,
        warning_edge_count INTEGER NOT NULL DEFAULT 0,
        edge_count INTEGER NOT NULL,
        issue_count INTEGER NOT NULL,
        scanned_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS graph_nodes (
        project_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        id TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        file_path TEXT,
        feature_id TEXT,
        metadata TEXT NOT NULL,
        PRIMARY KEY(project_id, id)
      );

      CREATE TABLE IF NOT EXISTS graph_edges (
        project_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        id TEXT NOT NULL,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        kind TEXT NOT NULL,
        metadata TEXT NOT NULL,
        PRIMARY KEY(project_id, id)
      );

      CREATE TABLE IF NOT EXISTS issues (
        project_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        id TEXT NOT NULL,
        kind TEXT NOT NULL,
        severity TEXT NOT NULL,
        confidence REAL NOT NULL,
        title TEXT NOT NULL,
        evidence_node_ids TEXT NOT NULL,
        file_paths TEXT NOT NULL,
        explanation TEXT NOT NULL,
        PRIMARY KEY(project_id, id)
      );

      CREATE TABLE IF NOT EXISTS file_entries (
        project_id TEXT NOT NULL,
        scan_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        hash TEXT NOT NULL,
        language TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        imports TEXT NOT NULL,
        exports TEXT NOT NULL,
        metadata TEXT NOT NULL,
        PRIMARY KEY(project_id, file_path)
      );
    `);

    this.addColumnIfMissing("graph_summaries", "workspace_count", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("graph_summaries", "internal_import_count", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("graph_summaries", "external_dependency_count", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("graph_summaries", "unresolved_import_count", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("graph_summaries", "component_count", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("graph_summaries", "hook_count", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("graph_summaries", "type_count", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("graph_summaries", "permission_count", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("graph_summaries", "runtime_port_count", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("graph_summaries", "startup_issue_count", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("graph_summaries", "timing_issue_count", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("graph_summaries", "broken_edge_count", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("graph_summaries", "warning_edge_count", "INTEGER NOT NULL DEFAULT 0");
  }

  private addColumnIfMissing(tableName: string, columnName: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all<TableColumnRow>();
    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function createEmptySummary(project: ProjectConfig): GraphSummary {
  const now = new Date().toISOString();

  return {
    projectName: project.name,
    fileCount: 0,
    workspaceCount: 0,
    featureCount: 0,
    routeCount: 0,
    internalImportCount: 0,
    externalDependencyCount: 0,
    unresolvedImportCount: 0,
    componentCount: 0,
    hookCount: 0,
    typeCount: 0,
    permissionCount: 0,
    runtimePortCount: 0,
    startupIssueCount: 0,
    timingIssueCount: 0,
    brokenEdgeCount: 0,
    warningEdgeCount: 0,
    edgeCount: 0,
    issueCount: 0,
    scanId: "empty",
    scannedAt: now,
  };
}

function projectFromRow(row: ProjectRow): ProjectConfig {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    ignorePatterns: JSON.parse(row.ignore_patterns) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function scanJobFromRow(row: ScanJobRow): ScanJob {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status as ScanStatus,
    progress: row.progress,
    fileCount: row.file_count,
    indexedCount: row.indexed_count,
    issueCount: row.issue_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
  };
}

function nodeFromRow(row: NodeRow): GraphNode {
  return {
    id: row.id,
    kind: row.kind as GraphNode["kind"],
    label: row.label,
    filePath: row.file_path,
    featureId: row.feature_id,
    metadata: JSON.parse(row.metadata) as GraphNode["metadata"],
  };
}

function edgeFromRow(row: EdgeRow): GraphEdge {
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    kind: row.kind as GraphEdge["kind"],
    metadata: JSON.parse(row.metadata) as GraphEdge["metadata"],
  };
}

function issueFromRow(row: IssueRow): IssueSignal {
  return {
    id: row.id,
    kind: row.kind as IssueSignal["kind"],
    severity: row.severity as IssueSignal["severity"],
    confidence: row.confidence,
    title: row.title,
    evidenceNodeIds: JSON.parse(row.evidence_node_ids) as string[],
    filePaths: JSON.parse(row.file_paths) as string[],
    explanation: row.explanation,
  };
}

function summaryFromRow(row: SummaryRow): GraphSummary {
  return {
    projectName: row.project_name,
    fileCount: row.file_count,
    workspaceCount: row.workspace_count,
    featureCount: row.feature_count,
    routeCount: row.route_count,
    internalImportCount: row.internal_import_count,
    externalDependencyCount: row.external_dependency_count,
    unresolvedImportCount: row.unresolved_import_count,
    componentCount: row.component_count,
    hookCount: row.hook_count,
    typeCount: row.type_count,
    permissionCount: row.permission_count,
    runtimePortCount: row.runtime_port_count,
    startupIssueCount: row.startup_issue_count,
    timingIssueCount: row.timing_issue_count,
    brokenEdgeCount: row.broken_edge_count,
    warningEdgeCount: row.warning_edge_count,
    edgeCount: row.edge_count,
    issueCount: row.issue_count,
    scanId: row.scan_id,
    scannedAt: row.scanned_at,
  };
}

export function sqliteValue(value: string | number | null): SqlValue {
  return value;
}
