import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';
import {
  buildServerSeedHash,
  enforceRateLimit,
  getRequestIp,
  pickWeightedSpinReward,
} from '@/lib/rewards';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuthUser(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const body = await request.json().catch(() => ({}));
    const clientSeed = typeof body?.clientSeed === 'string' ? body.clientSeed.slice(0, 120) : null;

    const userId = authResult.user.id;
    const ip = getRequestIp(request);
    const userAgent = request.headers.get('user-agent') ?? '';

    const [userAllowed, ipAllowed] = await Promise.all([
      enforceRateLimit({
        key: `rl:rewards:spin:user:${userId}`,
        limit: 15,
        windowSeconds: 60,
      }),
      enforceRateLimit({
        key: `rl:rewards:spin:ip:${ip}`,
        limit: 80,
        windowSeconds: 60,
      }),
    ]);

    if (!userAllowed || !ipAllowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const now = new Date();
    const reward = pickWeightedSpinReward();
    const serverSeedHash = buildServerSeedHash(userId, now);

    const result = await prisma.$transaction(async (tx) => {
      const state = await tx.userRewardState.findUnique({
        where: { userId },
        select: { spinTokens: true },
      });

      if (!state || state.spinTokens <= 0) {
        throw new Error('NO_SPINS_LEFT');
      }

      const userUpdateData =
        reward.rewardType === 'coins'
          ? { coinBalance: { increment: reward.rewardValue } }
          : { freeEntryTokens: { increment: reward.rewardValue } };

      const [updatedUser, updatedState] = await Promise.all([
        tx.user.update({
          where: { id: userId },
          data: userUpdateData,
          select: { coinBalance: true, freeEntryTokens: true },
        }),
        tx.userRewardState.update({
          where: { userId },
          data: {
            spinTokens: { decrement: 1 },
            lastSpinAt: now,
          },
          select: { spinTokens: true, lastSpinAt: true },
        }),
      ]);

      const spinLog = await tx.rewardSpin.create({
        data: {
          userId,
          rewardType: reward.rewardType,
          rewardValue: reward.rewardValue,
          clientSeed,
          serverSeedHash,
          createdAt: now,
        },
        select: {
          id: true,
          rewardType: true,
          rewardValue: true,
          createdAt: true,
          serverSeedHash: true,
        },
      });

      await tx.rewardAudit.create({
        data: {
          userId,
          action: 'spin_claim',
          ipAddress: ip,
          userAgent,
          metadata: {
            rewardType: reward.rewardType,
            rewardValue: reward.rewardValue,
            clientSeed,
            serverSeedHash,
          },
        },
      });

      return {
        spin: spinLog,
        spinsLeft: updatedState.spinTokens,
        coinBalance: updatedUser.coinBalance,
        freeEntryTokens: updatedUser.freeEntryTokens,
        rewardLabel: reward.label,
      };
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    if (error?.message === 'NO_SPINS_LEFT') {
      return NextResponse.json({ error: 'No spin tokens left' }, { status: 400 });
    }
    console.error('Error processing reward spin:', error);
    return NextResponse.json({ error: 'Failed to process spin' }, { status: 500 });
  }
}
