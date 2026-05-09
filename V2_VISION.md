# HarnessTune v2.0 — Remote Agent Management

## Where We Are (v1.0 Complete)

HarnessTune v1.0 is a VSCode extension for managing local AI agent systems. It provides:

- **Workspace model**: each workspace encapsulates one agent system with its own config, logs, and state
- **Sidebar**: workspace list with status indicators, right-click context menu for configure/remove
- **Dashboard**: agent cards with live status, detail panel, pause/resume/stop controls
- **Agent schematic**: SVG topology graph showing agent relationships with live status updates, zoom/pan, fit-to-view
- **Chat interface**: webview-based chat panel for talking to agents (Claude Code backend with interrupt support)
- **Workspace scaffolding**: create workspaces from templates (claude-code-basic, multi-agent, openclaw-basic)
- **Adapter pattern**: pluggable backend integrations — Claude Code (via hooks) and OpenClaw (via JSONL file tailing) implemented
- **Status bar**: aggregate workspace health at a glance
- **Notification service**: error toasts and workspace status tracking

All of this works **locally** — the agents and the extension run on the same machine.

## The Problem

In practice, agent systems run across multiple machines. A typical setup:

- **Local Mac**: the engineer's workstation, running HarnessTune
- **Remote Mac 1**: running an OpenClaw agent system
- **Remote Mac 2 (Paperclip)**: running a Claude Code instance
- **Cloud VM**: running another agent cluster

Today, managing these requires SSH-ing into each machine individually. There's no unified view, no way to get reports without logging in, and no way to send instructions without opening a terminal to each machine.

## What v2.0 Solves

v2.0 turns HarnessTune from a local agent monitor into a **remote command center**. From one VSCode window on your local machine, you can see all your agents across all machines, read their reports, and talk to them.

## Architecture: The Relay Model

Instead of complex networking (WebSocket servers, port forwarding, tunnels), v2.0 uses a **mailbox pattern** via a simple REST relay:

```
Remote Agent          Relay (cloud)           HarnessTune (local)
     |                     |                        |
     |-- upload report --->|                        |
     |                     |<--- fetch reports -----|
     |                     |                        |
     |                     |<--- post feedback -----|
     |<-- poll for msgs ---|                        |
     |                     |                        |
```

### Three Components

**1. harnesstune-relay** — A lightweight REST API deployed on Vercel with a Turso (SQLite) database. It acts as a mailbox: agents push reports up, the command center reads them down. Messages and feedback flow the other direction. No WebSocket, no persistent connections, no port management. Just HTTP.

- Hosted version available for convenience (free tier: Vercel + Turso 9GB)
- Fully self-hostable — users can deploy their own relay with one command
- No vendor lock-in — it's just SQLite behind a REST API

**2. harnesstune-agent** — A small CLI package (`npx harnesstune-agent`) that runs on each remote machine alongside the agent system. It:

- Registers with the relay using a generated API token
- Monitors the local agent system (tails logs, reads state files)
- Uploads reports to the relay on a configurable schedule (e.g., every 6 hours, daily)
- Polls the relay for new messages/instructions from the command center
- Executes received instructions by routing them to the local agent

The remote machine only needs Node.js. No VSCode, no open ports, no special networking.

**3. harnesstune (extension, updated)** — The existing VSCode extension gains a new `RemoteAdapter` that connects to the relay. Remote workspaces appear in the sidebar alongside local ones — same UI, same interactions, different transport layer.

### Authentication

Simple token-based auth:

- When an agent registers with the relay, it receives a unique API token
- The user copies that token into HarnessTune when adding the remote workspace
- Tokens are stored in VSCode's SecretStore (already built in v1.0)
- Each agent can only read/write its own workspace's data

### Networking

HarnessTune doesn't solve networking — it sidesteps it entirely. Both the agent and the command center make outbound HTTPS requests to the relay. No inbound ports, no NAT traversal, no tunnels required. If the machine can reach the internet, it works.

For air-gapped or private networks, users self-host the relay on their LAN.

## Core Features

### 1. Daily Briefing Reports

Agents generate structured snapshots of their current state at configurable intervals:

- **Goals**: what the agent is working toward
- **Current progress**: what's been accomplished since the last report
- **Blockers**: anything the agent is stuck on or waiting for
- **Next steps**: what the agent plans to do next
- **Metrics**: tokens used, tasks completed, errors encountered

These appear in HarnessTune as a timeline — you open the app in the morning and see what every agent did overnight.

### 2. Ralph Loop Progress Reports

When an agent is running an iterative improvement loop (ralph loop), it generates iteration-specific reports:

- **Iteration number**: which cycle this is
- **Baseline metrics**: where it started
- **Current metrics**: where it is now
- **Delta**: how much better (or worse) this iteration was
- **What changed**: what the agent tried differently
- **Cumulative progress**: overall improvement from iteration 1 to now

These render as a progress chart in HarnessTune — you can see at a glance whether an agent is converging, plateauing, or regressing.

### 3. Async Chat / Feedback

You can write messages to any remote agent directly from HarnessTune:

- Comment on a report ("good progress on X, but deprioritize Y")
- Give new instructions ("switch to approach B for the auth module")
- Ask questions ("why did error count spike in iteration 4?")
- Request changes ("implement feature X next")

Messages are posted to the relay. The agent picks them up on its next poll cycle, processes them, and can respond. It's like an async Slack channel per agent, integrated into the HarnessTune UI.

### 4. Remote Workspace Management

From the sidebar:

- **Add Remote Workspace**: enter relay URL + agent token
- **View Reports**: click a remote workspace to see its briefings and ralph loop reports
- **Send Message**: open chat panel for any remote agent
- **Configure**: change report schedule, update token
- **Remove**: disconnect from a remote agent

Remote workspaces show the same status indicators as local ones — running, idle, error — based on the latest report data.

## Tech Stack

| Component | Stack | Hosting |
|-----------|-------|---------|
| Relay API | TypeScript, Hono or Express | Vercel (serverless) |
| Relay DB | Turso (libSQL / SQLite) | Turso cloud or self-hosted |
| Agent CLI | TypeScript, Node.js | npm package |
| Extension | TypeScript, React, VSCode API | Existing v1.0 codebase |

## What v2.0 Does NOT Include

- **Real-time streaming**: this is async/polling, not live terminal streaming. Real-time can come in v3.
- **Agent orchestration**: v2.0 is observe + communicate. Automated multi-agent coordination is future scope.
- **Multi-user / team features**: single user for now. Team features (shared relay, permissions, audit log) are v3+.
- **Mobile app**: VSCode only. A mobile companion for reading reports on the go could come later.

## Summary

v1.0 gave us a local agent IDE. v2.0 makes it a remote command center. The relay model keeps it simple — no complex networking, no server daemons, no port forwarding. Just HTTP to a shared mailbox. Agents talk to the relay, you talk to the relay, everyone stays in sync.
