import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname, networkInterfaces, platform } from 'node:os';
import { join } from 'node:path';
import type { Server } from '@lumpy/shared';
import { collect, cpuSnapshot, type CpuSnapshot } from './metrics.js';

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

const base = env('LUMPY_URL', 'http://127.0.0.1:4317');
const interval = Number(env('LUMPY_AGENT_INTERVAL', '5000'));
const diskPath = env('LUMPY_DISK_PATH', '/');
const name = env('LUMPY_AGENT_NAME', hostname());
const agentToken = env('LUMPY_AGENT_TOKEN', '');

// Sent so the orchestrator accepts telemetry while auth gating is on. Harmless
// when gating or the token is not configured.
function postHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (agentToken) headers['x-lumpy-agent-token'] = agentToken;
  return headers;
}

const stateDir = join(homedir(), '.lumpy');
const stateFile = join(stateDir, 'agent.json');

function loadState(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveServerId(id: string): void {
  const state = loadState();
  state[base] = id;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function clearServerId(): void {
  const state = loadState();
  delete state[base];
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function primaryAddress(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (!address.internal && address.family === 'IPv4') return address.address;
    }
  }
  return name;
}

async function register(): Promise<string> {
  const response = await fetch(`${base}/api/fleet/servers`, {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify({ name, address: primaryAddress(), platform: platform() }),
  });
  if (!response.ok) throw new Error(`registration failed: ${response.status}`);
  const server = (await response.json()) as Server;
  saveServerId(server.id);
  console.log(`registered "${name}" as ${server.id}`);
  return server.id;
}

/** Use an explicit id, a previously saved one, or self-register. */
async function resolveServerId(): Promise<string> {
  const explicit = process.env.LUMPY_SERVER_ID;
  if (explicit) return explicit;
  return loadState()[base] ?? (await register());
}

async function main(): Promise<void> {
  let serverId = await resolveServerId();
  let previous: CpuSnapshot = cpuSnapshot();
  console.log(`reporting ${name} -> ${base} (server ${serverId}) every ${interval}ms`);

  setInterval(() => {
    void (async () => {
      const current = cpuSnapshot();
      const report = await collect(previous, current, diskPath);
      previous = current;
      try {
        const response = await fetch(`${base}/api/fleet/servers/${serverId}/metrics`, {
          method: 'POST',
          headers: postHeaders(),
          body: JSON.stringify(report),
        });
        if (response.status === 404 && !process.env.LUMPY_SERVER_ID) {
          // The server was removed upstream; re-register under a new id.
          clearServerId();
          serverId = await register();
        } else if (!response.ok) {
          console.error(`push failed: ${response.status}`);
        }
      } catch (error) {
        console.error('push error:', error instanceof Error ? error.message : error);
      }
    })();
  }, interval);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
