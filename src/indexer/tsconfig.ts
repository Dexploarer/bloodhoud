import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import ts from "typescript";

export type ImportPathPattern = {
  pattern: string;
  targets: string[];
};

export type ImportResolverConfig = {
  rootPath: string;
  baseUrlPath: string | null;
  paths: ImportPathPattern[];
};

export function emptyImportResolverConfig(rootPath: string): ImportResolverConfig {
  return {
    rootPath,
    baseUrlPath: null,
    paths: [],
  };
}

export function readImportResolverConfig(rootPath: string): ImportResolverConfig {
  const configPath = [join(rootPath, "tsconfig.json"), join(rootPath, "jsconfig.json")].find((candidate) => existsSync(candidate));
  if (!configPath) {
    return emptyImportResolverConfig(rootPath);
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(`Could not read ${configPath}: ${formatDiagnostic(configFile.error)}`);
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(configPath));
  if (parsed.errors.length > 0) {
    throw new Error(`Could not parse ${configPath}: ${parsed.errors.map(formatDiagnostic).join("; ")}`);
  }
  const baseUrlPath = parsed.options.baseUrl ? normalizeAbsolutePath(parsed.options.baseUrl, rootPath) : null;
  const paths = Object.entries(parsed.options.paths ?? {})
    .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]))
    .map(([pattern, targets]) => ({ pattern, targets }));

  return {
    rootPath,
    baseUrlPath,
    paths,
  };
}

export function importAliasMatches(specifier: string, resolverConfig: ImportResolverConfig): boolean {
  return resolverConfig.paths.some((pathPattern) => {
    const wildcard = matchPathPattern(specifier, pathPattern.pattern);
    if (wildcard === null) {
      return false;
    }

    return pathPattern.targets.some((target) => {
      const replaced = wildcard.length > 0 ? target.replace("*", wildcard) : target;
      return isProjectTarget(projectRelativePath(replaced, resolverConfig));
    });
  });
}

export function importCandidatesForSpecifier(specifier: string, resolverConfig: ImportResolverConfig): string[] {
  const candidates: string[] = [];

  for (const pathPattern of resolverConfig.paths) {
    const wildcard = matchPathPattern(specifier, pathPattern.pattern);
    if (wildcard === null) {
      continue;
    }

    for (const target of pathPattern.targets) {
      const replaced = wildcard.length > 0 ? target.replace("*", wildcard) : target;
      candidates.push(projectRelativePath(replaced, resolverConfig));
    }
  }

  if (resolverConfig.baseUrlPath) {
    candidates.push(projectRelativePath(specifier, resolverConfig));
  }

  return candidates;
}

function matchPathPattern(specifier: string, pattern: string): string | null {
  if (!pattern.includes("*")) {
    return specifier === pattern ? "" : null;
  }

  const [prefix, suffix] = pattern.split("*", 2);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
    return null;
  }

  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

function projectRelativePath(pathValue: string, resolverConfig: ImportResolverConfig): string {
  const basePath = resolverConfig.baseUrlPath ?? resolverConfig.rootPath;
  const absolutePath = isAbsolute(pathValue) ? pathValue : resolve(basePath, pathValue);
  return normalizePath(relative(resolverConfig.rootPath, absolutePath));
}

function normalizeAbsolutePath(pathValue: string, rootPath: string): string {
  if (isAbsolute(pathValue)) {
    return pathValue;
  }

  return resolve(rootPath, pathValue);
}

function normalizePath(value: string): string {
  return value.split("\\").join("/");
}

function isProjectTarget(candidate: string): boolean {
  return !candidate.startsWith("node_modules/") && candidate !== "node_modules";
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}
