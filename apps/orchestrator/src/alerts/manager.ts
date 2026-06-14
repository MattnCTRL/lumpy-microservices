import type { Alert, ServerMetrics } from '@lumpy/shared';
import type { EventBus } from '../events/bus.js';
import { logger } from '../logger.js';
import { type AlertRule, DEFAULT_RULES, formatAlertMessage, type MetricKey } from './rules.js';

const OFFLINE_RULE = 'offline';

/**
 * Evaluates metric thresholds against fleet events and maintains the set of
 * active alerts, publishing alert.fired / alert.resolved on transitions. The
 * notify module turns those into push notifications.
 */
export class AlertsManager {
  private readonly counts = new Map<string, number>();
  private readonly active = new Map<string, Alert>();
  // Dismissed alerts stay suppressed until their condition clears and recurs.
  private readonly acknowledged = new Set<string>();
  // Rules grouped by metric so only the most severe breached tier fires.
  private readonly ruleGroups = new Map<MetricKey, AlertRule[]>();

  constructor(
    private readonly bus: EventBus,
    rules: AlertRule[] = DEFAULT_RULES,
  ) {
    for (const rule of rules) {
      const group = this.ruleGroups.get(rule.metric) ?? [];
      group.push(rule);
      this.ruleGroups.set(rule.metric, group);
    }
    for (const group of this.ruleGroups.values()) {
      group.sort((a, b) => b.threshold - a.threshold);
    }

    this.bus.subscribe((event) => {
      if (event.type === 'fleet.metrics') {
        this.evaluate(event.id, event.name, event.metrics);
      } else if (event.type === 'fleet.server.status') {
        // Remotes (phones/tablets) sleep constantly — offline is normal for them,
        // not an incident. Only servers/machines are expected to stay up.
        if (event.kind === 'remote') return;
        if (event.status === 'offline') this.fireOffline(event.id, event.name);
        else if (event.status === 'online') this.clear(`${event.id}:${OFFLINE_RULE}`);
      } else if (event.type === 'fleet.server.removed') {
        this.resolveServer(event.id);
      }
    });
  }

  activeAlerts(): Alert[] {
    return [...this.active.values()].sort((a, b) => (a.severity === 'critical' ? -1 : 1));
  }

  /** Manually dismiss an alert; it stays suppressed until its condition recurs. */
  dismiss(id: string): boolean {
    if (!this.active.has(id)) return false;
    this.acknowledged.add(id);
    this.resolve(id);
    return true;
  }

  private resolveServer(serverId: string): void {
    const prefix = `${serverId}:`;
    for (const key of [...this.active.keys()]) {
      if (key.startsWith(prefix)) this.clear(key);
    }
  }

  /** Resolve and re-arm: the condition genuinely cleared, so allow future alerts. */
  private clear(key: string): void {
    this.counts.set(key, 0);
    this.acknowledged.delete(key);
    this.resolve(key);
  }

  private evaluate(serverId: string, serverName: string, metrics: ServerMetrics): void {
    for (const [metric, group] of this.ruleGroups) {
      // Highest-threshold rule that is breached wins; others for this metric clear.
      const breached = group.find((rule) => metrics[metric] >= rule.threshold);
      for (const rule of group) {
        const key = `${serverId}:${rule.id}`;
        if (rule === breached) {
          const count = (this.counts.get(key) ?? 0) + 1;
          this.counts.set(key, count);
          if (count >= rule.forSamples && !this.active.has(key) && !this.acknowledged.has(key)) {
            const value = metrics[metric];
            this.fire({
              id: key,
              serverId,
              serverName,
              ruleId: rule.id,
              label: rule.label,
              severity: rule.severity,
              metric,
              value,
              message: formatAlertMessage(rule, value),
              firedAt: new Date().toISOString(),
            });
          }
        } else {
          this.clear(key);
        }
      }
    }
  }

  private fireOffline(serverId: string, serverName: string): void {
    const key = `${serverId}:${OFFLINE_RULE}`;
    if (this.active.has(key) || this.acknowledged.has(key)) return;
    this.fire({
      id: key,
      serverId,
      serverName,
      ruleId: OFFLINE_RULE,
      label: 'Server offline',
      severity: 'critical',
      metric: 'status',
      value: 0,
      message: 'No heartbeat received within the expected window',
      firedAt: new Date().toISOString(),
    });
  }

  private fire(alert: Alert): void {
    this.active.set(alert.id, alert);
    this.bus.publish({ type: 'alert.fired', alert, at: alert.firedAt });
    logger.warn({ alert: alert.id, severity: alert.severity }, 'alert fired');
  }

  private resolve(key: string): void {
    const alert = this.active.get(key);
    if (!alert) return;
    this.active.delete(key);
    this.bus.publish({
      type: 'alert.resolved',
      id: key,
      serverName: alert.serverName,
      label: alert.label,
      at: new Date().toISOString(),
    });
    logger.info({ alert: key }, 'alert resolved');
  }
}
