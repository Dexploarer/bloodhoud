import { readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import ts from "typescript";
import type {
  AnalyzedFile,
  AsyncSignal,
  FingerprintRecord,
  ImportRecord,
  PermissionRecord,
  PortRecord,
  RouteRecord,
  SlopSignal,
} from "@/lib/atlas/types";
import { fingerprint, sha256 } from "@/indexer/hash";
import type { DiscoveredFile } from "@/indexer/ignore-rules";
import { featureFromPath, routePathFromNextAppFile, routePathFromPagesFile, surfaceFromPath } from "@/indexer/routes";

export type AnalyzeProgress = {
  indexedCount: number;
  fileCount: number;
};

export async function analyzeProjectFiles(
  files: DiscoveredFile[],
  onProgress: (progress: AnalyzeProgress) => void = () => {},
): Promise<AnalyzedFile[]> {
  if (files.length === 0) {
    onProgress({ indexedCount: 0, fileCount: 0 });
    return [];
  }

  const analyzed: AnalyzedFile[] = new Array(files.length);
  const workerCount = analysisWorkerCount(files.length);
  let nextIndex = 0;
  let indexedCount = 0;

  async function analyzeNextFile() {
    while (nextIndex < files.length) {
      const fileIndex = nextIndex;
      nextIndex += 1;
      const file = files[fileIndex];
      const content = await readFile(file.absolutePath, "utf8");
      analyzed[fileIndex] = analyzeFile(file, content);
      indexedCount += 1;
      onProgress({ indexedCount, fileCount: files.length });
    }
  }

  await Promise.all(Array.from({ length: workerCount }, analyzeNextFile));

  return analyzed;
}

export function analyzeFile(file: DiscoveredFile, content: string): AnalyzedFile {
  const scriptKind = scriptKindForExtension(file.extension);
  const sourceFile = ts.createSourceFile(file.path, content, ts.ScriptTarget.Latest, true, scriptKind);
  const imports: ImportRecord[] = [];
  const exports: string[] = [];
  const components: string[] = [];
  const hooks: string[] = [];
  const typeDeclarations: string[] = [];
  const apiCalls: string[] = [];
  const permissions: PermissionRecord[] = [];
  const ports = collectTextPortRecords(content);
  const asyncSignals: AsyncSignal[] = [];
  const slopSignals = collectSlopSignals(content);
  const fingerprints: FingerprintRecord[] = [];
  const routes = routeRecordsForFile(file.path);

  visit(sourceFile);

  const routePaths = routes.map((route) => route.path);
  const featureId = featureFromPath(file.path, routePaths);

  return {
    path: file.path,
    absolutePath: file.absolutePath,
    hash: sha256(content),
    language: file.extension.slice(1) as AnalyzedFile["language"],
    size: content.length,
    surface: surfaceFromPath(file.path),
    featureId,
    imports,
    exports,
    components: unique(components),
    hooks: unique(hooks),
    typeDeclarations: unique(typeDeclarations),
    routes,
    apiCalls: unique(apiCalls),
    permissions: uniquePermissions(permissions),
    ports: uniquePorts(ports),
    asyncSignals,
    slopSignals,
    fingerprints,
  };

  function visit(node: ts.Node) {
    collectImport(node, imports);
    collectExport(node, exports);
    collectDeclaration(node, components, hooks, fingerprints, sourceFile);
    collectTypeDeclaration(node, typeDeclarations);
    collectApiCall(node, apiCalls);
    collectRuntimePermission(node, permissions, sourceFile);
    collectPortRecord(node, ports, sourceFile);
    collectReactRouterRoute(node, routes, file.path);
    collectAsyncSignal(node, asyncSignals, sourceFile);
    ts.forEachChild(node, visit);
  }
}

function collectSlopSignals(content: string): SlopSignal[] {
  const signals: SlopSignal[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();

    if (/(^|[^A-Za-z0-9_$])(any)([^A-Za-z0-9_$]|$)|\bas\s+any\b|:\s*unknown\b/.test(trimmed)) {
      signals.push({
        kind: "weak-typing",
        line: lineNumber,
        detail: "Weak typing makes downstream architecture look correct while hiding broken contracts.",
        repair: "Replace with a narrow domain type or validate at the boundary before passing inward.",
      });
    }

    if (/\?\?\s*(?:\[\]|\{\}|0|false|true|""|'')/.test(trimmed)) {
      signals.push({
        kind: "silent-fallback",
        line: lineNumber,
        detail: "Silent fallback can turn pipeline failures into ambiguous success states.",
        repair: "Surface the missing value at the boundary or make the nullable state explicit in the UI.",
      });
    }

    if (/console\.(log|debug|warn|error)\s*\(/.test(trimmed)) {
      signals.push({
        kind: "console-debugging",
        line: lineNumber,
        detail: "Console debugging tends to survive AI edits and hides observability intent.",
        repair: "Use structured logging on server paths or remove the trace from client code.",
      });
    }

    if (isPlaceholderSignal(trimmed)) {
      signals.push({
        kind: "placeholder-code",
        line: lineNumber,
        detail: "Placeholder language is a strong signal that generated code never got productized.",
        repair: "Replace the placeholder with real behavior, a tracked task, or a deliberate empty state.",
      });
    }
  });

  for (const match of content.matchAll(/catch\s*\([^)]*\)\s*{\s*(?:return\s+(?:\[\]|\{\}|null|undefined|0|false|true|""|'');?\s*)?}/g)) {
    signals.push({
      kind: "swallowed-error",
      line: lineForOffset(content, match.index ?? 0),
      detail: "A broad catch block swallows failure and makes debugging follow the wrong branch.",
      repair: "Handle the specific expected error or let unexpected failure remain visible.",
    });
  }

  return signals;
}

