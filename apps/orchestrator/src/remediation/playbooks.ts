import type { Playbook } from '@lumpy/shared';

/**
 * Built-in remediation playbooks. Each maps one or more alert rules to a vetted
 * instruction for the remediation session — more specific and safer than a
 * generic "investigate" prompt. (User-editable playbooks are a future addition.)
 */
export const DEFAULT_PLAYBOOKS: Playbook[] = [
  {
    id: 'disk-cleanup',
    name: 'Disk cleanup',
    description: 'Reclaim clearly-safe disk space when a disk fills up.',
    ruleIds: ['disk-critical', 'disk-warning'],
    requiresApproval: false,
    task:
      'The disk is filling up. Find what is consuming space (e.g. `du -xhd1 /` and large ' +
      'subdirectories, package-manager caches, rotated and old logs, /tmp, build artifacts). ' +
      'Reclaim only clearly-safe space: package caches, temp files, and rotated/old logs. ' +
      'Never delete application data, databases, config, or user files. Report what you freed.',
  },
  {
    id: 'cpu-triage',
    name: 'CPU triage',
    description: 'Identify what is driving sustained high CPU.',
    ruleIds: ['cpu-warning'],
    requiresApproval: false,
    task:
      'CPU has been sustained high. Identify the top CPU-consuming processes (e.g. `ps aux ' +
      '--sort=-%cpu | head` or `top -bn1`) and report what is driving it. Only act if there is an ' +
      'obviously stuck/runaway process that is clearly safe to restart — otherwise just report.',
  },
  {
    id: 'memory-triage',
    name: 'Memory triage',
    description: 'Identify memory pressure and the top consumers.',
    ruleIds: ['mem-critical', 'mem-warning'],
    requiresApproval: false,
    task:
      'Memory is under pressure. Identify the top memory-consuming processes and report. Only ' +
      'restart a clearly leaking, restartable service if it is safe to do so; otherwise report.',
  },
  {
    id: 'offline-check',
    name: 'Offline check',
    description: 'Diagnose a server that stopped reporting.',
    ruleIds: ['offline'],
    requiresApproval: false,
    task:
      'The server stopped sending heartbeats. Diagnose why: check basic connectivity, whether the ' +
      'host is reachable, and whether the monitoring agent is running. Do NOT make changes — ' +
      'report the likely cause and recommended fix.',
  },
];

export function findPlaybook(ruleId: string): Playbook | undefined {
  return DEFAULT_PLAYBOOKS.find((playbook) => playbook.ruleIds.includes(ruleId));
}
