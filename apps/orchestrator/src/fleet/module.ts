import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { MetricsReport } from '@lumpy/shared';
import type { FleetMounts, TailnetDevice } from '@lumpy/shared';
import { collectOverSsh, type SshTarget } from '../ssh/collect.js';
import { kindFromOs, tailnetDevices } from './discover.js';
import { mountStates } from './mounts.js';
import { FleetStore } from '../store/fleet.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';
import { FleetManager } from './manager.js';
import { HostedServicesMonitor } from './hosted.js';
import { SshMonitor } from './monitor.js';

const sshSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().optional(),
  user: z.string().min(1),
  privateKey: z.string().optional(),
  password: z.string().optional(),
});

const createServerSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  kind: z.enum(['server', 'machine', 'remote']).optional(),
  tags: z.array(z.string()).optional(),
  env: z.enum(['prod', 'staging', 'dev']).optional(),
  criticality: z.enum(['low', 'medium', 'high']).optional(),
  ssh: sshSchema.optional(),
  // Reported by agents so the kind can be inferred when not specified.
  platform: z.string().optional(),
});

/** Personal computers (Macs, Windows) are machines; everything else is a server. */
function inferKind(platform: string | undefined): 'server' | 'machine' {
  return platform === 'darwin' || platform === 'win32' ? 'machine' : 'server';
}

/** How often to refresh remote (phone/tablet) presence from Tailscale. */
const REMOTE_PRESENCE_INTERVAL_MS = 30_000;

const metricsSchema = z.object({
  cpuPercent: z.number().min(0).max(100),
  memPercent: z.number().min(0).max(100),
  diskPercent: z.number().min(0).max(100),
  load1: z.number().min(0),
  uptimeSeconds: z.number().min(0),
});

function registerRest(ctx: ModuleContext, fleet: FleetManager, hosted: HostedServicesMonitor): void {
  const { app } = ctx;

  // Attach the services each machine hosts (resolved from projects, with status).
  const withHosted = <T extends { id: string }>(server: T): T =>
    ({ ...server, hostedServices: hosted.forServer(server.id) }) as T;

  app.get('/api/fleet/servers', async () => fleet.list().map(withHosted));

  // SSHFS mount state per machine (mounted on the orchestrator + responsive).
  app.get('/api/fleet/mounts', async (): Promise<FleetMounts> => {
    const machines = fleet.list().filter((s) => s.kind === 'machine');
    return mountStates(machines.map((s) => ({ id: s.id, address: s.address })));
  });

  // Tailnet devices not yet in the fleet — "available to add".
  app.get('/api/fleet/discover', async (): Promise<TailnetDevice[]> => {
    const existing = new Set(fleet.list().map((s) => s.address));
    const devices = await tailnetDevices();
    return devices
      .filter((d) => !existing.has(d.address))
      .map((d) => ({ ...d, kind: kindFromOs(d.os) }));
  });

  app.post('/api/fleet/servers', async (request, reply) => {
    const parsed = createServerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    }
    const input = parsed.data;

    // Dedupe by address for agent/push registrations: if a record for this
    // address already exists (e.g. added from tailnet discovery), adopt it
    // instead of creating a duplicate. SSH adds always create their own record.
    if (!input.ssh) {
      const existing = fleet.list().find((s) => s.address === input.address);
      if (existing) return reply.status(200).send(withHosted(fleet.get(existing.id) ?? existing));
    }

    // When SSH details are supplied, verify they work before registering so the
    // operator gets immediate feedback, and seed the first metrics sample.
    let firstSample: MetricsReport | null = null;
    const ssh: SshTarget | null = input.ssh
      ? {
          host: input.ssh.host,
          port: input.ssh.port ?? 22,
          user: input.ssh.user,
          privateKey: input.ssh.privateKey,
          password: input.ssh.password,
        }
      : null;

    if (ssh) {
      try {
        firstSample = await collectOverSsh(ssh);
      } catch (error) {
        return reply.status(400).send({
          error: `SSH connection failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        });
      }
    }

    const server = fleet.register({
      name: input.name,
      address: input.address,
      kind: input.kind ?? inferKind(input.platform),
      tags: input.tags ?? [],
      env: input.env ?? 'prod',
      criticality: input.criticality ?? 'medium',
      ssh,
    });
    if (firstSample) fleet.ingest(server.id, firstSample);
    return reply.status(201).send(withHosted(fleet.get(server.id) ?? server));
  });

  app.get('/api/fleet/servers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = fleet.get(id);
    if (!server) return reply.status(404).send({ error: 'server not found' });
    return withHosted(server);
  });

  app.patch('/api/fleet/servers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        name: z.string().min(1).optional(),
        kind: z.enum(['server', 'machine', 'remote']).optional(),
      })
      .safeParse(request.body);
    if (!body.success || (body.data.name === undefined && body.data.kind === undefined)) {
      return reply.status(400).send({ error: 'name or kind is required' });
    }
    if (!fleet.get(id)) return reply.status(404).send({ error: 'server not found' });
    if (body.data.name !== undefined) fleet.rename(id, body.data.name);
    if (body.data.kind !== undefined) fleet.setKind(id, body.data.kind);
    const updated = fleet.get(id);
    return updated ? withHosted(updated) : updated;
  });

  app.delete('/api/fleet/servers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!fleet.remove(id)) return reply.status(404).send({ error: 'server not found' });
    return reply.status(204).send();
  });

  app.post('/api/fleet/servers/:id/metrics', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = metricsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    }
    if (!fleet.ingest(id, parsed.data)) {
      return reply.status(404).send({ error: 'server not found' });
    }
    return reply.status(204).send();
  });
}

function registerEventsWebSocket(ctx: ModuleContext): void {
  ctx.app.get('/ws/fleet', { websocket: true }, (socket: WebSocket) => {
    const unsubscribe = ctx.bus.subscribe((event) => {
      if (!event.type.startsWith('fleet.')) return;
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
    });
    socket.on('close', unsubscribe);
  });
}

export const fleetModule: LumpyModule = {
  id: 'fleet',
  name: 'Fleet Monitoring',
  version: '0.1.0',
  description: 'Register, monitor, and track remote servers (agentless over SSH or via push).',
  register(ctx) {
    const fleet = new FleetManager(new FleetStore(ctx.config.dataDir), ctx.bus);
    new SshMonitor(fleet);
    const hosted = new HostedServicesMonitor(ctx.store);
    hosted.start();
    registerRest(ctx, fleet, hosted);
    registerEventsWebSocket(ctx);

    // Remotes (phones/tablets) can't run an agent, so derive their online
    // status from Tailscale presence instead of metric heartbeats.
    const refreshRemotes = async (): Promise<void> => {
      if (!fleet.list().some((s) => s.kind === 'remote')) return;
      const online = new Set((await tailnetDevices()).filter((d) => d.online).map((d) => d.address));
      fleet.setRemotePresence(online);
    };
    void refreshRemotes();
    const timer = setInterval(() => void refreshRemotes(), REMOTE_PRESENCE_INTERVAL_MS);
    timer.unref();
  },
};
