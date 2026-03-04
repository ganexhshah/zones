import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAdminUser } from '@/lib/route-auth';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';

function parseMeta(meta: Prisma.JsonValue | null) {
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

function str(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const statusFilter = (req.nextUrl.searchParams.get('status') ?? '').trim().toUpperCase();
    const rows = await prisma.userNotification.findMany({
      where: {
        category: 'WALLET_REPORT',
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const reports = rows
      .map((r) => {
        const meta = parseMeta(r.metadata as Prisma.JsonValue | null);
        const statusValue = str(meta['status']);
        const status = statusValue.length == 0 ? 'SUBMITTED' : statusValue;
        return {
          id: r.id,
          userId: r.userId,
          userName: r.user.name ?? 'User',
          userEmail: r.user.email ?? '',
          transactionId: str(meta['transactionId']),
          transactionType: str(meta['transactionType']),
          transactionAmount: str(meta['transactionAmount']),
          reason: str(meta['reason']),
          details: str(meta['details']),
          status,
          adminNote: str(meta['adminNote']),
          reviewedByUserId: str(meta['reviewedByUserId']),
          reviewedAt: str(meta['reviewedAt']),
          createdAt: r.createdAt,
        };
      })
      .filter((row) => {
        if (statusFilter.length == 0 || statusFilter === 'ALL') return true;
        return row.status.toUpperCase() === statusFilter;
      });

    return ok({ reports });
  } catch (error) {
    return handleApiError(error);
  }
}
