import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAdminUser } from '@/lib/route-auth';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';

function toStringField(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function parseMeta(meta: Prisma.JsonValue | null) {
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const statusFilter = (req.nextUrl.searchParams.get('status') ?? '').trim().toUpperCase();

    const logs = await prisma.matchLog.findMany({
      where: {
        action: 'MATCH_REPORTED',
      },
      include: {
        match: {
          select: {
            id: true,
            gameName: true,
            creator: { select: { id: true, name: true } },
            joiner: { select: { id: true, name: true } },
          },
        },
        performer: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const reports = logs
      .map((row) => {
        const meta = parseMeta(row.meta);
        const statusValue = toStringField(meta['status']);
        const status = statusValue.length == 0 ? 'SUBMITTED' : statusValue;
        return {
          id: row.id,
          matchId: row.matchId,
          gameName: row.match.gameName,
          reportedByUserId: row.performedBy ?? '',
          reportedByName: row.performer?.name ?? 'Player',
          reportedByEmail: row.performer?.email ?? '',
          reason: toStringField(meta['reason']),
          details: toStringField(meta['details']),
          proofUrl: toStringField(meta['proofUrl']),
          status,
          adminNote: toStringField(meta['adminNote']),
          reviewedByUserId: toStringField(meta['reviewedByUserId']),
          reviewedAt: toStringField(meta['reviewedAt']),
          createdAt: row.createdAt,
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
