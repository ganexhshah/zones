import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';
import { COINS_PER_DIAMOND, enforceRateLimit, getRequestIp } from '@/lib/rewards';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuthUser(request);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const ip = getRequestIp(request);
    const userId = authResult.user.id;

    const [userAllowed, ipAllowed] = await Promise.all([
      enforceRateLimit({
        key: `rl:rewards:withdraw:user:${userId}`,
        limit: 8,
        windowSeconds: 60,
      }),
      enforceRateLimit({
        key: `rl:rewards:withdraw:ip:${ip}`,
        limit: 40,
        windowSeconds: 60,
      }),
    ]);

    if (!userAllowed || !ipAllowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const requestedCoins = Number(body?.coins);
    if (!Number.isFinite(requestedCoins) || !Number.isInteger(requestedCoins) || requestedCoins < COINS_PER_DIAMOND) {
      return NextResponse.json(
        { error: `Minimum withdrawal is ${COINS_PER_DIAMOND} coins` },
        { status: 400 },
      );
    }

    const rupees = Math.floor(requestedCoins / COINS_PER_DIAMOND);
    const coinsToDeduct = rupees * COINS_PER_DIAMOND;
    if (coinsToDeduct <= 0) {
      return NextResponse.json({ error: 'Invalid withdrawal amount' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { coinBalance: true, walletBalance: true },
      });
      if (!user) throw new Error('USER_NOT_FOUND');
      if (user.coinBalance < coinsToDeduct) throw new Error('INSUFFICIENT_COINS');

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          coinBalance: { decrement: coinsToDeduct },
          walletBalance: { increment: rupees },
        },
        select: { coinBalance: true, walletBalance: true },
      });

      const transaction = await tx.transaction.create({
        data: {
          userId,
          type: 'reward_coin_withdrawal',
          amount: rupees,
          status: 'completed',
          method: 'coin_conversion',
          reference: `Converted ${coinsToDeduct} coins to Rs ${rupees}`,
        },
        select: { id: true, amount: true, createdAt: true, type: true, status: true, reference: true },
      });

      await tx.rewardAudit.create({
        data: {
          userId,
          action: 'coin_withdrawal',
          ipAddress: ip,
          userAgent: request.headers.get('user-agent') ?? '',
          metadata: {
            requestedCoins,
            coinsDeducted: coinsToDeduct,
            rupeesCredited: rupees,
          },
        },
      });

      return {
        coinsDeducted: coinsToDeduct,
        rupeesCredited: rupees,
        coinBalance: updatedUser.coinBalance,
        walletBalance: Number(updatedUser.walletBalance ?? 0),
        transaction,
      };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    if (error?.message === 'INSUFFICIENT_COINS') {
      return NextResponse.json({ error: 'Insufficient coins' }, { status: 400 });
    }
    if (error?.message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    console.error('Coin withdrawal error:', error);
    return NextResponse.json({ error: 'Failed to withdraw coins' }, { status: 500 });
  }
}
