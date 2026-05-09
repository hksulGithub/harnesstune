---
phase: "09"
plan: "02"
subsystem: "remote-workspace-ui"
tags: [remote-workspace, sidebar, webview, react, extension-commands, vscode-api]
dependency_graph:
  requires: [09-01]
  provides: [remote-workspace-connect-command, remote-workspace-sidebar-ui]
  affects: [extension-commands, sidebar-webview, workspace-registry]
tech_stack:
  added: []
  patterns: [vscode-quickinput-flow, relay-token-secret-store, sentinel-rootpath]
key_files:
  created: []
  modified:
    - src/extension.ts
    - src/panels/SidebarViewProvider.ts
    - src/types/messages.ts
    - src/types/workspace.ts
    - src/registry/WorkspaceRegistry.ts
    - package.json
    - src/webview/sidebar/App.tsx
    - src/webview/sidebar/components/WorkspaceItem.tsx
    - src/webview/sidebar/styles/sidebar.css
decisions:
  - "3-step QuickInput flow: relay URL then token (password), auto health-check + discoverChannelId — no manual channelId prompt"
  - "sentinel rootPath 'remote://{channelId}' avoids empty-string conflicts for remote workspaces in registry"
  - "per-workspace token key 'harnesstune.relay.{workspaceId}' scoped to SecretStore"
  - "openWorkspace deferred for remote mode with informational message (Phase 10)"
  - "configureRemoteWorkspace Rename sub-command uses registry.update({name}) requiring 'name' added to update() Pick type"
metrics:
  duration_minutes: 90
  completed_date: "2026-04-19"
  tasks_completed: 2
  tasks_total: 4
  files_modified: 9
---

# Phase 09 Plan 02: Remote Workspace Connect Command & Sidebar UI Summary

Wired RemoteAdapter into extension.ts with full lifecycle management, created the addRemoteWorkspace QuickInput command (relay URL + token, auto health-check), and updated the sidebar to display remote workspaces with cloud badges, relay hostname subtitles, stale hints, and remote-specific context menus.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Extension wiring: RemoteAdapter lifecycle, addRemoteWorkspace command, removeWorkspace token cleanup, SidebarViewProvider message routing | e5fff6f |
| 2 | Sidebar UI: WorkspaceItem cloud badge, relay hostname subtitle, stale hint, Message Agent menu; App connect buttons; CSS classes | e9ad698 |

## Tasks Deferred (Checkpoint)

| Task | Description | Reason |
|------|-------------|--------|
| 3 | Human verification of remote workspace sidebar rendering | Checkpoint: human-verify |
| 4 | Connect-section button layout (display:flex + gap) | After checkpoint |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed configureRemoteWorkspace Rename case updating wrong field**
- Found during: Task 1
- Issue: Rename sub-command used `registry.update(workspaceId, { status: workspace.status })` instead of updating `name`
- Fix: Changed to `registry.update(workspaceId, { name: newName })`; added 'name' to `update()` Pick type in `IWorkspaceRegistry` and `WorkspaceRegistry.ts`
- Files modified: src/types/workspace.ts, src/registry/WorkspaceRegistry.ts
- Commit: e5fff6f

**2. [Rule 2 - Missing Type] Added workspace:configure to WebviewToHostMessage union**
- Found during: Task 1
- Issue: `workspace:configure` was missing from WebviewToHostMessage, causing TypeScript to narrow `msg` to `never` in SidebarViewProvider switch
- Fix: Added `| { type: 'workspace:configure'; workspaceId: string }` to messages.ts union
- Files modified: src/types/messages.ts
- Commit: e5fff6f

**3. [Rule 1 - Bug] Fixed duplicate/conflicting WorkspaceStatus import in extension.ts**
- Found during: Task 1
- Issue: Separate `import type { WorkspaceStatus }` line conflicted with consolidated types import
- Fix: Consolidated into single `import type { WorkspaceStatus, AgentEvent } from './types'` line
- Commit: e5fff6f

### CSS file path deviation
- Plan referenced `src/webview/sidebar/sidebar.css` but actual path is `src/webview/sidebar/styles/sidebar.css`
- Applied CSS edits to the correct path

### Pre-existing errors (deferred, not introduced by this plan)
- extension.ts(724): `chat:triggerInterrupt` as any cast
- ChatManager.ts(160): reason property not in HostToWebviewMessage
- All JSX errors in webview files compiled under extension tsconfig (separate webview tsconfig handles them correctly)

## Self-Check: PASSED

- FOUND: src/extension.ts
- FOUND: src/webview/sidebar/App.tsx
- FOUND: src/webview/sidebar/components/WorkspaceItem.tsx
- FOUND: src/webview/sidebar/styles/sidebar.css
- FOUND commit e5fff6f (Task 1)
- FOUND commit e9ad698 (Task 2)
