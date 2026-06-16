import { logger } from '../logger.js';
import type { LumpyModule, ModuleContext } from '../modules/types.js';
import { asLedgerCategory } from './ingest.js';

/**
 * The Conductor's 1000-ft playbook ledger (conductor scope). This is the map, not
 * the territory: awareness, rules, expectations, maintenance, and pointers to where
 * each project's data and keys live - never the project minutiae itself (that lives
 * in each project's own ledger). The Conductor reads and writes it via the admin
 * token; the global auth gate already admits the admin token and gates user writes
 * by role, so no extra per-route check is needed here.
 */
export const ledgerModule: LumpyModule = {
  id: 'ledger',
  name: 'Memory Ledger',
  version: '0.1.0',
  description: "The Conductor's 1000-ft playbook: rules, pointers, and maintenance.",
  register(ctx: ModuleContext) {
    const { app, store } = ctx;

    // The Conductor's own playbook (1000-ft level).
    app.get('/api/ledger', async () => store.listLedger('conductor', null));

    // Record a conductor-scope entry. Body: { category, statement, detail? }.
    app.post('/api/ledger', async (request, reply) => {
      const body = (request.body ?? {}) as {
        category?: unknown;
        statement?: unknown;
        detail?: unknown;
      };
      const category = asLedgerCategory(body.category);
      const statement = typeof body.statement === 'string' ? body.statement.trim() : '';
      if (!category) return reply.status(400).send({ error: 'invalid or missing category' });
      if (!statement) return reply.status(400).send({ error: 'statement is required' });
      const detail = typeof body.detail === 'string' ? body.detail : null;
      store.recordLedger(
        { scope: 'conductor', projectId: null, category, statement, detail, source: 'conductor' },
        new Date().toISOString(),
      );
      return reply.status(201).send({ ok: true });
    });

    logger.info('ledger module ready (Conductor playbook)');
  },
};
