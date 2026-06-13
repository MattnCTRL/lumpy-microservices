import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface RuntimeSettings {
  remediationMode: 'off' | 'investigate' | 'auto';
  remediationAutoSeverities: string[];
}

/**
 * Runtime-editable settings, seeded from env config and persisted to a JSON file
 * so changes made in the UI survive restarts (and then take precedence over env).
 */
export class SettingsStore {
  private current: RuntimeSettings;
  private readonly file: string;

  constructor(dataDir: string, seed: RuntimeSettings) {
    this.file = join(dataDir, 'settings.json');
    let saved: Partial<RuntimeSettings> = {};
    try {
      saved = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<RuntimeSettings>;
    } catch {
      // No saved settings yet; use the seed.
    }
    this.current = { ...seed, ...saved };
  }

  get(): RuntimeSettings {
    return this.current;
  }

  update(patch: Partial<RuntimeSettings>): RuntimeSettings {
    this.current = { ...this.current, ...patch };
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, `${JSON.stringify(this.current, null, 2)}\n`);
    } catch {
      // Best effort; settings still apply in-memory.
    }
    return this.current;
  }
}
