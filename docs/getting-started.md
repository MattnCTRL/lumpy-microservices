# Getting Started

How to install, configure, and run Lumpy locally.

## Prerequisites

- **Node.js 22+** (`node -v`). An `.nvmrc` is provided; `nvm use` will select it.
- **`tmux`** on the host that runs the orchestrator. This is the backbone of the
  session engine.
  - macOS: `brew install tmux`
  - Debian/Ubuntu: `sudo apt-get install tmux`
- **`claude` CLI** (optional) if you want sessions to launch real Claude Code.
  Without it, point a session at any command (e.g. `bash`) to try the engine.

## Install

```bash
npm install
```

This installs all workspaces (`apps/*`, `packages/*`). Two native modules are
built during install: `node-pty` (terminal control) and `better-sqlite3`
(metadata store). On macOS this requires the Xcode command line tools
(`xcode-select --install`).

## Configure

```bash
cp .env.example .env
```

The defaults run everything on localhost. See [configuration.md](configuration.md)
for every option.

## Run

Run both apps together:

```bash
npm run dev
```

Or run them individually:

```bash
npm run dev:orchestrator   # http://127.0.0.1:4317
npm run dev:web            # http://127.0.0.1:3000
```

Open the web UI at `http://127.0.0.1:3000`.

## First session

1. In the web UI, click **New session**.
2. Give it a name, a workspace directory, and a command (defaults to `claude`).
3. The session opens in a live terminal. Type into it as you would any
   terminal; output streams back in real time.
4. Closing the browser does not stop the session — it keeps running in `tmux`.
   Reopen the UI to reattach.

## Verifying the engine without `claude`

To confirm the session pipeline works independently of Claude Code, create a
session with the command set to `bash`. You should get an interactive shell in
the chosen workspace, streamed to the browser.

## Useful checks

```bash
npm run typecheck     # type-check every workspace
npm run format:check  # verify formatting
tmux ls               # list live sessions (look for the lumpy- prefix)
```
