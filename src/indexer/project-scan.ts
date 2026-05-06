import type { ProjectConfig, ScanProgress, ScanResult } from "@/lib/atlas/types";
import { analyzeProjectFiles } from "@/indexer/analyzer";
import { buildProjectGraph } from "@/indexer/graph";
import { discoverSourceFiles } from "@/indexer/ignore-rules";
import { analyzeRuntimeProfile } from "@/indexer/runtime-profile";
import { readImportResolverConfig } from "@/indexer/tsconfig";

export type ScanProjectInput = {
  project: ProjectConfig;
  scanId: string;
};

export async function scanProject(
  input: ScanProjectInput,
  onProgress: (progress: ScanProgress) => void = () => {},
): Promise<ScanResult> {
  onProgress({
    phase: "discovering",
    progress: 0.05,
    fileCount: 0,
    indexedCount: 0,
    message: "Finding source files and applying ignore rules.",
  });

  const files = await discoverSourceFiles(input.project);
  const runtimeProfile = await analyzeRuntimeProfile(input.project);
  const resolverConfig = readImportResolverConfig(input.project.rootPath);
  onProgress({
    phase: "analyzing",
    progress: 0.25,
    fileCount: files.length,
    indexedCount: 0,
    message: `Analyzing ${files.length.toLocaleString()} files with bounded workers.`,
  });

  const analyzed = await analyzeProjectFiles(files, (progress) => {
    onProgress({
      phase: "analyzing",
      progress: analysisProgress(progress.indexedCount, progress.fileCount),
      fileCount: progress.fileCount,
      indexedCount: progress.indexedCount,
      message: `Parsed ${progress.indexedCount.toLocaleString()} of ${progress.fileCount.toLocaleString()} files.`,
    });
  });
  onProgress({
    phase: "graphing",
    progress: 0.75,
    fileCount: files.length,
    indexedCount: analyzed.length,
    message: "Resolving imports, routes, features, and issue evidence.",
  });

  const result = buildProjectGraph(input.project, input.scanId, analyzed, resolverConfig, runtimeProfile);
  onProgress({
    phase: "complete",
    progress: 1,
    fileCount: files.length,
    indexedCount: analyzed.length,
    message: "Scan complete.",
  });

  return result;
}

function analysisProgress(indexedCount: number, fileCount: number): number {
  if (fileCount === 0) {
    return 0.7;
  }

  return 0.25 + (indexedCount / fileCount) * 0.45;
}
