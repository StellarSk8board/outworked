<p align="center">
  <img src="build/icon.png" alt="Outworked" width="128" />
</p>

<h1 align="center">Outworked</h1>

<p align="center">
  <strong>Outworked is a desktop app that turns Claude into a team of AI employees.<br/>
  Hire agents. Give them roles. Watch them write code, interact with the web, send messages,<br/>
  and run scheduled tasks from a living pixel office on your desktop.</strong>
</p>
<p align="center">
  <em>Claude Code with a can-do attitude.</em>
</p>

<p align="center">
  <a href="https://github.com/StellarSk8board/outworked/releases"><strong>Download beta builds</strong></a>
</p>

<p align="center">
  <a href="https://github.com/StellarSk8board/outworked/releases"><img src="https://img.shields.io/badge/version-windows%20port%20beta-green.svg" alt="Version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL%203.0-blue.svg" alt="License: GPL-3.0" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20beta%20%C2%B7%20macOS-lightgrey.svg" alt="Platform" />
</p>

---

<p align="center">
  <img src="build/demo.gif" alt="Outworked Demo" width="720" />
</p>

---

<p align="center">
  <a href="https://github.com/StellarSk8board/outworked/releases/"><strong>Download</strong></a> ·
  <a href="#platform-status"><strong>Platform Status</strong></a> ·
  <a href="#how-it-works"><strong>How It Works</strong></a> ·
  <a href="#capabilities"><strong>Capabilities</strong></a> ·
  <a href="#windows-status"><strong>Windows Status</strong></a> ·
  <a href="#build-from-source"><strong>Build from Source</strong></a>
</p>

---

## Platform Status

Outworked started as a macOS-first Electron app and is now being actively ported to Windows.

**Current status:**
- **Windows:** active port, ready for limited beta testing
- **macOS:** original target platform
- **Linux:** packaging target exists, not yet treated as a primary platform

This repo is for the Windows-forward port effort. Some docs, screenshots, and feature examples still reflect the original macOS version. Where platform behavior differs, the Windows notes below are the source of truth.

---

## How It Works

1. **Hire agents** — Give each one a name, role, personality, model, and sprite
2. **Describe a goal** — Write what you want in plain English; the orchestrator breaks it into subtasks and routes them to the right agents automatically
3. **Watch them work** — Agents walk to their desks, write code, interact with the web, send messages, and run scheduled jobs in a visible office
4. **Ship it** — Let your agents handle the workflow end to end

---

## Capabilities

**Write and ship code** — Build features, fix bugs, open PRs, review each other's work, run tests, and deploy across multiple repos.

**Browse the web** — Research docs, scrape pages, fill out forms, take screenshots, and bring findings back through the built-in browser.

**Send and receive messages** — Reply to customers on Slack and other connected channels, or monitor a channel and trigger tasks when someone says the magic word.

**Run on a schedule** — Daily standups, weekly reports, hourly health checks, one-off reminders. Set a cron and let an agent handle it.

**Query databases** — Connect a PostgreSQL MCP server and let agents run queries, generate reports, or investigate production issues.

**Manage projects** — Create and triage GitHub issues, update Linear tickets, post status updates to Slack, and own real workflow instead of just code generation.

**Extend with MCP** — Every MCP server you add gives agents new capabilities. Internal APIs, monitoring dashboards, CMS tools, or anything with a tool interface can become part of the office.

---

## Features

- **Pixel Office** — A Phaser-powered world where your agents walk, sit at desks, and collaborate in real time
- **Build a Team** — Give each agent a name, role, personality, model, and sprite
- **Auto-Orchestration** — Describe a goal; the router breaks it into tasks and assigns them to the right agents
- **Multi-Agent Collaboration** — Agents talk to each other via a shared message bus
- **Claude Code Power** — Agents get local tool access with persistent sessions
- **MCP Server Support** — Connect agents to external tools and services
- **Messaging Channels** — Slack today, platform-specific channels where supported
- **Built-in Browser** — Chromium for navigation, forms, and screenshots
- **Triggers & Scheduling** — Cron, interval, one-time, and message-driven execution
- **SQLite Storage** — Local persistence for settings, channels, and history
- **Permission Gates** — Real-time approval UI for sensitive actions
- **Built-in Git** — Status, branches, and PR-oriented workflows without leaving the app
- **File Browser** — Live-updating workspace tree
- **Cost Dashboard** — Track spend per agent, session, and day
- **Background Mode** — Let agents keep working while the app is minimized

---

## Windows Status

### What works well in the port
- Electron shell and renderer architecture
- Windows process spawning and cleanup
- Claude CLI discovery on Windows
- `better-sqlite3` rebuild path for packaging
- Windows icon / NSIS packaging configuration
- Platform capability gating for macOS-only features like iMessage

### What to expect in beta
- Windows is **beta**, not GA
- Some macOS-oriented copy and examples may still exist elsewhere in the app or docs
- Code signing is not configured yet, so SmartScreen warnings are expected on first run
- Real-world Windows smoke testing is still the thing that matters most

### Platform-specific notes
- **iMessage is macOS-only** and is disabled on Windows
- Windows shell execution uses `cmd.exe` / Windows-native handling where needed
- If native module rebuilds fail locally, install the required Windows build tools and rerun install/build

---

## Build from Source

### Prerequisites
- Node.js installed
- Claude Code installed and authenticated
- For Windows builds, Visual Studio Build Tools may be required for native modules

### Development

```bash
git clone https://github.com/StellarSk8board/outworked.git
cd outworked
npm install
npm run electron:dev
```

### Packaging

```bash
npm run electron:build
```

Windows packaging targets NSIS. macOS and Linux packaging targets remain in the build config as well.

---

## Scripts

| Command                  | Description |
| ------------------------ | ----------- |
| `npm run dev`            | Start Vite dev server (renderer only) |
| `npm run electron:dev`   | Build and launch the Electron app in dev mode |
| `npm run electron:build` | Package distributables |
| `npm run generate-ico`   | Regenerate the Windows `.ico` from the PNG source |

---

## Tech Stack

| Layer    | Technology |
| -------- | ---------- |
| Desktop  | Electron |
| Frontend | React 19 + TypeScript + Tailwind CSS |
| Build    | Vite |
| Graphics | Phaser 3 |
| Storage  | SQLite (`better-sqlite3`) |
| AI       | Claude Code SDK |

---

## Project Positioning

Outworked is not trying to be a generic chat wrapper. It is a desktop environment for coordinating multiple Claude-powered agents with visible presence, shared workspace context, tool access, and automation workflows.

The Windows port goal is simple: keep what makes the app fun and useful, remove the macOS assumptions that break it, and get it stable enough to be genuinely usable on Windows instead of merely "technically buildable."
