import { NextRequest } from 'next/server';

import { requireAdminUser } from '@/lib/route-auth';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { prisma } from '@/lib/prisma';
import { MatchStatus } from '@prisma/client';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const statusParam = req.nextUrl.searchParams.get('status');
    const limitParam = req.nextUrl.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 100;

    const where: any = {};
    if (statusParam && statusParam !== 'ALL') {
      where.status = statusParam as MatchStatus;
    }

    const matches = await prisma.match.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        joiner: { select: { id: true, name: true, avatar: true } },
      },
    });

    return ok({ matches });
  } catch (error) {
    return handleApiError(error);
  }
}
