import { NextRequest } from 'next/server';

import { requireAuthUser } from '@/lib/route-auth';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const limitParam = req.nextUrl.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 50;

    const ledgerEntries = await prisma.walletLedger.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      include: {
        match: {
          select: {
            id: true,
            gameName: true,
            entryFee: true,
            prizePool: true,
            status: true,
          },
        },
      },
    });

    return ok({ ledger: ledgerEntries });
  } catch (error) {
    return handleApiError(error);
  }
}
