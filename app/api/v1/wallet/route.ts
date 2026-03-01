import { NextRequest } from 'next/server';

import { requireAuthUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: {
        availableBalance: true,
        lockedBalance: true,
        walletBalance: true,
      },
    });

    const available = Number(user.availableBalance);
    const locked = Number(user.lockedBalance);
    const walletTotal = Number(user.walletBalance ?? 0);
    const inferredAvailable = Math.max(0, walletTotal - locked);
    const effectiveAvailable = Math.max(available, inferredAvailable);

    const ledger = await prisma.walletLedger.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    return ok({
      available_balance: effectiveAvailable,
      locked_balance: locked,
      transactions: ledger.map((row) => ({
        id: row.id,
        type: row.type,
        match_id: row.matchId,
        amount: Number(row.amount),
        balance_after: Number(row.balanceAfter),
        created_at: row.createdAt,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

