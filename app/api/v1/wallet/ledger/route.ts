import { NextRequest } from 'next/server';

import { requireAuthUser } from '@/lib/route-auth';
import { prisma } from '@/lib/prisma';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 50), 200);
    const ledger = await prisma.walletLedger.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return ok({
      ledger: ledger.map((row) => ({
        id: row.id,
        user_id: row.userId,
        match_id: row.matchId,
        type: row.type,
        amount: Number(row.amount),
        balance_after: Number(row.balanceAfter),
        created_at: row.createdAt,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

