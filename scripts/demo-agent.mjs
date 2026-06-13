// Development helper: pushes synthetic metrics for one registered server so the
// fleet UI can be exercised without a real host. Not the production agent.
//
//   node scripts/demo-agent.mjs <serverId> [--url http://127.0.0.1:4317] [--interval 2000]

const [, , serverId, ...rest] = process.argv;

function flag(name) {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
}

if (!serverId) {
  console.error('usage: node scripts/demo-agent.mjs <serverId> [--url <base>] [--interval <ms>]');
  process.exit(1);
}

const base = flag('--url') ?? process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://127.0.0.1:4317';
const interval = Number(flag('--interval') ?? 2000);
const startedAt = Date.now();

let cpu = 20;
let mem = 45;
let disk = 55;

function walk(value, min, max, step) {
  const next = value + (Math.random() - 0.5) * step;
  return Math.min(max, Math.max(min, next));
}

async function push() {
  cpu = walk(cpu, 2, 98, 15);
  mem = walk(mem, 20, 95, 6);
  disk = walk(disk, 40, 92, 1);

  const body = {
    cpuPercent: Number(cpu.toFixed(1)),
    memPercent: Number(mem.toFixed(1)),
    diskPercent: Number(disk.toFixed(1)),
    load1: Number((cpu / 25).toFixed(2)),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) + 3600,
  };

  try {
    const response = await fetch(`${base}/api/fleet/servers/${serverId}/metrics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    console.log(response.status, JSON.stringify(body));
  } catch (error) {
    console.error('push failed:', error.message);
  }
}

void push();
setInterval(() => void push(), interval);
