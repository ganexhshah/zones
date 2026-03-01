import { Redis } from '@upstash/redis';

type SetOptions = { nx?: boolean; px?: number };

type RedisClient = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown, options?: SetOptions) => Promise<unknown>;
  setex: (key: string, seconds: number, value: unknown) => Promise<unknown>;
  del: (...keys: string[]) => Promise<number>;
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
};

const memoryStore = new Map<string, { value: unknown; expiresAt?: number }>();

function cleanupExpired(key: string) {
  const row = memoryStore.get(key);
  if (!row) return;
  if (row.expiresAt != null && row.expiresAt <= Date.now()) {
    memoryStore.delete(key);
  }
}

const inMemoryRedis: RedisClient = {
  async get(key: string) {
    cleanupExpired(key);
    return memoryStore.get(key)?.value ?? null;
  },
  async set(key: string, value: unknown, options?: SetOptions) {
    cleanupExpired(key);
    if (options?.nx && memoryStore.has(key)) return null;
    const expiresAt = options?.px ? Date.now() + options.px : undefined;
    memoryStore.set(key, { value, expiresAt });
    return 'OK';
  },
  async setex(key: string, seconds: number, value: unknown) {
    memoryStore.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    return 'OK';
  },
  async del(...keys: string[]) {
    let removed = 0;
    for (const key of keys) {
      if (memoryStore.delete(key)) removed += 1;
    }
    return removed;
  },
  async incr(key: string) {
    cleanupExpired(key);
    const current = Number(memoryStore.get(key)?.value ?? 0);
    const next = current + 1;
    memoryStore.set(key, { value: next, expiresAt: memoryStore.get(key)?.expiresAt });
    return next;
  },
  async expire(key: string, seconds: number) {
    cleanupExpired(key);
    const row = memoryStore.get(key);
    if (!row) return 0;
    row.expiresAt = Date.now() + seconds * 1000;
    memoryStore.set(key, row);
    return 1;
  },
};

function createRedisClient(): RedisClient {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return inMemoryRedis;
  try {
    return new Redis({ url, token }) as unknown as RedisClient;
  } catch {
    return inMemoryRedis;
  }
}

export const redis: RedisClient = createRedisClient();
