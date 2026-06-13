import type { WebSocket } from 'ws';
import type { LumpyModule, ModuleContext } from '../modules/types.js';
import { AlertsManager } from './manager.js';

export const alertsModule: LumpyModule = {
  id: 'alerts',
  name: 'Alerts',
  version: '0.1.0',
  description: 'Evaluates fleet metric thresholds and raises alerts.',
  register(ctx) {
    const alerts = new AlertsManager(ctx.bus);

    ctx.app.get('/api/alerts', async () => alerts.activeAlerts());

    ctx.app.delete('/api/alerts/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!alerts.dismiss(id)) return reply.status(404).send({ error: 'alert not found' });
      return reply.status(204).send();
    });

    ctx.app.get('/ws/alerts', { websocket: true }, (socket: WebSocket) => {
      const unsubscribe = ctx.bus.subscribe((event) => {
        if (!event.type.startsWith('alert.')) return;
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
      });
      socket.on('close', unsubscribe);
    });
  },
};
