---
phase: 17
plan: 2
title: Notification delivery + status bar badge + extension wiring
status: complete
commits:
  - e9b938e  # feat(alerts): add alert badge to status bar
  - b7fa2e9  # feat(alerts): wire AlertEngine and notification delivery into extension
files_modified:
  - src/statusbar/StatusBarManager.ts
  - src/extension.ts
---

# Plan 2 Summary: Notification Delivery + Status Bar Badge + Extension Wiring

## What was done

### Task 1: Alert badge on StatusBarManager
- Added `private alertCount = 0` field
- Added `public setAlertCount(count: number)` method
- Added `public clearAlertBadge()` method
- Updated `updateStatusBar()` to show `$(bell) N` when alerts are active
- Uses `statusBarItem.warningBackground` (amber) for either alerts or errors

### Task 2: Extension wiring
- Added imports for `AlertEngine`, `LocalFleetProvider`, `RemoteFleetProvider`, `FleetDataProvider`, `AlertCycleSummary`
- Created inline `compositeFleetProvider` object merging local + remote fleet data
- Instantiated `AlertEngine` with composite provider and registry, started polling
- Wired `onDidDetectAlerts` handler: batched summary toast via `showWarningMessage` with "View Fleet Dashboard" action
- Status bar badge updates on alert transitions, clears when dashboard opened
- Remote fleet clients registered on `connectWorkspace()`, removed on `removeWorkspace`
- `wireDashboardMessageHandler()` calls `panel.setFleetProvider(compositeFleetProvider)`

## Deviations from plan
- None — all acceptance criteria met exactly as specified

## Verification
- `npx tsc --noEmit -p tsconfig.extension.json` exits 0
