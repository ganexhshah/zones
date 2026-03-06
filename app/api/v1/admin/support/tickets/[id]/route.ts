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

function statusMessage(status: string) {
  if (status == 'IN_REVIEW') {
    return 'Your support ticket is now in review by our support team.';
  }
  if (status == 'ACTION_TAKEN') {
    return 'Action has been taken on your support ticket. Please check the admin note.';
  }
  if (status == 'REJECTED') {
    return 'Your support ticket has been closed as rejected. Please check the admin note for details.';
  }
  return 'Your support ticket status has been updated.';
}

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
    if (!allowedStatuses.has(status)) return fail('Invalid ticket status', 400);

    const row = await prisma.userNotification.findUnique({
      where: { id: params.id },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!row || row.category != 'SUPPORT_TICKET') return fail('Ticket not found', 404);

    const currentMeta = parseMeta(row.metadata as Prisma.JsonValue | null);
    const nextMeta = {
      ...currentMeta,
      status,
      adminNote: adminNote.length == 0 ? null : adminNote,
      reviewedByUserId: auth.user.id,
      reviewedAt: new Date().toISOString(),
    };

    await prisma.userNotification.update({
      where: { id: params.id },
      data: {
        title: `Support ticket ${status.split('_').join(' ').toLowerCase()}`,
        message: statusMessage(status),
        metadata: nextMeta as Prisma.InputJsonValue,
      },
    });

    await prisma.userNotification.create({
      data: {
        userId: row.userId,
        category: 'SUPPORT_UPDATE',
        title: `Support ticket ${status.split('_').join(' ').toLowerCase()}`,
        message: statusMessage(status),
        metadata: {
          ticketId: params.id,
          status,
          adminNote: adminNote.length == 0 ? null : adminNote,
          reviewedAt: new Date().toISOString(),
        },
      },
    });

    if (row.user.email) {
      await sendEmail(
        row.user.email,
        `Support Ticket Update: ${status}`,
        `
        <div style="font-family: Arial, sans-serif; padding: 16px;">
          <h2>Support ticket status updated</h2>
          <p>Hello ${row.user.name ?? 'User'},</p>
          <p>Your support ticket <strong>${params.id}</strong> status is now <strong>${status}</strong>.</p>
          <p><strong>Admin note:</strong> ${adminNote.length == 0 ? 'N/A' : adminNote}</p>
        </div>
        `,
      );
    }

    return ok({ ticketId: params.id, status, adminNote });
  } catch (error) {
    return handleApiError(error);
  }
}
