import { dirname, relative, resolve } from "node:path";
import type { ImportResolverConfig } from "@/indexer/tsconfig";
import { importAliasMatches, importCandidatesForSpecifier } from "@/indexer/tsconfig";

const routeFileNames = new Set([
  "page.tsx",
  "page.ts",
  "page.jsx",
  "page.js",
  "layout.tsx",
  "layout.ts",
  "layout.jsx",
  "layout.js",
  "route.ts",
  "route.js",
  "middleware.ts",
  "middleware.js",
]);

const extensions = [".ts", ".tsx", ".js", ".jsx"];

export function routePathFromNextAppFile(filePath: string): { path: string; kind: "page" | "layout" | "api-route" | "middleware" } | null {
  const segments = filePath.split("/");
  const appIndex = segments.lastIndexOf("app");
  if (appIndex < 0) {
    return null;
  }

  const fileName = segments.at(-1);
  if (!fileName || !routeFileNames.has(fileName)) {
    return null;
  }

  const routeSegments = segments.slice(appIndex + 1, -1).filter(isVisibleRouteSegment).map(formatRouteSegment);
  const path = `/${routeSegments.join("/")}`.replace(/\/+/g, "/");

  if (fileName.startsWith("page.")) {
    return { path: path === "/" ? "/" : path, kind: "page" };
  }
  if (fileName.startsWith("layout.")) {
    return { path: path === "/" ? "/" : path, kind: "layout" };
  }
  if (fileName.startsWith("middleware.")) {
    return { path: path === "/" ? "/" : path, kind: "middleware" };
  }

  return { path: path === "/" ? "/api" : path, kind: "api-route" };
}

export function routePathFromPagesFile(filePath: string): { path: string; kind: "page" | "api-route" } | null {
  const segments = filePath.split("/");
  const pagesIndex = segments.lastIndexOf("pages");
  if (pagesIndex < 0) {
    return null;
  }

  const fileName = segments.at(-1);
  if (!fileName || !extensions.some((extension) => fileName.endsWith(extension))) {
    return null;
  }

  const routeParts = segments.slice(pagesIndex + 1);
  const withoutExtension = routeParts.join("/").replace(/\.(tsx|ts|jsx|js)$/, "");
  const normalized = withoutExtension
    .replace(/\/index$/, "")
    .replace(/^index$/, "")
    .split("/")
    .filter(Boolean)
    .map(formatRouteSegment)
    .join("/");

  const path = normalized.length > 0 ? `/${normalized}` : "/";
  return {
    path,
    kind: routeParts[0] === "api" ? "api-route" : "page",
  };
}

export function featureFromPath(filePath: string, routePaths: string[]): string {
  const explicitFeature = segmentAfter(filePath, "features") ?? segmentAfter(filePath, "modules");
  if (explicitFeature) {
    return explicitFeature;
  }

  const firstRouteSegment = routePaths
    .flatMap((routePath) => routePath.split("/").filter(Boolean))
    .find((segment) => !segment.startsWith(":") && !segment.startsWith("*") && segment !== "api");

  if (firstRouteSegment) {
    return firstRouteSegment;
  }

  const appSegment = segmentAfter(filePath, "app");
  if (appSegment && isVisibleRouteSegment(appSegment)) {
    return formatRouteSegment(appSegment).replace(/^[:*]/, "") || "root";
  }

  const pagesSegment = segmentAfter(filePath, "pages");
  if (pagesSegment && pagesSegment !== "api") {
    return formatRouteSegment(pagesSegment).replace(/^[:*]/, "") || "root";
  }

  const topLevel = filePath.split("/").find((segment) => segment !== "src");
  return topLevel ?? "shared";
}

export function surfaceFromPath(filePath: string): string {
  if (/\/app\/|^app\//.test(filePath) || /\/pages\/|^pages\//.test(filePath)) {
    return "routes";
  }
  if (/\/components\/|^components\//.test(filePath)) {
    return "components";
  }
  if (/\/hooks\/|^hooks\//.test(filePath)) {
    return "hooks";
  }
  if (/\/services\/|\/api\/|^services\//.test(filePath)) {
    return "services";
  }
  if (/\/lib\/|^lib\//.test(filePath)) {
    return "library";
  }
  if (/\/store\/|\/stores\/|^store\//.test(filePath)) {
    return "state";
  }
  if (/\/test|\.test\.|\.spec\./.test(filePath)) {
    return "tests";
  }

  return "source";
}

export function resolveImportPath(
  rootPath: string,
  fromFilePath: string,
  specifier: string,
  knownFiles: Set<string>,
  resolverConfig: ImportResolverConfig,
): string | null {
  if (specifier.startsWith(".")) {
    const candidate = normalizeCandidate(relative(rootPath, resolve(rootPath, dirname(fromFilePath), specifier)));
    return matchKnownFile(candidate, knownFiles);
  }

  if (specifier.startsWith("@/")) {
    const candidate = normalizeCandidate(`src/${specifier.slice(2)}`);
    const resolvedAlias = matchKnownFile(candidate, knownFiles);
    if (resolvedAlias) {
      return resolvedAlias;
    }
  }

  for (const candidate of importCandidatesForSpecifier(specifier, resolverConfig)) {
    const resolvedCandidate = matchKnownFile(candidate, knownFiles);
    if (resolvedCandidate) {
      return resolvedCandidate;
    }
  }

  return null;
}

export function isProjectLocalImport(specifier: string, resolverConfig: ImportResolverConfig): boolean {
  return specifier.startsWith(".") || specifier.startsWith("@/") || importAliasMatches(specifier, resolverConfig);
}

function matchKnownFile(candidate: string, knownFiles: Set<string>): string | null {
  if (knownFiles.has(candidate)) {
    return candidate;
  }

  for (const extension of extensions) {
    if (knownFiles.has(`${candidate}${extension}`)) {
      return `${candidate}${extension}`;
    }
    if (knownFiles.has(`${candidate}/index${extension}`)) {
      return `${candidate}/index${extension}`;
    }
  }

  return null;
}

function segmentAfter(filePath: string, marker: string): string | null {
  const segments = filePath.split("/");
  const index = segments.indexOf(marker);
  if (index < 0) {
    return null;
  }

  return segments.slice(index + 1).find(isVisibleRouteSegment) ?? null;
}

function isVisibleRouteSegment(segment: string): boolean {
  return segment.length > 0 && !segment.startsWith("(") && !segment.startsWith("@");
}

function formatRouteSegment(segment: string): string {
  if (segment.startsWith("[[...") && segment.endsWith("]]")) {
    return `*${segment.slice(5, -2)}`;
  }
  if (segment.startsWith("[...") && segment.endsWith("]")) {
    return `*${segment.slice(4, -1)}`;
  }
  if (segment.startsWith("[") && segment.endsWith("]")) {
    return `:${segment.slice(1, -1)}`;
  }

  return segment;
}

function normalizeCandidate(value: string): string {
  return value.split("\\").join("/");
}
