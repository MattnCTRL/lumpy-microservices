import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const TAILSCALE_BINS = [
  'tailscale',
  '/usr/bin/tailscale',
  '/usr/local/bin/tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
];

interface TsPeer {
  HostName?: string;
  DNSName?: string;
  TailscaleIPs?: string[];
  OS?: string;
  Online?: boolean;
}

export interface DiscoveredDevice {
  name: string;
  address: string;
  os: string;
  online: boolean;
}

function toDevice(peer: TsPeer | undefined): DiscoveredDevice | null {
  const address = peer?.TailscaleIPs?.[0];
  if (!address) return null;
  // Prefer the MagicDNS name (e.g. "ipad-pro-12-9-6th-gen-wifi"); iOS reports a
  // useless HostName of "localhost", so only fall back to it when it's real.
  const dns = peer?.DNSName?.replace(/\.$/, '').split('.')[0]?.trim();
  const host = peer?.HostName?.trim();
  const real = (v: string | undefined): v is string => Boolean(v) && v !== 'localhost';
  const name = (real(dns) && dns) || (real(host) && host) || dns || host || address;
  return { name, address, os: peer?.OS ?? '', online: Boolean(peer?.Online) };
}

/** Devices visible on the tailnet (self + peers), via the local tailscale CLI. */
export async function tailnetDevices(): Promise<DiscoveredDevice[]> {
  let stdout = '';
  for (const bin of TAILSCALE_BINS) {
    try {
      ({ stdout } = await exec(bin, ['status', '--json'], { maxBuffer: 4 * 1024 * 1024 }));
      break;
    } catch {
      // try next path
    }
  }
  if (!stdout) return [];

  let data: { Self?: TsPeer; Peer?: Record<string, TsPeer> };
  try {
    data = JSON.parse(stdout);
  } catch {
    return [];
  }
  const devices: DiscoveredDevice[] = [];
  const self = toDevice(data.Self);
  if (self) devices.push(self);
  for (const peer of Object.values(data.Peer ?? {})) {
    const d = toDevice(peer);
    if (d) devices.push(d);
  }
  return devices;
}

/** Infer fleet kind from a Tailscale OS string. */
export function kindFromOs(os: string): 'server' | 'machine' | 'remote' {
  if (/ios|ipados|android/i.test(os)) return 'remote';
  if (/mac|win/i.test(os)) return 'machine';
  return 'server';
}
