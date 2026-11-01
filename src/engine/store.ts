import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LedgerState } from './types.js';
import { initialState } from './ledger.js';

export interface Store {
  load(channel: string): Promise<LedgerState>;
  save(state: LedgerState): Promise<void>;
}

export class JsonStore implements Store {
  constructor(private readonly dir: string) {}

  private file(channel: string): string {
    return `${this.dir}/ledger-${channel.replace(/[^a-z0-9_]/gi, '_')}.json`;
  }

  async load(channel: string): Promise<LedgerState> {
    try {
      const raw = await readFile(this.file(channel), 'utf8');
      const parsed = JSON.parse(raw) as LedgerState;
      return { ...initialState(channel), ...parsed, settings: { ...initialState(channel).settings, ...parsed.settings } };
    } catch {
      return initialState(channel);
    }
  }

  async save(state: LedgerState): Promise<void> {
    const path = this.file(state.channel);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, path);
  }
}

export class MemoryStore implements Store {
  private states = new Map<string, LedgerState>();
  async load(channel: string): Promise<LedgerState> {
    return this.states.get(channel) ?? initialState(channel);
  }
  async save(state: LedgerState): Promise<void> {
    this.states.set(state.channel, state);
  }
}
