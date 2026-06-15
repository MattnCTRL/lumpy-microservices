import { logger } from '../logger.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';
import { buildNotification, type Notification } from './notification.js';

async function dispatch(ntfyUrl: string, topic: string, notification: Notification): Promise<void> {
  try {
    const response = await fetch(ntfyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic, ...notification }),
    });
    if (!response.ok) logger.error({ status: response.status }, 'ntfy publish failed');
  } catch (error) {
    logger.error({ error }, 'ntfy publish error');
  }
}

export const notifyModule: LumpyModule = {
  id: 'notify',
  name: 'Notifications',
  version: '0.1.0',
  description: 'Pushes actionable alerts to ntfy from the event spine.',
  register(ctx: ModuleContext) {
    const { ntfyUrl, ntfyTopic, publicUrl, webUrl } = ctx.config;
    if (!ntfyTopic) {
      logger.warn('LUMPY_NTFY_TOPIC is not set - push notifications are disabled');
      return;
    }

    // Action POSTs (approve/input) go to the orchestrator (publicUrl); click deep
    // links open the web UI (webUrl, falling back to publicUrl if unset).
    ctx.bus.subscribe((event) => {
      const notification = buildNotification(event, publicUrl, webUrl || publicUrl);
      if (notification) void dispatch(ntfyUrl, ntfyTopic, notification);
    });

    logger.info({ topic: ntfyTopic }, 'notifications enabled');
  },
};
