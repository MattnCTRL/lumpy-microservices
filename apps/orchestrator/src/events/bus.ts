import { EventEmitter } from 'node:events';
import type { LumpyEvent } from '@lumpy/shared';

/**
 * In-process event spine. Modules publish domain events here and subscribe to
 * the ones they care about. The interface is deliberately small so it can be
 * backed by Redis Streams (or NATS) later without touching publishers.
 */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Many WebSocket clients may subscribe; lift the default listener cap.
    this.emitter.setMaxListeners(0);
  }

  publish(event: LumpyEvent): void {
    this.emitter.emit('event', event);
  }

  subscribe(listener: (event: LumpyEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}
