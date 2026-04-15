---
phase: 01-foundation-extension-scaffold-registry-sidebar
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - tsconfig.json
  - tsconfig.extension.json
  - tsconfig.webview.json
  - esbuild.mjs
  - src/extension.ts
  - src/types/workspace.ts
  - src/types/messages.ts
  - src/types/status.ts
  - .vscodeignore
  - .gitignore
autonomous: true
requirements: [FOUN-01, FOUN-02]

must_haves:
  truths:
    - "Extension activates in VSCode without errors"
    - "Commands register with HarnessTune: prefix in Command Palette"
    - "esbuild produces both CJS bundle for extension host and ESM bundle for webview"
  artifacts:
    - path: "package.json"
      provides: "Extension manifest with activationEvents, contributes.commands, contributes.viewsContainers, contributes.views"
      contains: "harnesstune"
    - path: "src/extension.ts"
      provides: "Extension entry point with activate/deactivate exports"
      exports: ["activate", "deactivate"]
    - path: "esbuild.mjs"
      provides: "Dual-target build script (CJS extension host + ESM webview)"
      contains: "entryPoints"
    - path: "src/types/workspace.ts"
      provides: "WorkspaceRecord interface and registry schema types"
      exports: ["WorkspaceRecord", "WorkspaceRegistry", "WorkspaceStatus"]
    - path: "src/types/messages.ts"
      provides: "Typed postMessage contracts for host-webview communication"
      exports: ["HostToWebviewMessage", "WebviewToHostMessage"]
    - path: "src/types/status.ts"
      provides: "Status indicator types with color + shape pairs"
      exports: ["AgentStatus", "StatusIndicator"]
  key_links:
    - from: "package.json"
      to: "src/extension.ts"
      via: "main field pointing to dist/extension.js"
      pattern: '"main".*dist/extension'
    - from: "esbuild.mjs"
      to: "src/extension.ts"
      via: "extension host entry point"
      pattern: "src/extension.ts"
---

<objective>
Scaffold the HarnessTune VSCode extension from scratch: package.json manifest, TypeScript configuration (separate tsconfigs for extension host and webview runtimes), esbuild dual-target build script, extension entry point, and all shared type definitions that downstream plans depend on.

Purpose: Every subsequent plan imports types and builds on this scaffold. Getting the build pipeline and type contracts right here prevents rework.
Output: A buildable, activatable VSCode extension with all shared interfaces defined.
</objective>

<execution_context>
@/Users/hksul/.claude/get-shit-done/workflows/execute-plan.md
@/Users/hksul/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/research/SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create extension scaffold with dual-target esbuild build</name>
  <files>package.json, tsconfig.json, tsconfig.extension.json, tsconfig.webview.json, esbuild.mjs, src/extension.ts, .vscodeignore, .gitignore</files>
  <read_first>
    - .planning/research/SUMMARY.md (stack decisions: esbuild, tsconfig split, CJS/ESM targets)
    - .planning/ROADMAP.md (Phase 1 key deliverables for extension scaffold specifics)
  </read_first>
  <action>
Create the complete extension scaffold:

**package.json:**
- `"name": "harnesstune"`
- `"displayName": "HarnessTune"`
- `"description": "Agent Harness Engineering IDE"`
- `"version": "0.1.0"`
- `"engines": { "vscode": "^1.96.0" }`
- `"main": "./dist/extension.js"`
- `"activationEvents": []` (commands auto-activate since VSCode 1.74)
- `"contributes.commands"`: Register these commands with `HarnessTune:` category:
  - `harnesstune.connectWorkspace` — title: "Connect Workspace"
  - `harnesstune.removeWorkspace` — title: "Remove Workspace"
  - `harnesstune.openWorkspace` — title: "Open Workspace"
  - `harnesstune.refreshSidebar` — title: "Refresh Sidebar"
  - `harnesstune.showDashboard` — title: "Show Dashboard"
