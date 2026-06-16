import type { LedgerEntry } from '@lumpy/shared';

const LEDGER_META: Record<string, { label: string; cls: string }> = {
  // Project tier - the detail.
  fact: { label: 'Facts', cls: 'bg-ice/25 text-ink' },
  decision: { label: 'Decisions', cls: 'bg-violet/25 text-ink' },
  source: { label: 'Data & keys', cls: 'bg-mint/25 text-ink' },
  gotcha: { label: 'Gotchas', cls: 'bg-coral/25 text-ink' },
  check: { label: 'Checks', cls: 'bg-emerald-100 text-emerald-700' },
  access: { label: 'Access trail', cls: 'bg-neutral-200 text-neutral-600' },
  // Conductor tier - the 1000-ft map.
  playbook: { label: 'Playbook', cls: 'bg-violet/25 text-ink' },
  rule: { label: 'Rules', cls: 'bg-coral/25 text-ink' },
  pointer: { label: 'Pointers', cls: 'bg-ice/25 text-ink' },
  maintenance: { label: 'Maintenance', cls: 'bg-mint/25 text-ink' },
};
const LEDGER_ORDER = [
  'playbook',
  'rule',
  'pointer',
  'maintenance',
  'fact',
  'decision',
  'source',
  'gotcha',
  'check',
  'access',
];

function relTime(iso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/**
 * Renders a compact, deduped memory ledger grouped by category - used for both a
 * project's ledger (the detail) and the Conductor's playbook (the 1000-ft map).
 */
export function LedgerView({ entries, emptyHint }: { entries: LedgerEntry[]; emptyHint?: string }) {
  if (entries.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        {emptyHint ??
          'Empty for now - as work runs, what was done and learned accretes here (compact and deduped), and seeds future agents so they skip redundant work.'}
      </p>
    );
  }
  const groups = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    const g = groups.get(e.category) ?? [];
    g.push(e);
    groups.set(e.category, g);
  }
  const cats = [
    ...LEDGER_ORDER.filter((c) => groups.has(c)),
    ...[...groups.keys()].filter((c) => !LEDGER_ORDER.includes(c)),
  ];
  return (
    <div className="space-y-3">
      {cats.map((cat) => {
        const meta = LEDGER_META[cat] ?? { label: cat, cls: 'bg-neutral-200 text-neutral-600' };
        return (
          <div key={cat}>
            <span
              className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.cls}`}
            >
              {meta.label}
            </span>
            <ul className="space-y-1">
              {(groups.get(cat) ?? []).map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 text-xs">
                  <span className="min-w-0 text-neutral-300">
                    {e.adopted && <span title="adopted as cached truth">📌 </span>}
                    {e.statement}
                    {e.detail && <span className="text-neutral-500"> - {e.detail}</span>}
                  </span>
                  <span className="shrink-0 text-[10px] text-neutral-500">
                    {e.count > 1 ? `×${e.count} · ` : ''}
                    {relTime(e.lastAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