function isPlaceholderSignal(line: string): boolean {
  return /(?:\/\/|\/\*|\*)\s*(?:TODO|FIXME|placeholder|dummy|stub|mock data)\b/i.test(line)
    || /=\s*["'`]placeholder["'`]/i.test(line)
    || /throw\s+new\s+Error\(\s*["'`](?:TODO|FIXME|not implemented|placeholder|stub)/i.test(line)
    || /\blorem ipsum\b/i.test(line);
}

function collectImport(node: ts.Node, imports: ImportRecord[]) {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    imports.push({ specifier: node.moduleSpecifier.text, kind: "static", mode: importMode(node) });
    return;
  }

  if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    imports.push({ specifier: node.moduleSpecifier.text, kind: "export", mode: node.isTypeOnly ? "type" : "value" });
    return;
  }

  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const firstArg = node.arguments[0];
    if (firstArg && ts.isStringLiteral(firstArg)) {
      imports.push({ specifier: firstArg.text, kind: "dynamic", mode: "value" });
    }
    return;
  }

  if (ts.isCallExpression(node) && isIdentifierNamed(node.expression, "require")) {
    const firstArg = node.arguments[0];
    if (firstArg && ts.isStringLiteral(firstArg)) {
      imports.push({ specifier: firstArg.text, kind: "commonjs", mode: "value" });
    }
  }
}

function importMode(node: ts.ImportDeclaration): ImportRecord["mode"] {
  if (node.importClause?.isTypeOnly) {
    return "type";
  }

  const namedBindings = node.importClause?.namedBindings;
  if (namedBindings && ts.isNamedImports(namedBindings) && namedBindings.elements.length > 0) {
    const allSpecifiersAreTypeOnly = namedBindings.elements.every((element) => element.isTypeOnly);
    if (allSpecifiersAreTypeOnly) {
      return "type";
    }
  }

  return "value";
}

function collectExport(node: ts.Node, exports: string[]) {
  if (ts.isFunctionDeclaration(node) && node.name && isExported(node)) {
    exports.push(node.name.text);
    return;
  }

  if (ts.isVariableStatement(node) && isExported(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        exports.push(declaration.name.text);
      }
    }
  }
}

function collectDeclaration(
  node: ts.Node,
  components: string[],
  hooks: string[],
  fingerprints: FingerprintRecord[],
  sourceFile: ts.SourceFile,
) {
  if (ts.isFunctionDeclaration(node) && node.name) {
    collectNamedDeclaration(node.name.text, node, components, hooks, fingerprints, sourceFile);
    return;
  }

  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
      collectNamedDeclaration(node.name.text, node.initializer, components, hooks, fingerprints, sourceFile);
    }
  }
}

function collectTypeDeclaration(node: ts.Node, typeDeclarations: string[]) {
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
    typeDeclarations.push(node.name.text);
  }
}

