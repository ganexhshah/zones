import { redis } from '@/lib/redis';

const memoryRateLimit = new Map<string, { count: number; expiresAt: number }>();

export async function acquireMatchLock(matchId: string, ttlMs = 5000) {
  const key = `lock:match:${matchId}`;

  try {
    const acquired = await redis.set(key, Date.now().toString(), {
      nx: true,
      px: ttlMs,
    });
    return { key, acquired: acquired === 'OK' };
  } catch {
    if (memoryRateLimit.has(key)) return { key, acquired: false };
    memoryRateLimit.set(key, { count: 1, expiresAt: Date.now() + ttlMs });
    return { key, acquired: true };
  }
}

export async function releaseMatchLock(key: string) {
  try {
    await redis.del(key);
  } catch {
    memoryRateLimit.delete(key);
  }
}

export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const now = Date.now();
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  } catch {
    const current = memoryRateLimit.get(key);
    if (!current || current.expiresAt <= now) {
      memoryRateLimit.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
      return { allowed: true, remaining: limit - 1 };
    }
    current.count += 1;
    memoryRateLimit.set(key, current);
    return { allowed: current.count <= limit, remaining: Math.max(0, limit - current.count) };
  }
}
