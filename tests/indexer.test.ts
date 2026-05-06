import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectConfig } from "../src/lib/atlas/types";
import { buildDebugGuide } from "../src/lib/atlas/debug-guide";
import { buildLocalAiScan } from "../src/indexer/ai-scan";
import { buildFactoryPacket, buildSoftwareFactoryProfile } from "../src/indexer/factory";
import { discoverSourceFiles, previewIgnoreRules } from "../src/indexer/ignore-rules";
import { buildMermaid } from "../src/indexer/mermaid";
import { scanProject } from "../src/indexer/project-scan";
import { buildGraphSlice } from "../src/indexer/slices";

test("indexes routes, features, dependencies, duplicates, and async signals", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-indexer-"));
  try {
    await writeFixture(root, "src/app/dashboard/page.tsx", `
      import { useEffect, useState } from "react";
      import { Widget } from "../../components/Widget";

      export default function DashboardPage() {
        const [name, setName] = useState("");
        useEffect(() => {
          async function load() {
            const response = await fetch("/api/users");
            setName(await response.text());
          }
          load();
        }, []);
        return <Widget name={name} />;
      }
    `);
    await writeFixture(root, "src/app/api/users/route.ts", `
      export async function GET() {
        return Response.json({ users: [] });
      }
    `);
    await writeFixture(root, "src/components/Widget.tsx", `
      export function Widget({ name }: { name: string }) {
        return <section>{name}</section>;
      }
    `);
    await writeFixture(root, "src/features/billing/calc-a.ts", duplicateFunction("calculateBillingA"));
    await writeFixture(root, "src/features/billing/calc-b.ts", duplicateFunction("calculateBillingB"));
    await writeFixture(root, "src/features/sloppy/Sloppy.ts", `
      type SloppyProps = { value: any };

      export function Sloppy({ value }: SloppyProps) {
        const rows = value ?? [];
        const label = "placeholder";
        try {
          return rows.length + label.length;
        } catch (error) {
          return 0;
        }
      }
    `);
    await writeFixture(root, "src/lib/a.ts", `import { b } from "./b"; export const a = b + 1;`);
    await writeFixture(root, "src/lib/b.ts", `import { a } from "./a"; export const b = a + 1;`);

    const project = createProject(root);
    const result = await scanProject({ project, scanId: "scan-test" });
    const issueKinds = new Set(result.issues.map((issue) => issue.kind));

    assert.equal(result.summary.fileCount, 8);
    assert.equal(result.summary.routeCount, 2);
    assert.equal(result.summary.featureCount >= 3, true);
    assert.equal(issueKinds.has("duplicate-logic"), true);
    assert.equal(issueKinds.has("dependency-cycle"), true);
    assert.equal(issueKinds.has("suspicious-async-effect"), true);
    assert.equal(issueKinds.has("weak-typing"), true);
    assert.equal(issueKinds.has("silent-fallback"), true);
    assert.equal(issueKinds.has("swallowed-error"), true);
    assert.equal(issueKinds.has("placeholder-code"), true);
    assert.equal(result.edges.some((edge) => edge.kind === "imports"), true);
    assert.equal(buildMermaid(result.nodes, result.edges, result.issues).startsWith("flowchart LR"), true);

    const slice = buildGraphSlice("overview", null, result.nodes, result.edges, result.issues, result.summary);
    const slopSlice = buildGraphSlice("slop", null, result.nodes, result.edges, result.issues, result.summary);
    const debugGuide = buildDebugGuide(slopSlice);
    const aiScan = buildLocalAiScan(slice, "gpt-5.5", "No API key in test.");
    const profile = buildSoftwareFactoryProfile(slice);
    const packet = buildFactoryPacket(profile);

    assert.equal(slopSlice.issues.length > 0, true);
    assert.equal(debugGuide.lanes.some((lane) => lane.id === "contracts" && lane.count >= 3), true);
    assert.equal(aiScan.mode, "setup-required");
    assert.equal(aiScan.generatedSkills.length > 0, true);
    assert.equal(aiScan.docs.length > 0, true);
    assert.match(debugGuide.mermaid, /Slop radar/);
    assert.equal(profile.agents.length, 5);
    assert.equal(profile.triggers.some((trigger) => trigger.id === "critical-signal"), true);
    assert.equal(profile.guardrails.some((guardrail) => guardrail.id === "local-only"), true);
    assert.equal(profile.skills.some((skill) => skill.id === "duplicate-consolidation"), true);
    assert.match(packet.markdown, /Software Factory Context/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("applies default, gitignore, and user ignore rules", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-ignore-"));
  try {
    await writeFixture(root, ".gitignore", "src/ignored-by-gitignore.ts\n");
    await writeFixture(root, "src/index.ts", "export const ok = true;");
    await writeFixture(root, "src/ignored-by-gitignore.ts", "export const hidden = true;");
    await writeFixture(root, "src/ignored-by-user.ts", "export const hidden = true;");
    await writeFixture(root, "node_modules/pkg/index.ts", "export const ignored = true;");

    const project = createProject(root, ["src/ignored-by-user.ts"]);
    const files = await discoverSourceFiles(project);
    const preview = await previewIgnoreRules(root, project.ignorePatterns);

    assert.deepEqual(files.map((file) => file.path), ["src/index.ts"]);
    assert.equal(preview.indexedCount, 1);
    assert.equal(preview.ignoredCount >= 3, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolves tsconfig path aliases, baseUrl imports, index files, and CommonJS imports", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-aliases-"));
  try {
    await writeFixture(root, "tsconfig.json", JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@features/*": ["src/features/*"],
          "@ui/*": ["src/ui/*"],
          "@pkg/*": ["node_modules/@pkg/*"],
        },
      },
    }));
    await writeFixture(root, "src/app/shop/page.tsx", `
      import { ShopView } from "@features/shop/view";
      import helper from "src/lib/helper";
      import { thing } from "@pkg/core";

      export default function ShopPage() {
        return <ShopView label={helper() + thing} />;
      }
    `);
    await writeFixture(root, "src/features/shop/view.tsx", `
      import { useShopState } from "./state";
      const button = require("@ui/Button");

      export function ShopView({ label }: { label: string }) {
        useShopState();
        return button.render(label);
      }
    `);
    await writeFixture(root, "src/features/shop/state.ts", "export function useShopState() { return true; }");
    await writeFixture(root, "src/ui/Button/index.tsx", "export const render = (label: string) => <button>{label}</button>;");
    await writeFixture(root, "src/lib/helper.ts", "export default function helper() { return 'Ready'; }");

    const result = await scanProject({ project: createProject(root), scanId: "scan-aliases" });

    assert.equal(result.summary.fileCount, 5);
    assert.equal(result.summary.routeCount, 1);
    assert.equal(result.summary.internalImportCount, 4);
    assert.equal(result.summary.externalDependencyCount, 1);
    assert.equal(result.summary.unresolvedImportCount, 0);
    assert.equal(result.edges.filter((edge) => edge.kind === "imports").length, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("surfaces unresolved local imports as visual warning nodes", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-unresolved-"));
  try {
    await writeFixture(root, "src/index.ts", `import { missing } from "./missing"; export const value = missing;`);

    const result = await scanProject({ project: createProject(root), scanId: "scan-unresolved" });

    assert.equal(result.summary.unresolvedImportCount, 1);
    assert.equal(result.issues.some((issue) => issue.kind === "unresolved-import"), true);
    assert.equal(result.nodes.some((node) => node.kind === "dependency" && node.metadata.unresolved === true), true);
    assert.equal(result.edges.some((edge) => edge.kind === "imports" && edge.metadata.unresolved === true), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("separates monorepo workspaces and visualizes types, permissions, and broken flows", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-monorepo-"));
  try {
    await writeFixture(root, "tsconfig.json", JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@scope/core": ["packages/core/src/index.ts"],
          "@scope/core/*": ["packages/core/src/*"],
        },
      },
    }));
    await writeFixture(root, "apps/web/src/App.tsx", `
      import type { SharedThing } from "@scope/core/types";
      import { formatThing } from "@scope/core";

      export function App({ thing }: { thing: SharedThing }) {
        fetch("/api/missing");
        localStorage.getItem("atlas");
        return <main>{formatThing(thing)}</main>;
      }
    `);
    await writeFixture(root, "packages/core/src/index.ts", `
      import type { SharedThing } from "./types";
      export function formatThing(thing: SharedThing) {
        return thing.name;
      }
    `);
    await writeFixture(root, "packages/core/src/types.ts", "export interface SharedThing { name: string }");
    await writeFixture(root, "tests/app.test.ts", `import { App } from "../apps/web/src/App"; export const subject = App;`);
    await writeFixture(root, "scripts/build.ts", `import { readFile } from "node:fs/promises"; export const read = readFile;`);

    const result = await scanProject({ project: createProject(root), scanId: "scan-monorepo" });
    const workspaceLabels = new Set(result.nodes.filter((node) => node.kind === "workspace").map((node) => node.label));
    const workspaceSlice = buildGraphSlice("workspace", null, result.nodes, result.edges, result.issues, result.summary);
    const contractsSlice = buildGraphSlice("contracts", null, result.nodes, result.edges, result.issues, result.summary);

    assert.equal(result.summary.fileCount, 5);
    assert.equal(result.summary.workspaceCount >= 4, true);
    assert.equal(workspaceLabels.has("apps/web"), true);
    assert.equal(workspaceLabels.has("packages/core"), true);
    assert.equal(workspaceLabels.has("tests/root"), true);
    assert.equal(result.summary.typeCount >= 1, true);
    assert.equal(result.summary.permissionCount >= 3, true);
    assert.equal(result.summary.brokenEdgeCount >= 1, true);
    assert.equal(result.edges.some((edge) => edge.kind === "imports" && edge.metadata.importMode === "type"), true);
    assert.equal(result.edges.some((edge) => edge.kind === "uses" && edge.metadata.permissionKind === "filesystem"), true);
    assert.equal(result.edges.some((edge) => edge.kind === "calls" && edge.metadata.health === "broken"), true);
    assert.equal(workspaceSlice.nodes.some((node) => node.kind === "workspace"), true);
    assert.equal(contractsSlice.nodes.some((node) => node.kind === "permission"), true);
    assert.equal(contractsSlice.nodes.some((node) => node.kind === "type"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detects startup, port, env, and timer readiness signals", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-runtime-"));
  try {
    await writeFixture(root, "package.json", JSON.stringify({
      name: "runtime-app",
      scripts: {
        dev: "vite --host 0.0.0.0 --port 3000",
        build: "vite build",
        start: "vite --host 0.0.0.0 --port 4000",
      },
    }, null, 2));
    await writeFixture(root, "Dockerfile", "FROM node:22\nEXPOSE 8080\n");
    await writeFixture(root, ".env", "PORT=5173\nNEXT_PUBLIC_API_URL=http://localhost:5173\n");
    await writeFixture(root, "src/server.ts", `
      const app = { listen(_port: number) { return true; } };
      app.listen(5000);
    `);
    await writeFixture(root, "src/app/page.tsx", `
      export default function Page() {
        useEffect(() => {
          setInterval(() => refresh(), 1000);
        }, []);
        return <main>Runtime</main>;
      }
    `);

    const result = await scanProject({ project: createProject(root), scanId: "scan-runtime" });
    const runtimeSlice = buildGraphSlice("runtime", null, result.nodes, result.edges, result.issues, result.summary);
    const issueKinds = new Set(result.issues.map((issue) => issue.kind));

    assert.equal(result.summary.fileCount, 2);
    assert.equal(result.summary.runtimePortCount >= 5, true);
    assert.equal(result.summary.startupIssueCount >= 3, true);
    assert.equal(result.summary.timingIssueCount >= 1, true);
    assert.equal(issueKinds.has("port-mismatch"), true);
    assert.equal(issueKinds.has("startup-problem"), true);
    assert.equal(issueKinds.has("env-contract-risk"), true);
    assert.equal(issueKinds.has("timer-without-cleanup"), true);
    assert.equal(result.nodes.some((node) => node.kind === "runtime"), true);
    assert.equal(result.edges.some((edge) => edge.kind === "configures" && edge.metadata.flow === "runtime"), true);
    assert.equal(runtimeSlice.nodes.some((node) => node.kind === "runtime"), true);
    assert.equal(runtimeSlice.issues.some((issue) => issue.kind === "port-mismatch"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("indexes a generated 4,000-file project", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-large-"));
  try {
    const writes: Promise<void>[] = [];
    for (let feature = 0; feature < 40; feature += 1) {
      for (let file = 0; file < 100; file += 1) {
        writes.push(writeFixture(root, `src/features/feature-${feature}/file-${file}.ts`, `export const value${file} = ${file};`));
      }
    }
    await Promise.all(writes);

    const project = createProject(root);
    const result = await scanProject({ project, scanId: "scan-large" });

    assert.equal(result.summary.fileCount, 4000);
    assert.equal(result.summary.featureCount, 40);
    assert.equal(result.summary.unresolvedImportCount, 0);
    assert.equal(result.nodes.some((node) => node.kind === "feature"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeFixture(root: string, path: string, content: string) {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

function createProject(rootPath: string, ignorePatterns: string[] = []): ProjectConfig {
  return {
    id: "fixture",
    name: "Fixture",
    rootPath,
    ignorePatterns,
    createdAt: "2026-05-06T00:00:00.000Z",
    updatedAt: "2026-05-06T00:00:00.000Z",
  };
}

function duplicateFunction(name: string): string {
  return `
    export function ${name}(items: number[]) {
      const taxRate = 0.0825;
      const subtotal = items.reduce((sum, item) => sum + item, 0);
      const discount = subtotal > 100 ? subtotal * 0.1 : 0;
      const taxable = subtotal - discount;
      const tax = taxable * taxRate;
      const total = taxable + tax;
      return { subtotal, discount, tax, total };
    }
  `;
}
