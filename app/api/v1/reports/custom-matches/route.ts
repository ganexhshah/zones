import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAuthUser } from '@/lib/route-auth';
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
    const auth = await requireAuthUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const logs = await prisma.matchLog.findMany({
      where: {
        action: 'MATCH_REPORTED',
        performedBy: auth.user.id,
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
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const reports = logs.map((row) => {
      const meta = parseMeta(row.meta);
      const statusValue = toStringField(meta['status']);
      return {
        id: row.id,
        matchId: row.matchId,
        gameName: row.match.gameName,
        reason: toStringField(meta['reason']),
        details: toStringField(meta['details']),
        proofUrl: toStringField(meta['proofUrl']),
        status: statusValue.length == 0 ? 'SUBMITTED' : statusValue,
        adminNote: toStringField(meta['adminNote']),
        createdAt: row.createdAt,
      };
    });

    return ok({ reports });
  } catch (error) {
    return handleApiError(error);
  }
}
