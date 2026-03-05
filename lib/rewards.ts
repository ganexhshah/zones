import { createHash, randomInt } from 'crypto';
import type { NextRequest } from 'next/server';
import { redis } from '@/lib/redis';

export const COINS_PER_DIAMOND = 500;
export const DAILY_REWARD_STREAK_CAP = 7;

const nepalDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kathmandu',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const nepalPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kathmandu',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function nepalDayParts(date: Date) {
  const parts = nepalPartsFormatter.formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '1970');
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '1');
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? '1');
  return { year, month, day };
}

function dayIndexFromParts(year: number, month: number, day: number) {
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function nepalDayKey(date: Date) {
  return nepalDayFormatter.format(date);
}

export function nepalDayDiff(fromDate: Date, toDate: Date) {
  const fromParts = nepalDayParts(fromDate);
  const toParts = nepalDayParts(toDate);
  const fromIndex = dayIndexFromParts(fromParts.year, fromParts.month, fromParts.day);
  const toIndex = dayIndexFromParts(toParts.year, toParts.month, toParts.day);
  return toIndex - fromIndex;
}

export function dailyRewardCoins(streak: number) {
  void streak;
  return 200;
}

export type SpinReward = {
  rewardType: 'coins' | 'free_entry_token';
  rewardValue: number;
  label: string;
  weight: number;
};

const spinRewards: SpinReward[] = [
  { rewardType: 'coins', rewardValue: 50, label: '50 coins', weight: 40 },
  { rewardType: 'coins', rewardValue: 100, label: '100 coins', weight: 30 },
  { rewardType: 'coins', rewardValue: 200, label: '200 coins', weight: 15 },
  { rewardType: 'coins', rewardValue: 500, label: '500 coins', weight: 8 },
  { rewardType: 'free_entry_token', rewardValue: 1, label: '1 free-entry token', weight: 6 },
  { rewardType: 'coins', rewardValue: 1000, label: '1000 coins', weight: 1 },
];

export function pickWeightedSpinReward() {
  const totalWeight = spinRewards.reduce((sum, item) => sum + item.weight, 0);
  const roll = randomInt(1, totalWeight + 1);
  let cursor = 0;

  for (const reward of spinRewards) {
    cursor += reward.weight;
    if (roll <= cursor) {
      return reward;
    }
  }

  return spinRewards[0];
}

export function buildServerSeedHash(userId: string, now: Date) {
  const seed = `${userId}:${now.toISOString()}:${Math.random()}:${randomInt(0, 1_000_000_000)}`;
  return createHash('sha256').update(seed).digest('hex');
}

export function getRequestIp(req: NextRequest) {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export async function enforceRateLimit({
  key,
  limit,
  windowSeconds,
}: {
  key: string;
  limit: number;
  windowSeconds: number;
}) {
  const hits = await redis.incr(key);
  if (hits === 1) {
    await redis.expire(key, windowSeconds);
  }
  return hits <= limit;
}
