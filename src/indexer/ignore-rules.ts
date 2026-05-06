import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import ignore from "ignore";
import type { IgnorePreview, ProjectConfig } from "@/lib/atlas/types";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);

const defaultIgnorePatterns = [
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "out",
  "*.min.js",
  "*.map",
  "*.lock",
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.webp",
  "*.svg",
  "*.ico",
  "*.mp4",
  "*.mov",
  "*.zip",
  "*.tar",
  "*.gz",
];

export type DiscoveredFile = {
  path: string;
  absolutePath: string;
  extension: ".ts" | ".tsx" | ".js" | ".jsx";
};

export async function discoverSourceFiles(project: ProjectConfig): Promise<DiscoveredFile[]> {
  const matcher = await createIgnoreMatcher(project.rootPath, project.ignorePatterns);
  const files: DiscoveredFile[] = [];
  const pending = [project.rootPath];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) {
      break;
    }

    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const relativePath = normalizePath(relative(project.rootPath, absolutePath));

      if (relativePath.length > 0 && matcher.ignores(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }

      const extension = extensionOf(entry.name);
      if (extension && sourceExtensions.has(extension)) {
        files.push({ path: relativePath, absolutePath, extension });
      }
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function previewIgnoreRules(
  rootPath: string,
  ignorePatterns: string[],
): Promise<IgnorePreview> {
  const matcher = await createIgnoreMatcher(rootPath, ignorePatterns);
  const indexedSamples: string[] = [];
  const ignoredSamples: string[] = [];
  let indexedCount = 0;
  let ignoredCount = 0;
  const pending = [rootPath];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) {
      break;
    }

    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const relativePath = normalizePath(relative(rootPath, absolutePath));
      const ignored = relativePath.length > 0 && matcher.ignores(relativePath);

      if (ignored) {
        ignoredCount += 1;
        if (ignoredSamples.length < 20) {
          ignoredSamples.push(relativePath);
        }
        continue;
      }

      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }

      if (extensionOf(entry.name)) {
        indexedCount += 1;
        if (indexedSamples.length < 20) {
          indexedSamples.push(relativePath);
        }
      }
    }
  }

  return {
    rootPath,
    ignoredCount,
    indexedCount,
    ignoredSamples,
    indexedSamples,
  };
}

export async function createIgnoreMatcher(rootPath: string, userPatterns: string[]) {
  const matcher = ignore();
  matcher.add(defaultIgnorePatterns);
  matcher.add(await readGitignore(rootPath));
  matcher.add(userPatterns.filter((pattern) => pattern.trim().length > 0));
  return matcher;
}

async function readGitignore(rootPath: string): Promise<string[]> {
  try {
    const content = await readFile(join(rootPath, ".gitignore"), "utf8");
    return content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function extensionOf(fileName: string): DiscoveredFile["extension"] | null {
  const lower = basename(fileName).toLowerCase();
  if (lower.endsWith(".tsx")) {
    return ".tsx";
  }
  if (lower.endsWith(".ts")) {
    return ".ts";
  }
  if (lower.endsWith(".jsx")) {
    return ".jsx";
  }
  if (lower.endsWith(".js")) {
    return ".js";
  }

  return null;
}

export function normalizePath(value: string): string {
  return value.split(sep).join("/");
}