function collectNamedDeclaration(
  name: string,
  node: ts.Node,
  components: string[],
  hooks: string[],
  fingerprints: FingerprintRecord[],
  sourceFile: ts.SourceFile,
) {
  if (/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    components.push(name);
  }

  if (/^use[A-Z0-9]/.test(name)) {
    hooks.push(name);
  }

  const text = node.getText(sourceFile);
  if (text.length >= 160) {
    fingerprints.push({
      id: `${sourceFile.fileName}:${name}:${fingerprints.length}`,
      filePath: sourceFile.fileName,
      name,
      hash: fingerprint(normalizeFunctionBody(text)),
      size: text.length,
    });
  }
}

function collectApiCall(node: ts.Node, apiCalls: string[]) {
  if (!ts.isCallExpression(node)) {
    return;
  }

  if (isIdentifierNamed(node.expression, "fetch")) {
    const firstArg = node.arguments[0];
    const path = stringLiteralValue(firstArg);
    if (path && path.startsWith("/")) {
      apiCalls.push(path);
    }
  }
}

function collectRuntimePermission(node: ts.Node, permissions: PermissionRecord[], sourceFile: ts.SourceFile) {
  if (ts.isCallExpression(node) && isIdentifierNamed(node.expression, "fetch")) {
    permissions.push({ kind: "network", source: "fetch", line: lineForNode(sourceFile, node) });
    return;
  }

  if (ts.isPropertyAccessExpression(node)) {
    const storageSource = storagePermissionSource(node.expression);
    if (storageSource) {
      permissions.push({ kind: "storage", source: storageSource, line: lineForNode(sourceFile, node) });
      return;
    }

    if (isIdentifierNamed(node.expression, "indexedDB")) {
      permissions.push({ kind: "storage", source: "indexedDB", line: lineForNode(sourceFile, node) });
      return;
    }

    if (ts.isPropertyAccessExpression(node.expression) && isIdentifierNamed(node.expression.expression, "process") && node.expression.name.text === "env") {
      permissions.push({ kind: "process", source: `process.env.${node.name.text}`, line: lineForNode(sourceFile, node) });
    }
  }
}

function collectPortRecord(node: ts.Node, ports: PortRecord[], sourceFile: ts.SourceFile) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "listen") {
    const firstArg = node.arguments[0];
    const port = numericLiteralValue(firstArg);
    if (port) {
      ports.push({ port, kind: "listen", source: "listen", line: lineForNode(sourceFile, node) });
    }
    return;
  }

  if (ts.isPropertyAssignment(node) && node.name.getText(sourceFile) === "port") {
    const port = numericLiteralValue(node.initializer);
    if (port) {
      ports.push({ port, kind: "config", source: "port", line: lineForNode(sourceFile, node) });
    }
  }
}

function storagePermissionSource(node: ts.LeftHandSideExpression): string | null {
  if (isIdentifierNamed(node, "localStorage")) {
    return "localStorage";
  }

  if (isIdentifierNamed(node, "sessionStorage")) {
    return "sessionStorage";
  }

  return null;
}

function collectTextPortRecords(content: string): PortRecord[] {
  const records: PortRecord[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    for (const match of line.matchAll(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/g)) {
      const port = parsePort(match[1]);
      if (port) {
        records.push({ port, kind: "url", source: match[0], line: lineNumber });
      }
    }
  });

  return records;
}

function collectReactRouterRoute(node: ts.Node, routes: RouteRecord[], filePath: string) {
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
    const tagName = node.tagName.getText();
    if (tagName !== "Route") {
      return;
    }

    const pathAttr = node.attributes.properties.find((attribute) => {
      return ts.isJsxAttribute(attribute) && attribute.name.getText() === "path";
    });

    if (pathAttr && ts.isJsxAttribute(pathAttr) && pathAttr.initializer && ts.isStringLiteral(pathAttr.initializer)) {
      routes.push({
        id: `${filePath}:react-router:${pathAttr.initializer.text}`,
        path: pathAttr.initializer.text,
        kind: "react-router",
        filePath,
      });
    }
    return;
  }

  if (ts.isPropertyAssignment(node) && node.name.getText() === "path") {
    const path = stringLiteralValue(node.initializer);
    if (path && path.startsWith("/")) {
      routes.push({
        id: `${filePath}:react-router:${path}`,
        path,
        kind: "react-router",
        filePath,
      });
    }
  }
}

