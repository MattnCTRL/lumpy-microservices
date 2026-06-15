// Waits for the web UI to be ready during `npm run dev`, then opens it in the
// default browser once. Safe to fail - it never blocks the dev servers.

import { spawn } from 'node:child_process';

const url = process.env.LUMPY_WEB_URL ?? 'http://127.0.0.1:3000';
const deadline = Date.now() + 60_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function openBrowser(target) {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  const args = process.platform === 'win32' ? ['', target] : [target];
  spawn(command, args, {
    stdio: 'ignore',
    detached: true,
    shell: process.platform === 'win32',
  }).unref();
}

async function waitForServer() {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status < 500) return true;
    } catch {
      // Not up yet.
    }
    await sleep(500);
  }
  return false;
}

if (await waitForServer()) {
  console.log(`opening ${url}`);
  openBrowser(url);
} else {
  console.log(`web UI did not become ready at ${url}; open it manually`);
}