- `"contributes.viewsContainers.activitybar"`: one entry: `{ "id": "harnesstune-sidebar", "title": "HarnessTune", "icon": "resources/icon.svg" }`
- `"contributes.views.harnesstune-sidebar"`: one entry: `{ "type": "webview", "id": "harnesstune.sidebarView", "name": "Workspaces" }`
- `"scripts"`: `"build": "node esbuild.mjs"`, `"watch": "node esbuild.mjs --watch"`, `"package": "vsce package"`
- `"devDependencies"`: `"@types/vscode": "^1.96.0"`, `"@types/node": "^20.0.0"`, `"esbuild": "^0.24.0"`, `"typescript": "^5.6.0"`, `"@types/react": "^18.3.0"`, `"@types/react-dom": "^18.3.0"`
- `"dependencies"`: `"react": "^18.3.0"`, `"react-dom": "^18.3.0"`

**tsconfig.json** (base, extends nothing):
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist"
  },
  "exclude": ["node_modules", "dist"]
}
```

**tsconfig.extension.json** (NO DOM lib — extension host is Node.js):
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/webview/**/*", "node_modules", "dist"]
}
```

**tsconfig.webview.json** (WITH DOM lib — webview is browser):
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx"
  },
  "include": ["src/webview/**/*", "src/types/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**esbuild.mjs:**
```javascript
import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

// Extension host bundle (CJS, Node.js, external vscode)
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  minify: false,
};

// Sidebar webview bundle (ESM, browser)
const sidebarConfig = {
  entryPoints: ['src/webview/sidebar/index.tsx'],
  bundle: true,
  outfile: 'dist/webview/sidebar.js',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: false,
  define: { 'process.env.NODE_ENV': '"development"' },
};

if (isWatch) {
  const extCtx = await esbuild.context(extensionConfig);
  const sidebarCtx = await esbuild.context(sidebarConfig);
  await Promise.all([extCtx.watch(), sidebarCtx.watch()]);
  console.log('[esbuild] Watching for changes...');
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(sidebarConfig),
  ]);
  console.log('[esbuild] Build complete.');
}
```

**src/extension.ts:**
```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  console.log('HarnessTune extension activating...');

  // Register commands (implementations added in Plan 02 and Plan 03)
  const connectCmd = vscode.commands.registerCommand(
    'harnesstune.connectWorkspace',
    () => vscode.window.showInformationMessage('HarnessTune: Connect Workspace (not yet implemented)')
  );
  const removeCmd = vscode.commands.registerCommand(
    'harnesstune.removeWorkspace',
    () => vscode.window.showInformationMessage('HarnessTune: Remove Workspace (not yet implemented)')
  );
  const openCmd = vscode.commands.registerCommand(
    'harnesstune.openWorkspace',
    () => vscode.window.showInformationMessage('HarnessTune: Open Workspace (not yet implemented)')
  );
  const refreshCmd = vscode.commands.registerCommand(
    'harnesstune.refreshSidebar',
    () => vscode.window.showInformationMessage('HarnessTune: Refresh Sidebar (not yet implemented)')
  );
  const dashboardCmd = vscode.commands.registerCommand(
    'harnesstune.showDashboard',
    () => vscode.window.showInformationMessage('HarnessTune: Show Dashboard (not yet implemented)')
  );

  context.subscriptions.push(connectCmd, removeCmd, openCmd, refreshCmd, dashboardCmd);

  console.log('HarnessTune extension activated.');
}

export function deactivate(): void {
  console.log('HarnessTune extension deactivated.');
}
```

**.vscodeignore:**
```
.vscode/**
src/**
node_modules/**
.planning/**
tsconfig*.json
esbuild.mjs
.gitignore
*.md
```

**.gitignore:**
```
node_modules/
dist/
*.vsix
.vscode-test/
```

Create an empty `resources/` directory with a placeholder `icon.svg` (a simple 24x24 SVG with a gear icon outline):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
```
  </action>
  <verify>
    <automated>cd /Users/hksul/Dropbox/Research_obsidian/ClaudeVault2/agents/Ethan/harnesstune && npm install && node esbuild.mjs && test -f dist/extension.js && echo "BUILD OK"</automated>
  </verify>
  <acceptance_criteria>
    - package.json contains `"name": "harnesstune"` and `"main": "./dist/extension.js"`
    - package.json contributes.commands array has 5 entries, all with category or title containing "HarnessTune" or command prefix "harnesstune."
    - package.json contributes.viewsContainers.activitybar contains id "harnesstune-sidebar"
    - package.json contributes.views["harnesstune-sidebar"] contains type "webview" and id "harnesstune.sidebarView"
    - tsconfig.extension.json does NOT contain "DOM" in lib array
    - tsconfig.webview.json contains "DOM" in lib array and "jsx": "react-jsx"
    - esbuild.mjs contains two configs: one with `format: 'cjs'` and `platform: 'node'`, one with `format: 'esm'` and `platform: 'browser'`
    - src/extension.ts exports `activate` and `deactivate` functions
    - `node esbuild.mjs` exits 0 and produces dist/extension.js
  </acceptance_criteria>
  <done>Extension scaffold builds successfully with esbuild, producing dist/extension.js (CJS). All five HarnessTune commands are registered in package.json. Two tsconfigs correctly separate Node.js and browser runtimes.</done>
</task>

<task type="auto">
  <name>Task 2: Define shared type contracts for workspace, messages, and status</name>
  <files>src/types/workspace.ts, src/types/messages.ts, src/types/status.ts, src/types/index.ts</files>
  <read_first>
    - .planning/REQUIREMENTS.md (WKSP-01, WKSP-03, WKSP-04, SIDE-01, SIDE-02 for type shapes)
    - .planning/research/SUMMARY.md (OTel alignment, typed postMessage contracts, status indicator approach)
    - src/extension.ts (verify command IDs match type definitions)
  </read_first>
  <action>
Create the shared type definitions that Plan 02 and Plan 03 depend on.

**src/types/workspace.ts:**
```typescript
/** Status of an agent workspace */
export type WorkspaceStatus = 'running' | 'idle' | 'warning' | 'error' | 'unknown';

/** A workspace record stored in the registry JSON file */
export interface WorkspaceRecord {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Human-readable workspace name */
  name: string;
  /** Absolute path to the agent workspace directory */
  rootPath: string;
  /** Current status of the workspace */
  status: WorkspaceStatus;
  /** ISO 8601 timestamp when workspace was added to registry */
  addedAt: string;
  /** ISO 8601 timestamp of last status update */
  lastUpdatedAt: string;
  /** Number of currently running agents in this workspace */
  runningAgentCount: number;
  /** Number of errors since last clear */
  errorCount: number;
}

/** Shape of the registry JSON file stored at globalStorageUri */
export interface WorkspaceRegistryData {
  version: 1;
  workspaces: WorkspaceRecord[];
}

/** Interface for workspace registry operations */
export interface IWorkspaceRegistry {
  getAll(): WorkspaceRecord[];
  getById(id: string): WorkspaceRecord | undefined;
  add(name: string, rootPath: string): Promise<WorkspaceRecord>;
  remove(id: string): Promise<void>;
  update(id: string, changes: Partial<Pick<WorkspaceRecord, 'status' | 'runningAgentCount' | 'errorCount'>>): Promise<void>;
  onDidChange: import('vscode').Event<WorkspaceRecord[]>;
}
```

**src/types/status.ts:**
```typescript
/** Status indicator shape — paired with color for accessibility (SIDE-02) */
export type StatusShape = 'circle' | 'triangle' | 'square' | 'diamond';

/** Maps workspace status to visual indicator */
export interface StatusIndicator {
  status: import('./workspace').WorkspaceStatus;
  color: string;         // VSCode CSS variable name (e.g., '--vscode-testing-iconPassed')
  shape: StatusShape;
  label: string;         // Accessible text label
  svgPath: string;       // SVG path data for the shape
}

/** Predefined status indicator mappings — color + shape, never color alone */
export const STATUS_INDICATORS: Record<import('./workspace').WorkspaceStatus, StatusIndicator> = {
  running: {
    status: 'running',
    color: 'var(--vscode-testing-iconPassed)',
    shape: 'circle',
    label: 'Running',
    svgPath: 'M12 2a10 10 0 110 20 10 10 0 010-20z',  // filled circle
  },
  idle: {
    status: 'idle',
    color: 'var(--vscode-foreground)',
    shape: 'circle',
    label: 'Idle',
    svgPath: 'M12 4a8 8 0 100 16 8 8 0 000-16z',      // outline circle (stroke only)
  },
  warning: {
    status: 'warning',
    color: 'var(--vscode-editorWarning-foreground)',
    shape: 'triangle',
    label: 'Warning',
    svgPath: 'M12 2L2 22h20L12 2z',                     // triangle
  },
  error: {
    status: 'error',
    color: 'var(--vscode-errorForeground)',
    shape: 'diamond',
    label: 'Error',
    svgPath: 'M12 2l10 10-10 10L2 12 12 2z',            // diamond
  },
  unknown: {
    status: 'unknown',
    color: 'var(--vscode-disabledForeground)',
    shape: 'square',
    label: 'Unknown',
    svgPath: 'M4 4h16v16H4z',                            // square
  },
};

export type AgentStatus = import('./workspace').WorkspaceStatus;
```

**src/types/messages.ts:**
```typescript
import type { WorkspaceRecord, WorkspaceStatus } from './workspace';

/** Messages from extension host to webview */
export type HostToWebviewMessage =
  | { type: 'workspaces:update'; workspaces: WorkspaceRecord[] }
  | { type: 'workspace:statusChanged'; workspaceId: string; status: WorkspaceStatus; runningAgentCount: number; errorCount: number }
  | { type: 'workspace:removed'; workspaceId: string }
  | { type: 'workspace:added'; workspace: WorkspaceRecord };

/** Messages from webview to extension host */
export type WebviewToHostMessage =
  | { type: 'workspace:connect'; name: string; rootPath: string }
  | { type: 'workspace:remove'; workspaceId: string }
  | { type: 'workspace:open'; workspaceId: string }
  | { type: 'workspace:refresh' }
  | { type: 'ready' };
```

**src/types/index.ts:**
```typescript
export * from './workspace';
export * from './messages';
export * from './status';
```
  </action>
  <verify>
    <automated>cd /Users/hksul/Dropbox/Research_obsidian/ClaudeVault2/agents/Ethan/harnesstune && npx tsc --project tsconfig.extension.json --noEmit && echo "TYPES OK"</automated>
  </verify>
  <acceptance_criteria>
    - src/types/workspace.ts exports WorkspaceRecord interface with fields: id (string), name (string), rootPath (string), status (WorkspaceStatus), addedAt (string), lastUpdatedAt (string), runningAgentCount (number), errorCount (number)
    - src/types/workspace.ts exports WorkspaceRegistryData with `version: 1` and `workspaces: WorkspaceRecord[]`
    - src/types/workspace.ts exports IWorkspaceRegistry with methods: getAll, getById, add, remove, update, onDidChange
    - src/types/status.ts exports STATUS_INDICATORS object with keys: running, idle, warning, error, unknown
    - Each STATUS_INDICATORS entry has both a `color` (VSCode CSS variable) and a `shape` (StatusShape) — never color alone
    - src/types/messages.ts exports HostToWebviewMessage union type with discriminant field `type`
    - src/types/messages.ts exports WebviewToHostMessage union type with discriminant field `type`
    - src/types/index.ts re-exports all three modules
    - `npx tsc --project tsconfig.extension.json --noEmit` exits 0
  </acceptance_criteria>
  <done>All shared type contracts are defined and type-check successfully. WorkspaceRecord, message contracts, and status indicators are ready for Plan 02 (registry implementation) and Plan 03 (sidebar UI).</done>
</task>

</tasks>

<verification>
- `npm install` completes without errors
- `node esbuild.mjs` produces `dist/extension.js` without errors
- `npx tsc --project tsconfig.extension.json --noEmit` passes
- package.json has all 5 commands registered under `contributes.commands`
- package.json has the sidebar view container and webview view registered
- All type files exist and export the documented interfaces
</verification>

<success_criteria>
- Extension scaffold is buildable and all types compile
- Every downstream plan can import from `src/types/` without modification
- esbuild produces CJS bundle at dist/extension.js
- package.json manifest is complete with commands, views, and activation events
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation-extension-scaffold-registry-sidebar/01-01-SUMMARY.md`
</output>
