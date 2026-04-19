# Deferred Items — Phase 09

## Pre-existing TypeScript Errors (out of scope)

These errors existed before Phase 09 began (verified by git stash test):

1. `src/extension.ts(662)` — `{ type: 'chat:triggerInterrupt' as any }` not in HostToWebviewMessage union. The message type `chat:triggerInterrupt` was never added to the union — uses `as any` workaround.

2. `src/panels/ChatManager.ts(160)` — Object literal has `reason` property not in HostToWebviewMessage union.

3. `src/panels/SidebarViewProvider.ts(42,43)` — `workspace:configure` not in WebviewToHostMessage union. The sidebar sends this message but the type was never added.

These should be fixed in a cleanup phase or as part of Plan 09-02 when SidebarViewProvider is updated to add remote workspace UI.
