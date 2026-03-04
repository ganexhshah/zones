import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAdminUser } from '@/lib/route-auth';
import { fail, handleApiError, ok } from '@/lib/match-v1/http';
import { sendEmail } from '@/lib/email';

function parseMeta(meta: Prisma.JsonValue | null) {
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

const allowedStatuses = new Set([
  'SUBMITTED',
  'IN_REVIEW',
  'ACTION_TAKEN',
  'REJECTED',
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireAdminUser(req);
    if ('error' in auth) return fail(auth.error ?? 'Unauthorized', auth.status);

    const body = (await req.json().catch(() => ({}))) as {
      status?: string;
      adminNote?: string;
    };
    const status = (body.status ?? '').trim().toUpperCase();
    const adminNote = (body.adminNote ?? '').trim();

    if (!allowedStatuses.has(status)) {
      return fail('Invalid report status', 400);
    }

    const row = await prisma.matchLog.findUnique({
      where: { id: params.id },
      include: {
        performer: {
          select: { id: true, name: true, email: true },
        },
        match: {
          select: { id: true, gameName: true },
        },
      },
    });

    if (!row || row.action != 'MATCH_REPORTED') {
      return fail('Report not found', 404);
    }

    const currentMeta = parseMeta(row.meta);
    const nextMeta = {
      ...currentMeta,
      status,
      adminNote: adminNote.length == 0 ? null : adminNote,
      reviewedByUserId: auth.user.id,
      reviewedAt: new Date().toISOString(),
    };

    await prisma.matchLog.update({
      where: { id: params.id },
      data: { meta: nextMeta as Prisma.InputJsonValue },
    });

    if (row.performer?.email) {
      const shortMatchId = row.match.id.length > 10 ? row.match.id.slice(0, 10) : row.match.id;
      await sendEmail(
        row.performer.email,
        `Custom Match Report Update: ${status}`,
        `
        <div style="font-family: Arial, sans-serif; padding: 16px;">
          <h2>Report status updated</h2>
          <p>Hello ${row.performer.name ?? 'Player'},</p>
          <p>Your custom match report status is now <strong>${status}</strong>.</p>
          <p><strong>Match:</strong> ${row.match.gameName} (${shortMatchId})</p>
          <p><strong>Admin note:</strong> ${adminNote.length == 0 ? 'N/A' : adminNote}</p>
        </div>
        `,
      );
    }

    return ok({
      reportId: params.id,
      status,
      adminNote: adminNote.length == 0 ? '' : adminNote,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
