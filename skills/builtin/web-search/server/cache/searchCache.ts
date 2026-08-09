import { createHash } from 'crypto';
import { Keyv } from 'keyv';

export function hashCacheKey(prefix: string, value: unknown): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
  return `${prefix}:${digest}`;
}

export class SearchCache {
  private keyv: Keyv;

  constructor() {
    this.keyv = new Keyv();
  }

  async get<T>(key: string): Promise<T | undefined> {
    return await this.keyv.get<T>(key);
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await this.keyv.set(key, value, ttlMs);
  }
}
