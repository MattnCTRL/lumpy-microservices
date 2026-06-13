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

## Monitoring a server (Fleet)

Open the **Fleet** tab, click **Add**, and register a server (name + address).
To see it report without a real host, stream synthetic metrics with the demo
agent:

```bash
node scripts/demo-agent.mjs <serverId> --interval 1500
```

The server flips to `online` and its metric cards update live. See
[fleet.md](fleet.md) for the real ingestion contract.

To report **real** metrics from a machine, run the agent on it — it
self-registers and starts streaming actual CPU/memory/disk/load:

```bash
LUMPY_URL=http://127.0.0.1:4317 npm run start -w @lumpy/agent
```

See [agent.md](agent.md) for configuration and deployment.

## Verifying the engine without `claude`

To confirm the session pipeline works independently of Claude Code, create a
session with the command set to `bash`. You should get an interactive shell in
the chosen workspace, streamed to the browser.

## Testing

Tests use Node's built-in test runner (via `tsx`), so there are no extra
dependencies:

```bash
npm test              # run every workspace's tests
npm test -w @lumpy/orchestrator
```

Pure-logic tests (e.g. activity detection) run anywhere. Some tests are
integration tests that spawn real `tmux` sessions; they skip automatically when
`tmux` is not installed (e.g. in CI without it).

## Useful checks

```bash
npm run typecheck     # type-check every workspace
npm test              # run all tests
npm run format:check  # verify formatting
tmux ls               # list live sessions (look for the lumpy- prefix)
```
