import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';
import { COINS_PER_DIAMOND, dailyRewardCoins, nepalDayDiff, nepalDayKey } from '@/lib/rewards';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuthUser(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const userId = authResult.user.id;
    const now = new Date();

    const [user, rewardState] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { coinBalance: true, freeEntryTokens: true },
      }),
      prisma.userRewardState.findUnique({
        where: { userId },
      }),
    ]);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    let canClaimDaily = true;
    let nextDailyClaimAt: string | null = null;
    let streak = rewardState?.streak ?? 0;

    if (rewardState?.lastDailyClaimAt) {
      const lastClaim = new Date(rewardState.lastDailyClaimAt);
      const diffDays = nepalDayDiff(lastClaim, now);
      if (diffDays <= 0) {
        canClaimDaily = false;
        nextDailyClaimAt = null;
      } else if (diffDays > 1) {
        streak = 0;
      }
    }

    const nextStreak = Math.min(Math.max(streak, 0) + 1, 7);
    const nextDailyRewardCoins = dailyRewardCoins(nextStreak);

    return NextResponse.json({
      coins: user.coinBalance,
      diamonds: Math.floor(user.coinBalance / COINS_PER_DIAMOND),
      freeEntryTokens: user.freeEntryTokens,
      spinsLeft: rewardState?.spinTokens ?? 0,
      streak,
      canClaimDaily,
      nextDailyRewardCoins,
      nextDailyClaimAt,
      nepalDay: nepalDayKey(now),
      conversion: {
        coinsPerDiamond: COINS_PER_DIAMOND,
        diamondValueRs: 1,
      },
    });
  } catch (error) {
    console.error('Error fetching reward status:', error);
    return NextResponse.json({ error: 'Failed to fetch reward status' }, { status: 500 });
  }
}
