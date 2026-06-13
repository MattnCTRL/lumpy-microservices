# Session connectors

Lumpy treats each session as a project. **Connectors** declare where that project
pulls and pushes data — its MCP servers (Supabase, Vercel, GitHub, Postgres, the
filesystem), its secret environment variables, and the GitHub repo it maps to —
so the session is wired to exactly those sources every time it launches.

Open a running session and click **🔌 Connectors**.

## What a connector is

- **MCP servers (plugins).** Written to `<workspace>/.mcp.json`, which Claude
  Code loads automatically. One-click presets cover Supabase, GitHub, Postgres,
  the filesystem (stdio servers via `npx`), Vercel (hosted HTTP MCP), and
  **TensorGarden** (the portal's built-in MCP at `https://tensorgarden.ai/api/mcp`,
  authed with a `tg_live_…` API key). You can remove any of them.
- **Custom connectors.** The **+ Custom** button adds any MCP/API connection:
  an **HTTP/API** server (URL + optional Bearer token — the token is stored as an
  encrypted env var and referenced from the auth header) or a **local stdio**
  server (a `command` line). This is how to wire up any portal that exposes an
  MCP endpoint, like TensorGarden's.
- **Environment / secrets.** Key/value pairs (e.g. `SUPABASE_ACCESS_TOKEN`,
  `DATABASE_URL`). Values are **encrypted at rest** (AES-256-GCM, like SSH creds)
  and **injected into the session's environment at launch** via tmux — they never
  appear in the command line or in any file in the repo. `.mcp.json` references
  them with `${VAR}`.
- **GitHub repo.** Metadata recording which repo the project maps to.

## How it's applied

- Saving connectors writes `.mcp.json` immediately (with `${VAR}` references —
  safe to commit).
- Secret env is injected when the session **launches**, so after changing env you
  **restart the session** to apply it. Removing all MCP servers removes the
  `.mcp.json` file.

## API

- `GET /api/sessions/:id/connectors` → `{ envKeys, mcpServers, repo }`. Secret
  values are never returned — only the key names.
- `PATCH /api/sessions/:id/connectors` → `{ setEnv?, removeEnv?, mcpServers?, repo? }`.

## Security

Secret values are encrypted at rest and only decrypted to inject into the
session's own environment on the orchestrator host. They are not echoed back to
the UI. Keep the orchestrator host trusted (see [security.md](security.md)).
