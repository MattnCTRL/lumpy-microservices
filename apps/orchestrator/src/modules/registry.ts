import { logger } from '../logger.js';
import type { LumpyModule, ModuleContext, ModuleInfo } from './types.js';

/** Holds the set of registered modules and wires them into the orchestrator. */
export class ModuleRegistry {
  private readonly modules = new Map<string, LumpyModule>();

  add(module: LumpyModule): this {
    if (this.modules.has(module.id)) {
      throw new Error(`module "${module.id}" is already registered`);
    }
    this.modules.set(module.id, module);
    return this;
  }

  async init(ctx: ModuleContext): Promise<void> {
    for (const module of this.modules.values()) {
      await module.register(ctx);
      logger.info({ module: module.id, version: module.version }, 'module registered');
    }
  }

  list(): ModuleInfo[] {
    return [...this.modules.values()].map(({ id, name, version, description }) => ({
      id,
      name,
      version,
      description,
    }));
  }
}
