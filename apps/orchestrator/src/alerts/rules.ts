import type { AlertSeverity, ServerMetrics } from '@lumpy/shared';

export type MetricKey = 'cpuPercent' | 'memPercent' | 'diskPercent' | 'load1';

export interface AlertRule {
  id: string;
  label: string;
  metric: MetricKey;
  threshold: number;
  severity: AlertSeverity;
  /** Consecutive over-threshold samples required before firing (debounce). */
  forSamples: number;
  unit: string;
}

export const DEFAULT_RULES: AlertRule[] = [
  {
    id: 'disk-critical',
    label: 'Disk almost full',
    metric: 'diskPercent',
    threshold: 90,
    severity: 'critical',
    forSamples: 1,
    unit: '%',
  },
  {
    id: 'disk-warning',
    label: 'Disk filling up',
    metric: 'diskPercent',
    threshold: 80,
    severity: 'warning',
    forSamples: 1,
    unit: '%',
  },
  {
    id: 'mem-critical',
    label: 'Memory critical',
    metric: 'memPercent',
    threshold: 95,
    severity: 'critical',
    forSamples: 2,
    unit: '%',
  },
  {
    id: 'mem-warning',
    label: 'Memory high',
    metric: 'memPercent',
    threshold: 90,
    severity: 'warning',
    forSamples: 2,
    unit: '%',
  },
  {
    id: 'cpu-warning',
    label: 'CPU sustained high',
    metric: 'cpuPercent',
    threshold: 90,
    severity: 'warning',
    forSamples: 3,
    unit: '%',
  },
];

export function isOverThreshold(rule: AlertRule, metrics: ServerMetrics): boolean {
  return metrics[rule.metric] >= rule.threshold;
}

export function formatAlertMessage(rule: AlertRule, value: number): string {
  return `${rule.label}: ${rule.metric.replace('Percent', '')} at ${value}${rule.unit}`;
}
