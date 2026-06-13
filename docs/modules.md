# Modules

Lumpy is built to grow into a true microservices architecture: bespoke tools and
capabilities are added downstream as **modules** rather than by editing the core.
This document describes the extension contract.

## Concept

A module is a self-contained unit of functionality that owns its own routes and
services and registers them with the orchestrator at startup. The core itself
uses this seam — session orchestration ships as the built-in `sessions` module —
so first-party and bespoke modules are first-class in exactly the same way.

## The contract

A module implements the `LumpyModule` interface
(`apps/orchestrator/src/modules/types.ts`):

```ts
export interface LumpyModule {
  id: string; // stable kebab-case id, e.g. "fleet"
  name: string;
  version: string;
  description?: string;
  register(ctx: ModuleContext): void | Promise<void>;
}
```

At registration it receives a `ModuleContext` — the shared services it is allowed
to build on:

```ts
export interface ModuleContext {
  app: FastifyInstance; // register HTTP/WebSocket routes
  logger: Logger;
  config: Config;
  sessions: SessionManager; // orchestrate Claude Code sessions
  bus: EventBus; // publish/subscribe domain events
}
```

The context is the stable integration surface. As new shared capabilities land
(an event bus, the fleet manager, the alert engine), they are added here so
modules can consume them without reaching into core internals.

## Registering a module

Modules are added to the registry in `apps/orchestrator/src/index.ts`:

```ts
const registry = new ModuleRegistry().add(sessionsModule).add(fleetModule); // a future bespoke module
```

`GET /api/modules` lists everything registered, so the UI and other tools can
discover available capabilities at runtime.

## Conventions

- **Namespacing.** A module owns the route prefixes `/api/<id>` and
  `/ws/<id>`. Keep all of a module's surface under its namespace.
- **Self-contained.** A module brings its own storage, schemas, and types. It
  depends on the core only through `ModuleContext`.
- **Versioned.** Each module carries its own semantic version, independent of the
  orchestrator's.
- **No core edits.** Adding a module should require only implementing the
  interface and calling `.add(...)`. If a module needs something the context does
  not expose, extend `ModuleContext` deliberately rather than bypassing it.

## Modules today and ahead

The subsystems in [spec.md](spec.md) map onto modules:

| Module        | Status      | Responsibility                                                                    |
| ------------- | ----------- | --------------------------------------------------------------------------------- |
| `sessions`    | implemented | tmux-backed Claude Code sessions (built-in).                                      |
| `fleet`       | implemented | Server registry, metrics ingestion, status. See [fleet.md](fleet.md).             |
| `notify`      | implemented | ntfy push with approve/reject actions. See [notifications.md](notifications.md).  |
| `alerts`      | implemented | Metric thresholds → alerts → notifications. See [alerts.md](alerts.md).           |
| `remediation` | implemented | Alert-triggered autonomous Claude sessions. See [remediation.md](remediation.md). |

Each will follow the contract above. Splitting any of them into a separate
process later is a deployment change, not a rewrite, because the boundaries are
already drawn at the module seam.
