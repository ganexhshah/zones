import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';
import {
  dailyRewardCoins,
  enforceRateLimit,
  getRequestIp,
  nepalDayDiff,
  nepalDayKey,
} from '@/lib/rewards';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuthUser(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const userId = authResult.user.id;
    const ip = getRequestIp(request);
    const userAgent = request.headers.get('user-agent') ?? '';

    const [userAllowed, ipAllowed] = await Promise.all([
      enforceRateLimit({
        key: `rl:rewards:daily:user:${userId}`,
        limit: 10,
        windowSeconds: 60,
      }),
      enforceRateLimit({
        key: `rl:rewards:daily:ip:${ip}`,
        limit: 50,
        windowSeconds: 60,
      }),
    ]);

    if (!userAllowed || !ipAllowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const [user, rewardState] = await Promise.all([
        tx.user.findUnique({
          where: { id: userId },
          select: { id: true, coinBalance: true },
        }),
        tx.userRewardState.findUnique({
          where: { userId },
        }),
      ]);

      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      let streak = 1;
      if (rewardState?.lastDailyClaimAt) {
        const lastClaim = new Date(rewardState.lastDailyClaimAt);
        const diffDays = nepalDayDiff(lastClaim, now);

        if (diffDays <= 0) {
          throw new Error('ALREADY_CLAIMED');
        }
        streak = diffDays === 1 ? rewardState.streak + 1 : 1;
      }

      const normalizedStreak = ((Math.max(streak, 1) - 1) % 7) + 1;
      const rewardCoins = dailyRewardCoins(normalizedStreak);

      const [updatedUser, updatedState] = await Promise.all([
        tx.user.update({
          where: { id: userId },
          data: { coinBalance: { increment: rewardCoins }, freeEntryTokens: { increment: 1 } },
          select: { coinBalance: true, freeEntryTokens: true },
        }),
        tx.userRewardState.upsert({
          where: { userId },
          create: {
            userId,
            lastDailyClaimAt: now,
            streak: normalizedStreak,
            spinTokens: 1,
          },
          update: {
            lastDailyClaimAt: now,
            streak: normalizedStreak,
            spinTokens: { increment: 1 },
          },
          select: { streak: true, spinTokens: true },
        }),
      ]);

      await tx.rewardAudit.create({
        data: {
          userId,
          action: 'daily_claim',
          ipAddress: ip,
          userAgent,
          metadata: {
            rewardCoins,
            streak: normalizedStreak,
            spinTokenGranted: 1,
            nepalDay: nepalDayKey(now),
          },
        },
      });

      return {
        rewardCoins,
        streak: updatedState.streak,
        spinTokens: updatedState.spinTokens,
        coinBalance: updatedUser.coinBalance,
        freeEntryTokens: updatedUser.freeEntryTokens,
      };
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    if (error?.message === 'ALREADY_CLAIMED') {
      return NextResponse.json({ error: 'Daily reward already claimed for today' }, { status: 400 });
    }
    if (error?.message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    console.error('Error claiming daily reward:', error);
    return NextResponse.json({ error: 'Failed to claim daily reward' }, { status: 500 });
  }
}
