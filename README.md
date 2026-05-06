# Bloodhoud

Bloodhoud is a local codebase visualizer for TS, JS, and React projects. It indexes large repositories, separates monorepos by apps, packages, tests, and shared surfaces, then turns architecture, routes, dependencies, permissions, runtime contracts, duplicate logic, and issue signals into inspectable React Flow canvases and Mermaid packets.

The app is local-first. Source stays on the machine, scans are evidence-based, and AI review can connect through the local Codex app-server or fall back to export packets.

## What It Does

- Indexes projects with `.gitignore`, default excludes, and custom ignore rules.
- Parses TS, JS, JSX, and TSX with feature, route, dependency, type, permission, runtime, and issue graph nodes.
- Visualizes graph slices for overview, workspaces, features, routes, dependencies, contracts, runtime, duplicate clusters, and warning evidence.
- Flags explainable static signals such as unresolved imports, cycles, route dead ends, duplicated logic, weak typing, swallowed errors, startup problems, port mismatches, timing risks, and env contract drift.
- Generates Mermaid diagrams, AI evidence packets, codebase story paths, learning paths, and cleanup guidance for visual debugging.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verification

```bash
npm run typecheck
npm test
npm run lint
npm run build
```
