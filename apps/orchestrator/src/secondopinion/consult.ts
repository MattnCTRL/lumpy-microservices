import { execFile } from 'node:child_process';
import {
  chmodSync,
  chownSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ConsultVerdict } from '@lumpy/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { resolveRunAs, type RunAs, runAsEnv } from '../sessions/runas.js';
import type { Store } from '../store/sqlite.js';

const exec = promisify(execFile);

/** Secret key for the account-level OpenAI API key. */
export const OPENAI_API_KEY = 'openai_api_key';

export type SecondOpinionMode = 'off' | 'advisory' | 'enforce';

/** JSON Schema Codex must conform its final answer to (`codex exec --output-schema`). */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['approve', 'concern', 'reject'] },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    summary: { type: 'string' },
    concerns: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'confidence', 'summary', 'concerns', 'suggestions'],
} as const;

export interface ConsultInput {
  /** Short label for what's being reviewed (for logs/events). */
  subject: string;
  /** The action/question Codex should weigh in on. */
  prompt: string;
  /** A directory Codex may read (read-only) for context, e.g. a project dir. */
  cwd?: string;
  /** Max wall-clock for this consult; defaults to config.codexTimeoutMs. */
  timeoutMs?: number;
}

export interface GateResult {
  /** Whether the calling action should proceed. */
  proceed: boolean;
  mode: SecondOpinionMode;
  verdict: ConsultVerdict;
}

/** Wrap the operator's prompt with the read-only, skeptical reviewer framing. */
function framePrompt(body: string): string {
  return [
    'You are a senior engineer giving an independent SECOND OPINION before an autonomous',
    'system (Lumpy) takes an action with no human in the loop.',
    'You are running READ-ONLY: inspect files if useful, but never propose or make changes.',
    'Be skeptical and concise. Weigh correctness, blast radius, data-loss risk, security,',
    'and whether the action actually addresses the stated problem.',
    '',
    body,
    '',
    'Answer strictly via the provided output schema:',
    '- verdict "approve": safe to run unattended.',
    '- verdict "concern": probably fine, but the listed risks should be noted.',
    '- verdict "reject": do NOT run unattended; a human should look first.',
  ].join('\n');
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? Math.round(value) : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Parse Codex's schema-constrained final message into a verdict. */
function parseVerdict(raw: string): Omit<ConsultVerdict, 'available'> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  try {
    if (start < 0 || end <= start) throw new Error('no json');
    const obj = JSON.parse(raw.slice(start, end + 1)) as Partial<ConsultVerdict>;
    const verdict =
      obj.verdict === 'approve' || obj.verdict === 'reject' ? obj.verdict : 'concern';
    return {
      verdict,
      confidence: clampInt(obj.confidence, 0, 100, 50),
      summary: typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim() : '(no summary)',
      concerns: strings(obj.concerns),
      suggestions: strings(obj.suggestions),
    };
  } catch {
    return {
      verdict: 'concern',
      confidence: 0,
      summary: raw.trim().slice(0, 280) || '(unparseable response)',
      concerns: [],
      suggestions: [],
    };
  }
}

/** A neutral, non-blocking verdict for when Codex didn't actually run. */
function unavailable(error: string): ConsultVerdict {
  return {
    verdict: 'approve',
    confidence: 0,
    summary: error,
    concerns: [],
    suggestions: [],
    available: false,
    error,
  };
}

/**
 * Ask Codex (OpenAI's CLI) for a read-only second opinion. Runs as the dedicated
 * session user, sandboxed read-only, with a forced JSON output schema. Never
 * throws: any failure (no key, CLI missing, timeout) returns `available: false`
 * so callers can fail open.
 */
export async function consultCodex(store: Store, input: ConsultInput): Promise<ConsultVerdict> {
  if (!store.getSecret(OPENAI_API_KEY)) return unavailable('no OpenAI API key configured');

  let runAs: RunAs | null = null;
  if (config.sessionUser) {
    try {
      runAs = resolveRunAs(config.sessionUser);
    } catch {
      runAs = null;
    }
  }
  const home = runAs?.home ?? process.env.HOME ?? tmpdir();

  let work: string;
  try {
    work = mkdtempSync(join(tmpdir(), 'lumpy-consult-'));
  } catch (error) {
    return unavailable(`scratch dir failed: ${String(error)}`);
  }
  const schemaPath = join(work, 'schema.json');
  const outPath = join(work, 'verdict.json');

  try {
    writeFileSync(schemaPath, JSON.stringify(OUTPUT_SCHEMA));
    // Codex runs as the session user, so it needs to read the schema and write
    // the verdict file in this scratch dir.
    if (runAs) {
      chownSync(work, runAs.uid, runAs.gid);
      chmodSync(work, 0o700);
      chownSync(schemaPath, runAs.uid, runAs.gid);
    }

    const cwd = input.cwd && existsSync(input.cwd) ? input.cwd : home;
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--color',
      'never',
      '-s',
      'read-only',
      '-C',
      cwd,
      ...(config.codexModel ? ['-m', config.codexModel] : []),
      '--output-schema',
      schemaPath,
      '-o',
      outPath,
      framePrompt(input.prompt),
    ];

    await exec('codex', args, {
      uid: runAs?.uid,
      gid: runAs?.gid,
      env: {
        ...(runAs ? runAsEnv(runAs) : process.env),
        // Auth (auth.json) lives here; syncCodexAuth keeps it in step with the key.
        CODEX_HOME: join(home, '.codex'),
      },
      timeout: input.timeoutMs ?? config.codexTimeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });

    return { ...parseVerdict(readFileSync(outPath, 'utf8')), available: true };
  } catch (error) {
    const e = error as { stderr?: string; killed?: boolean; code?: string; message?: string };
    const reason = e.killed
      ? 'codex consult timed out'
      : e.code === 'ENOENT'
        ? 'codex CLI not installed'
        : (e.stderr || e.message || 'codex consult failed').toString().trim().slice(0, 300);
    logger.warn({ subject: input.subject, reason }, 'second-opinion consult failed (failing open)');
    return unavailable(reason);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Gate an autonomous action behind a Codex second opinion, per the configured mode.
 * - off: never consult, always proceed.
 * - advisory: consult and record, but always proceed.
 * - enforce: hold only on an explicit reject (concerns proceed, noted).
 * Always fails open when Codex couldn't run, so a missing key or flaky CLI never
 * freezes the fleet.
 */
export async function secondOpinionGate(
  store: Store,
  mode: SecondOpinionMode,
  input: ConsultInput,
): Promise<GateResult> {
  if (mode === 'off') return { proceed: true, mode, verdict: unavailable('gate off') };
  const verdict = await consultCodex(store, input);
  if (!verdict.available) return { proceed: true, mode, verdict };
  if (mode === 'advisory') return { proceed: true, mode, verdict };
  return { proceed: verdict.verdict !== 'reject', mode, verdict };
}