function collectAsyncSignal(node: ts.Node, signals: AsyncSignal[], sourceFile: ts.SourceFile) {
  if (!ts.isCallExpression(node) || !isIdentifierNamed(node.expression, "useEffect")) {
    return;
  }

  const callback = node.arguments[0];
  if (!callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
    return;
  }

  const callbackText = callback.getText(sourceFile);
  const line = sourceFile.getLineAndCharacterOfPosition(callback.getStart(sourceFile)).line + 1;
  const dependencyArray = node.arguments[1];
  const hasEmptyDependencies = dependencyArray && ts.isArrayLiteralExpression(dependencyArray) && dependencyArray.elements.length === 0;
  const usesAsyncWork = callback.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true
    || /\bawait\b|\bfetch\s*\(|Promise\.all|setTimeout|setInterval/.test(callbackText);
  const hasAbortGuard = /\bAbortController\b|\babort\b|\bcancelled\b|\bisMounted\b/.test(callbackText);

  if (usesAsyncWork && !hasAbortGuard) {
    signals.push({
      kind: "async-effect",
      line,
      detail: "React effect starts async work without an abort or cancellation guard.",
    });
  }

  if (usesAsyncWork && hasEmptyDependencies) {
    signals.push({
      kind: "stale-closure-risk",
      line,
      detail: "Async effect has an empty dependency array, so referenced values can go stale.",
    });
  }

  if (/Promise\.all|setTimeout|setInterval/.test(callbackText) && !hasAbortGuard) {
    signals.push({
      kind: "unguarded-parallel-async",
      line,
      detail: "Parallel or delayed async work is started without a cancellation guard.",
    });
  }

  if (/\bset(?:Timeout|Interval)\s*\(/.test(callbackText) && !/\bclear(?:Timeout|Interval)\s*\(/.test(callbackText)) {
    signals.push({
      kind: "timer-without-cleanup",
      line,
      detail: "React effect starts a timer without clearing it during cleanup.",
    });
  }
}

function routeRecordsForFile(filePath: string): RouteRecord[] {
  const appRoute = routePathFromNextAppFile(filePath);
  if (appRoute) {
    return [
      {
        id: `${filePath}:${appRoute.kind}:${appRoute.path}`,
        path: appRoute.path,
        kind: appRoute.kind,
        filePath,
      },
    ];
  }

  const pagesRoute = routePathFromPagesFile(filePath);
  if (pagesRoute) {
    return [
      {
        id: `${filePath}:${pagesRoute.kind}:${pagesRoute.path}`,
        path: pagesRoute.path,
        kind: pagesRoute.kind,
        filePath,
      },
    ];
  }

  return [];
}

function normalizeFunctionBody(text: string): string {
  return text
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "string")
    .replace(/\b\d+(?:\.\d+)?\b/g, "number")
    .replace(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g, "id")
    .replace(/\s+/g, " ")
    .trim();
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

function isIdentifierNamed(node: ts.Node, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name;
}

function stringLiteralValue(node: ts.Node | undefined): string | null {
  if (!node) {
    return null;
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  return null;
}

function numericLiteralValue(node: ts.Node | undefined): number | null {
  if (!node || !ts.isNumericLiteral(node)) {
    return null;
  }

  return parsePort(node.text);
}

function parsePort(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    return null;
  }

  return parsed;
}

function scriptKindForExtension(extension: DiscoveredFile["extension"]): ts.ScriptKind {
  if (extension === ".tsx") {
    return ts.ScriptKind.TSX;
  }
  if (extension === ".jsx") {
    return ts.ScriptKind.JSX;
  }
  if (extension === ".js") {
    return ts.ScriptKind.JS;
  }

  return ts.ScriptKind.TS;
}

function lineForOffset(content: string, offset: number): number {
  return content.slice(0, offset).split(/\r?\n/).length;
}

function lineForNode(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniquePermissions(values: PermissionRecord[]): PermissionRecord[] {
  const seen = new Set<string>();
  const permissions: PermissionRecord[] = [];

  for (const value of values) {
    const key = `${value.kind}:${value.source}:${value.line}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    permissions.push(value);
  }

  return permissions.sort((left, right) => left.line - right.line || left.kind.localeCompare(right.kind));
}

function uniquePorts(values: PortRecord[]): PortRecord[] {
  const seen = new Set<string>();
  const ports: PortRecord[] = [];

  for (const value of values) {
    const key = `${value.kind}:${value.port}:${value.source}:${value.line}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    ports.push(value);
  }

  return ports.sort((left, right) => left.line - right.line || left.port - right.port);
}

function analysisWorkerCount(fileCount: number): number {
  const cpuCount = availableParallelism();
  if (fileCount <= 1 || cpuCount <= 1) {
    return 1;
  }

  return Math.min(fileCount, cpuCount, 8);
}
